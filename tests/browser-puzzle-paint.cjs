"use strict";

// Run against the local static server (or pass a deployed URL). Checks that
// the puzzle stays cheap to draw for the tablet's weak GPU, by counting the
// drawing Chrome does rather than timing it: a carried bitmap's layer is about
// the piece's own size, has no live SVG or filters, is not repeatedly rasterized, and
// seating a piece redraws at most one screen's worth of the board. The carried
// layer must also only translate. Chrome redraws a scaled layer as it moves
// by fractions of a pixel, but not reliably enough to count, so its redraws
// are reported and its transform is what is checked. Before trusting a clean
// result, each check is shown the fault it guards against and must flag it.
// Keep GPU compositing enabled with a software backend so the layer tree is
// available. Counts describe this browser run, not the tablet's frame rate.
// PUZZLE=animal (or dinosaur, food, robot, or "robot:Robot Dog") picks the
// picture; dinosaurs, the only photos, are the default.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");

const TILE_PX = 256;
const CATEGORIES = ["devtools.timeline", "disabled-by-default-devtools.timeline", "cc", "viz"];
const LIMITS = { layerSpan: 1.5, rasters: 1 };
// Each fault brings back one cause of the stutter on the tablet.
const FAULTS = {
  // Pieces paint the whole picture under their masks.
  "whole picture": ".piece-frame { overflow: visible !important; }",
  // The carried layer is scaled while it moves.
  "scaled carry": ".puzzle-piece.dragging { scale: 1.06; }",
  // Reintroduce the masked SVG instead of the prepared bitmap.
  "live SVG carry": "/* Use the original SVG artwork. */",
  // Force repeated painting of the board, independent of SVG invalidation
  // optimizations that differ between Chrome versions.
  "repeated board repaint": "#puzzle-board { animation: repaint-board 40ms steps(1) infinite; } @keyframes repaint-board { from { background-color: #F0F; } to { background-color: #0F0; } }",
  // The compositor draws the carried piece's shadow on every frame.
  "composited shadow": ".puzzle-piece.dragging { filter: drop-shadow(0 12px 10px rgba(20, 18, 39, 0.3)); }",
};

