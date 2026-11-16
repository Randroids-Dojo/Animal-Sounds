"use strict";

// Run against the local static server (or pass a deployed URL). Counts how
// much drawing the Words tab asks of Chrome, from a trace rather than by
// timing it: a carried letter's layer only translates and is drawn once,
// nothing else on the page is redrawn while letters are carried or pushed,
// no canvas is painted again during play, and the frame callbacks stay
// small with the CPU slowed six times. Before trusting a clean result, each
// check is shown the fault it guards against and must flag it. Keep GPU
// compositing on with a software backend so the layer tree is available.
// Counts describe this browser run, not the tablet's frame rate.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");

const CATEGORIES = ["devtools.timeline", "disabled-by-default-devtools.timeline", "cc", "viz"];
// Rasterizing the carried letter once when it is lifted is expected; the
// rest of the page should not be redrawn at all while it moves.
const LIMITS = { carriedRasters: 2, otherRasters: 4, slowFrameMs: 4 };
const FAULTS = {
  // Letters drawn into the page instead of on their own moving layers:
  // placed by layout each frame, with plain content in place of canvases.
  "letters in the page": { script: `
    const style = document.createElement("style");
    style.textContent = ".word-letter { transform: none !important; will-change: auto !important; }"
      + " .word-letter-art > canvas { display: none !important; }"
      + " .word-letter-art::after { content: ''; position: absolute; left: -20px; top: -20px; width: 40px; height: 40px; background: #F0F; }";
    document.head.append(style);
    const place = () => {
      for (const letter of wordBoard.debug().letters) {
        const element = document.querySelector('.word-letter[aria-label="Letter ' + letter.char + '"]');
        element.style.left = letter.x + "px";
        element.style.top = letter.y + "px";
      }
      requestAnimationFrame(place);
    };
    place();` },
  // The carried letter scaled while it moves.
  "scaled carry": ".word-letter.held { scale: 1.06; }",
  // The board redrawn over and over.
  "board repaint": ".words-board { animation: repaint-board 40ms steps(1) infinite; } @keyframes repaint-board { from { background-color: #F0F; } to { background-color: #0F0; } }",
  // Motion that costs four milliseconds more per frame.
  "slow motion": { script: "const advance = WordGame.advance; WordGame.advance = (...args) => { const end = performance.now() + 4; while (performance.now() < end); return advance(...args); };" },
};