function traceEvents(buffer) {
  const trace = JSON.parse(buffer.toString());
  return (trace.traceEvents || trace).filter((event) => event.ph === "X");
}

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const [kind = "dinosaur", name = kind === "dinosaur" ? "Triceratops" : ""] = (process.env.PUZZLE || "").split(":").filter(Boolean);

  async function measure(fault) {
    const context = await browser.newContext({ viewport: { width: 800, height: 1340 }, hasTouch: true });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map((point) => ({ ...point, id: 1, radiusX: 10, radiusY: 8, force: 1 })),
    });
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const center = async (selector) => page.locator(selector).first().evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width };
    });
    // Moves paced like a 60 Hz digitiser.
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
      // Chrome may promote the canvas beneath the translated button.
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
    await page.getByRole("button", { name: "🧩 Puzzle", exact: true }).tap();
    const picture = await page.evaluate(([wanted, title]) => {
      newPuzzle(puzzleDeck.collections[wanted].find((item) => !title || item.name === title));
      return currentPuzzle.name;
    }, [kind, name]);
    await page.evaluate(() => puzzleArtReady);
    if (fault) await page.addStyleTag({ content: FAULTS[fault] });
    if (fault === "whole picture" || fault === "live SVG carry") {
      await page.evaluate(() => [...puzzleTray.children].forEach((piece) => puzzleDragArtwork.delete(piece)));
    }
    await wait(500);

    // Pick a piece up and let it finish growing, then carry it in loops over
    // the board, kept on screen so tiles never scroll into view.
    const from = await center("#puzzle-tray .puzzle-piece");
    const board = await center("#puzzle-board");
    await touch("touchStart", [from]);
    await glide(line(from, board, 20));
    await wait(300);
    // Refresh after navigation and pickup, when the carried nodes exist.
    // Otherwise current Chrome can report only the previous document's layers.
    await cdp.send("DOM.getDocument", { depth: -1 });
    await cdp.send("LayerTree.disable");
    await cdp.send("LayerTree.enable");
    await page.screenshot();
    const loops = Array.from({ length: 150 }, (_, i) => ({
      x: board.x + board.width / 6 * Math.cos(i / 75 * 2 * Math.PI),
      y: board.y + board.width / 6 * Math.sin(i / 75 * 2 * Math.PI),
    }));
    const carried = await traced(async () => {
      await glide(loops);
      const ghost = page.locator(".puzzle-piece.dragging");
      const box = await ghost.evaluate((element) => element.getBoundingClientRect().width);
      const index = await ghost.getAttribute("data-index");
      const translates = await ghost.evaluate((element) => {
        const style = getComputedStyle(element);
        const { a, b, c, d } = new DOMMatrixReadOnly(style.transform === "none" ? undefined : style.transform);
        return a === 1 && b === 0 && c === 0 && d === 1 && style.scale === "none" && style.rotate === "none";
      });
      const artwork = await ghost.evaluate((element) => ({
        bitmap: element.firstElementChild.tagName === "CANVAS" && !element.querySelector("svg"),
        liveFilters: [element, ...element.querySelectorAll("*")].filter((node) => getComputedStyle(node).filter !== "none").length,
      }));
      return { box, index, translates, ...artwork, layer: await layerOf('document.querySelector(".puzzle-piece.dragging")') };
    });
    // Into its own spot, so no loose piece lies over the tray.
    await glide(line(loops.at(-1), await center(`.puzzle-slot[data-index="${carried.index}"]`), 20));
    await touch("touchEnd", []);
    await wait(500);
    assert.ok(carried.layer, "the carried piece has its own layer");
    const count = (name) => carried.events.filter((event) => event.name === name).length;
    const frames = count("Display::DrawAndSwap");
    assert.ok(frames > 60, `the compositor drew the carry: ${frames} frames`);
    const carry = {
      bitmap: carried.bitmap,
      liveFilters: carried.liveFilters,
      translates: carried.translates,
      layerSpan: Number((Math.max(carried.layer.width, carried.layer.height) / carried.box).toFixed(2)),
      rasters: new Set(carried.events
        .filter((event) => event.name === "RasterTask" && event.args.tileData.layerId === Number(carried.layer.layerId))
        .map((event) => event.args.tileData.sourceFrameNumber)).size,
    };

    // Seat three pieces, and count the board's tiles redrawn after each drop.
    const seated = await traced(async () => {
      for (let i = 0; i < 3; i += 1) {
        const index = await page.locator("#puzzle-tray .puzzle-piece").first().getAttribute("data-index");
        const start = await center(`#puzzle-tray .puzzle-piece[data-index="${index}"]`);
        await touch("touchStart", [start]);
        await glide(line(start, await center(`.puzzle-slot[data-index="${index}"]`), 12));
        await touch("touchEnd", []);
        await wait(600);
      }
      return { layer: await layerOf("document") };
    });
    assert.equal(await page.locator(".puzzle-slot.filled").count(), 4, "the carried piece and three more seat");
    const rootTiles = Math.ceil(seated.layer.width / TILE_PX) * Math.ceil(seated.layer.height / TILE_PX);
    const drops = seated.events.filter((event) => event.name === "EventDispatch" && event.args.data.type === "pointerup");
    assert.equal(drops.length, 3, "three drops traced");
    const seat = {
      rootTiles,
      tilesPerSeat: drops.map((drop) => seated.events.filter((event) => event.name === "RasterTask"
        && event.args.tileData.layerId === Number(seated.layer.layerId)
        && event.ts >= drop.ts && event.ts < drop.ts + 500000).length),
    };
    assert.deepEqual(errors, []);
    await context.close();
    return { picture, carry, seat };
  }

  // Which limits a measurement breaks.
  function broken({ carry, seat }) {
    const found = Object.keys(LIMITS).filter((key) => carry[key] > LIMITS[key]);
    if (!carry.translates) found.push("translates");
    if (!carry.bitmap) found.push("bitmap");
    if (carry.liveFilters) found.push("liveFilters");
    if (seat.tilesPerSeat.some((tiles) => tiles > seat.rootTiles)) found.push("tilesPerSeat");
    return found;
  }

  try {
    const faults = {};
    for (const fault of Object.keys(FAULTS)) {
      const result = await measure(fault);
      faults[fault] = { ...result, flagged: broken(result) };
    }
    assert.ok(faults["whole picture"].flagged.includes("layerSpan"), `sees an oversized carried layer: ${JSON.stringify(faults["whole picture"])}`);
    assert.ok(faults["repeated board repaint"].flagged.includes("tilesPerSeat"), `sees excessive board painting: ${JSON.stringify(faults["repeated board repaint"])}`);
    assert.ok(faults["scaled carry"].flagged.includes("translates"), `sees a scaled carried layer: ${JSON.stringify(faults["scaled carry"])}`);
    assert.ok(faults["live SVG carry"].flagged.includes("bitmap"), "sees live SVG artwork being carried");
    assert.ok(faults["composited shadow"].flagged.includes("liveFilters"), "sees a live shadow filter on the moving copy");

    const clean = await measure(null);
    assert.ok(clean.carry.layerSpan <= LIMITS.layerSpan, `the carried layer is about the piece's size: ${clean.carry.layerSpan}x`);
    assert.ok(clean.carry.translates, "the carried layer only translates, so it is drawn once and then moved");
    assert.ok(clean.carry.bitmap, "the moving copy uses prepared bitmap artwork");
    assert.equal(clean.carry.liveFilters, 0, "no live filter on the moving artwork");
    assert.ok(clean.carry.rasters <= LIMITS.rasters, `carrying does not repeatedly rasterize the artwork: ${clean.carry.rasters}`);
    assert.ok(clean.seat.tilesPerSeat.every((tiles) => tiles <= clean.seat.rootTiles),
      `a seat redraws at most one screen of the board: ${clean.seat.tilesPerSeat} of ${clean.seat.rootTiles} tiles`);
    console.log(JSON.stringify({ passed: true, limits: LIMITS, clean, faults }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