function traceEvents(buffer) {
  const trace = JSON.parse(buffer.toString());
  return (trace.traceEvents || trace).filter((event) => event.ph === "X");
}

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

  async function measure(fault) {
    const context = await browser.newContext({ viewport: { width: 800, height: 1340 }, hasTouch: true });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map((point) => ({ ...point, id: 1, radiusX: 8, radiusY: 8, force: 1 })),
    });
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const glide = async (points) => {
      for (const point of points) {
        await touch("touchMove", [point]);
        await wait(16);
      }
    };
    const line = (from, to, steps) => Array.from({ length: steps }, (_, i) => ({
      x: from.x + (to.x - from.x) * (i + 1) / steps,
      y: from.y + (to.y - from.y) * (i + 1) / steps,
    }));
    let layers = [];
    await cdp.send("DOM.enable");
    await cdp.send("LayerTree.enable");
    cdp.on("LayerTree.layerTreeDidChange", (event) => { if (event.layers) layers = event.layers; });
    const layerOf = async (expression) => {
      const { result } = await cdp.send("Runtime.evaluate", { expression });
      const { node } = await cdp.send("DOM.describeNode", { objectId: result.objectId, depth: -1 });
      const descendants = new Set();
      const collect = (child) => {
        descendants.add(child.backendNodeId);
        (child.children || []).forEach(collect);
      };
      collect(node);
      return layers.find((layer) => layer.backendNodeId === node.backendNodeId && layer.drawsContent)
        || layers.find((layer) => descendants.has(layer.backendNodeId) && layer.drawsContent);
    };
    const traced = async (run) => {
      await browser.startTracing(page, { categories: CATEGORIES });
      const extra = await run();
      return { events: traceEvents(await browser.stopTracing()), ...extra };
    };

    await page.goto(process.argv[2] || "http://127.0.0.1:8642");
    await page.locator(".tile").first().waitFor();
    await page.locator("#idle-dim").tap();
    await page.locator('[data-page-target="words"]').tap();
    await page.waitForFunction(() => wordBoard.debug().word && !wordBoard.debug().running);
    await page.evaluate(() => wordBoard.newRound(WordGame.wordsFrom([...animals, ...foods, ...robots]).find((entry) => entry.word === "CAT")));
    if (typeof FAULTS[fault] === "string") await page.addStyleTag({ content: FAULTS[fault] });
    else if (fault) await page.evaluate(FAULTS[fault].script);
    await page.waitForFunction(() => !wordBoard.debug().running);
    await wait(500);
    // Canvas painting from here on, which play should never need. The
    // header's Today timer redraws its strip once a second whatever the
    // tab, so it is held still to count only this tab's drawing.
    await page.evaluate(() => {
      window.renderDailyTime = () => {};
      window.painted = 0;
      for (const name of ["fillText", "strokeText", "drawImage", "fillRect", "stroke", "fill"]) {
        const original = CanvasRenderingContext2D.prototype[name];
        CanvasRenderingContext2D.prototype[name] = function counted(...args) {
          window.painted += 1;
          return original.apply(this, args);
        };
      }
    });
    const state = await page.evaluate(() => wordBoard.debug());
    const screen = (point) => ({ x: state.origin.left + point.x, y: state.origin.top + point.y });
    const { arena } = state.geometry;
    // Carry the C in loops over empty table below the letters.
    const letter = state.letters.find((entry) => entry.char === "C");
    const from = screen(letter);
    const middle = screen({ x: (arena.left + arena.right) / 2, y: arena.bottom - 1.6 * letter.hy - 90 });
    await touch("touchStart", [from]);
    await glide(line(from, middle, 20));
    await wait(300);
    await cdp.send("DOM.getDocument", { depth: -1 });
    await cdp.send("LayerTree.disable");
    await cdp.send("LayerTree.enable");
    await page.screenshot();
    const loops = Array.from({ length: 150 }, (_, i) => ({
      x: middle.x + 90 * Math.cos(i / 75 * 2 * Math.PI) - 90,
      y: middle.y + 60 * Math.sin(i / 75 * 2 * Math.PI),
    }));
    const carried = await traced(async () => {
      await glide(loops);
      const held = page.locator(".word-letter.held");
      const translates = await held.evaluate((element) => {
        const style = getComputedStyle(element);
        const { a, b, c, d } = new DOMMatrixReadOnly(style.transform === "none" ? undefined : style.transform);
        const art = getComputedStyle(element.firstElementChild);
        return a === 1 && b === 0 && c === 0 && d === 1 && style.scale === "none" && style.rotate === "none"
          && art.transform === "none" && (art.rotate === "none" || art.rotate === "0deg");
      });
      return { translates, layer: await layerOf('document.querySelector(".word-letter.held")') };
    });
    // Now push the others about, slowed six times, for the frame times.
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
    const others = state.letters.filter((entry) => entry.char !== "C").map(screen);
    const pushed = await traced(async () => {
      await glide(line(loops.at(-1), { x: others[0].x - 200, y: others[0].y }, 10));
      await glide(line({ x: others[0].x - 200, y: others[0].y }, { x: others.at(-1).x + 200, y: others.at(-1).y }, 40));
      await touch("touchEnd", []);
      await wait(1500);
      return {};
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    const painted = await page.evaluate(() => window.painted);
    // The detector must see painting: a new word paints its canvases.
    await page.evaluate(() => wordBoard.newRound());
    const paintedByNewWord = await page.evaluate(() => window.painted) - painted;
    const frames = carried.events.filter((event) => event.name === "Display::DrawAndSwap").length;
    assert.ok(frames > 60, `the compositor drew the carry: ${frames} frames`);
    const rasters = carried.events.filter((event) => event.name === "RasterTask");
    const callbacks = pushed.events.filter((event) => event.name === "FireAnimationFrame").map((event) => event.dur / 1000).sort((a, b) => a - b);
    const own = Number(carried.layer?.layerId ?? NaN);
    if (process.env.DEBUG_LAYERS) {
      const byLayer = {};
      rasters.forEach((event) => { const id = event.args.tileData.layerId; (byLayer[id] ||= new Set()).add(event.args.tileData.sourceFrameNumber); });
      const info = await Promise.all(Object.keys(byLayer).map(async (id) => {
        const layer = layers.find((entry) => Number(entry.layerId) === Number(id));
        let node = null;
        if (layer?.backendNodeId) {
          try { node = (await cdp.send("DOM.describeNode", { backendNodeId: layer.backendNodeId })).node; } catch (_) {}
        }
        return { id, own: Number(id) === own, frames: [...byLayer[id]], size: layer && [layer.width, layer.height], node: node && `${node.nodeName}.${(node.attributes || []).join(" ")}` };
      }));
      console.error(fault, JSON.stringify(info));
    }
    const result = {
      ownLayer: Boolean(carried.layer),
      translates: carried.translates,
      carriedRasters: new Set(rasters.filter((event) => event.args.tileData.layerId === own)
        .map((event) => event.args.tileData.sourceFrameNumber)).size,
      otherRasters: new Set(rasters.filter((event) => event.args.tileData.layerId !== own)
        .map((event) => event.args.tileData.sourceFrameNumber)).size,
      frameCallbacks: callbacks.length,
      slowFrameMs: Number((callbacks[Math.floor(callbacks.length * 0.95)] || 0).toFixed(2)),
      painted,
      paintedByNewWord,
    };
    assert.deepEqual(errors, []);
    await context.close();
    return result;
  }

  function broken(result) {
    const found = Object.keys(LIMITS).filter((key) => result[key] > LIMITS[key]);
    if (!result.translates) found.push("translates");
    if (result.painted) found.push("painted");
    return found;
  }

  try {
    const faults = {};
    for (const fault of Object.keys(FAULTS)) {
      const result = await measure(fault);
      faults[fault] = { ...result, flagged: broken(result) };
    }
    assert.ok(faults["letters in the page"].flagged.includes("otherRasters"), `sees letters drawn into the page: ${JSON.stringify(faults["letters in the page"])}`);
    assert.ok(faults["scaled carry"].flagged.includes("translates"), `sees a scaled carried letter: ${JSON.stringify(faults["scaled carry"])}`);
    assert.ok(faults["board repaint"].flagged.includes("otherRasters"), `sees the board redrawn: ${JSON.stringify(faults["board repaint"])}`);
    assert.ok(faults["slow motion"].flagged.includes("slowFrameMs"), `sees slow frame callbacks: ${JSON.stringify(faults["slow motion"])}`);

    const clean = await measure(null);
    assert.ok(clean.ownLayer, "the carried letter has its own layer");
    assert.ok(clean.translates, "the carried letter only translates");
    assert.ok(clean.carriedRasters <= LIMITS.carriedRasters, `the carried letter is drawn once: ${clean.carriedRasters}`);
    assert.ok(clean.otherRasters <= LIMITS.otherRasters, `nothing else is redrawn while it moves: ${clean.otherRasters}`);
    assert.ok(clean.paintedByNewWord > 0, "the canvas counter sees a new word being painted");
    assert.equal(clean.painted, 0, "no canvas is painted again during play");
    assert.ok(clean.frameCallbacks > 30, `the pushes ran frame callbacks: ${clean.frameCallbacks}`);
    assert.ok(clean.slowFrameMs <= LIMITS.slowFrameMs, `frame callbacks stay small at 6x slower CPU: ${clean.slowFrameMs} ms (95th percentile)`);
    console.log(JSON.stringify({ passed: true, limits: LIMITS, clean, faults }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
