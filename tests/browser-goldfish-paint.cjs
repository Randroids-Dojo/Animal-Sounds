"use strict";

// Run against the local static server (or pass a deployed URL). Checks that
// the goldfish tank stays cheap for the tablet's weak GPU and CPU, by counting
// what Chrome does in a trace while the busiest scenes play: the fish chasing
// a sprinkle of flakes, with bubbles rising and its thought bubble following,
// and a rings game with each ring steered through as it appears.
// - The page's own layers are not redrawn while things swim: the water,
//   plants, pebbles and ship are one canvas painted once.
// - The fish's layer only ever translates; its turns and tilt are drawn into
//   its own small canvas, which is a small fraction of the tank.
// - The tank's frame work on the main thread stays small even with the CPU
//   slowed down six times, roughly the tablet.
// Before trusting a clean result, each check is shown the fault it guards
// against and must flag it. Counts describe this browser run, not the tablet.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");

const CATEGORIES = ["devtools.timeline", "disabled-by-default-devtools.timeline", "cc", "viz"];
const THROTTLE = 6;
const LIMITS = {
  // The most separate frames in which any one layer is redrawn. New bubbles
  // and flakes are drawn once or twice; a layer redrawn as things move would
  // be drawn in frame after frame.
  layerRedraws: 3,
  // Tiles redrawn per second, all layers together.
  rasterTilesPerSecond: 15,
  // A grown fish's canvas, as a share of the tank.
  fishShare: 0.25,
  // Main-thread time of a frame callback at six times slower, p95.
  frameMs: 8,
};
const FAULTS = {
  // Flakes and the thought bubble painted into the page as they move.
  "uncomposited movers": ".tank-flake, .tank-thought { will-change: auto !important; }",
  // Something under the scene redrawn every frame.
  "repainted water": "#fish-tank { animation: repaint-water 40ms steps(1) infinite; } @keyframes repaint-water { from { background-color: #F0F; } to { background-color: #0F0; } }",
  // The fish layer scaled while it moves.
  "scaled fish": ".tank-fish { scale: 1.02; }",
  // A main-thread stall in every frame callback.
  "slow frames": "/* busy */",
};

function traceEvents(buffer) {
  const trace = JSON.parse(buffer.toString());
  return (trace.traceEvents || trace).filter((event) => event.ph === "X");
}

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0;
};

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

  // A grown, hungry fish is the biggest thing redrawn each frame.
  // scene "care" is food, bubbles and a water change; "rings" is a game of
  // rings, each steered through as soon as it appears.
  async function measure(fault, grown = true, scene = "care") {
    const context = await browser.newContext({ viewport: { width: 800, height: 1340 }, hasTouch: true });
    const page = await context.newPage();
    if (grown) {
      await page.addInitScript(() => localStorage.setItem("animal-sounds-goldfish-v1", JSON.stringify({
        v: 1, bornAt: Date.now() - 200 * 864e5, updatedAt: Date.now(), hunger: 0.7, dirt: 0.45, health: 1, goodMs: 180 * 864e5, leftovers: 6,
      })));
    }
    const cdp = await context.newCDPSession(page);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await page.goto(process.argv[2] || "http://127.0.0.1:8642");
    await page.locator(".tile").first().waitFor();
    await page.locator("#idle-dim").tap();
    await page.locator('[data-page-target="fish"]').tap();
    await page.waitForFunction(() => fishTank.debug().frames > 10);
    if (fault) await page.addStyleTag({ content: FAULTS[fault] });
    if (fault === "slow frames") {
      await page.evaluate(() => {
        const realFrame = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = (callback) => realFrame((time) => {
          const until = performance.now() + 10;
          while (performance.now() < until);
          callback(time);
        });
      });
    }
    // The header's Today timer redraws once a second by design; hold it
    // still so the counts are the tank's alone.
    await page.evaluate(() => { renderDailyTime = () => {}; });
    await wait(300);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });

    // The busiest scene: food falling, the fish chasing it, bubbles rising,
    // cloudy water, and then the water drained and refilled clear.
    await browser.startTracing(page, { categories: CATEGORIES });
    const started = Date.now();
    const sampled = await page.evaluate((scene) => new Promise((resolve) => {
      if (scene === "rings") {
        fishTank.startRings();
        const steer = setInterval(() => {
          const { game, coming } = fishTank.debug();
          if (!game) return clearInterval(steer);
          if (game.ring && !coming) {
            const box = document.getElementById("fish-tank").getBoundingClientRect();
            fishTank.tap(box.left + 6 + game.ring.x, box.top + 6 + game.ring.y);
          }
        }, 200);
      } else {
        fishTank.feed();
        setTimeout(() => fishTank.feed(), 700);
        setTimeout(() => fishTank.changeWater(), 1400);
      }
      const tank = document.getElementById("fish-tank");
      const fishCanvas = document.querySelector(".tank-fish");
      const seen = { translates: true, flakes: 0, bubbles: 0, drained: false, clouded: 0 };
      const end = performance.now() + 5000;
      const sample = () => {
        const style = getComputedStyle(fishCanvas);
        const { a, b, c, d } = new DOMMatrixReadOnly(style.transform);
        if (!(a === 1 && b === 0 && c === 0 && d === 1 && style.scale === "none" && style.rotate === "none")) seen.translates = false;
        seen.flakes = Math.max(seen.flakes, fishTank.debug().flakes.length);
        seen.bubbles = Math.max(seen.bubbles, tank.querySelectorAll(".tank-bubble").length);
        seen.drained ||= fishTank.debug().draining;
        seen.clouded = Math.max(seen.clouded, Number(getComputedStyle(tank.querySelector(".tank-cloud")).opacity));
        seen.rings = Math.max(seen.rings || 0, fishTank.debug().game?.score || 0);
        if (performance.now() < end) requestAnimationFrame(sample);
        else resolve({ ...seen, fishShare: (fishCanvas.offsetWidth * fishCanvas.offsetHeight) / (tank.clientWidth * tank.clientHeight) });
      };
      requestAnimationFrame(sample);
    }), scene);
    const events = traceEvents(await browser.stopTracing());
    const seconds = (Date.now() - started) / 1000;
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    assert.deepEqual(errors, []);
    await context.close();

    const frames = events.filter((event) => event.name === "FireAnimationFrame").map((event) => event.dur / 1000);
    const swaps = events.filter((event) => event.name === "Display::DrawAndSwap").length;
    const rasterEvents = events.filter((event) => event.name === "RasterTask");
    // How many separate frames redrew each layer: a layer redrawn as things
    // move shows up in frame after frame; a new bubble is drawn once.
    const redraws = new Map();
    for (const event of rasterEvents) {
      const { layerId, sourceFrameNumber } = event.args.tileData;
      if (!redraws.has(layerId)) redraws.set(layerId, new Set());
      redraws.get(layerId).add(sourceFrameNumber);
    }
    const perLayer = [...redraws.values()].map((frames) => frames.size).sort((a, b) => b - a);
    return {
      fishShare: Number(sampled.fishShare.toFixed(3)),
      translates: sampled.translates,
      flakes: sampled.flakes,
      drained: sampled.drained,
      rings: sampled.rings || 0,
      clouded: Number(sampled.clouded.toFixed(2)),
      bubbles: sampled.bubbles,
      swaps,
      rasterTilesPerSecond: Number((rasterEvents.length / seconds).toFixed(1)),
      layerRedraws: perLayer[0] || 0,
      layersDrawn: perLayer.length,
      frameCallbacks: frames.length,
      frameMs: Number(percentile(frames, 0.95).toFixed(2)),
      frameMsMedian: Number(percentile(frames, 0.5).toFixed(2)),
    };
  }

  function broken(result) {
    const found = Object.keys(LIMITS).filter((key) => result[key] > LIMITS[key]);
    if (!result.translates) found.push("translates");
    return found;
  }

  try {
    const faults = {};
    for (const fault of Object.keys(FAULTS)) {
      const result = await measure(fault);
      faults[fault] = { ...result, flagged: broken(result) };
    }
    for (const fault of ["uncomposited movers", "repainted water"]) {
      assert.ok(faults[fault].flagged.includes("layerRedraws") && faults[fault].flagged.includes("rasterTilesPerSecond"),
        `sees ${fault}: ${JSON.stringify(faults[fault])}`);
    }
    assert.ok(faults["scaled fish"].flagged.includes("translates"), `sees a scaled fish layer: ${JSON.stringify(faults["scaled fish"])}`);
    assert.ok(faults["slow frames"].flagged.includes("frameMs"), `sees slow frame callbacks: ${JSON.stringify(faults["slow frames"])}`);

    const clean = await measure(null);
    const baby = await measure(null, false);
    const rings = await measure(null, true, "rings");
    assert.ok(clean.flakes >= 3 && clean.bubbles >= 1, `the busy scene played: ${clean.flakes} flakes, ${clean.bubbles} bubbles`);
    assert.ok(clean.drained && clean.clouded > 0.2, `with cloudy water and a water change: ${clean.clouded}, ${clean.drained}`);
    assert.ok(clean.swaps > 60, `the compositor drew it: ${clean.swaps} frames`);
    assert.ok(clean.translates, "the fish layer only translates");
    assert.ok(clean.fishShare <= LIMITS.fishShare, `the fish canvas is small: ${clean.fishShare} of the tank`);
    assert.ok(clean.layerRedraws <= LIMITS.layerRedraws, `no layer is redrawn while things swim: at most ${clean.layerRedraws} times`);
    assert.ok(clean.rasterTilesPerSecond <= LIMITS.rasterTilesPerSecond, `little is drawn at all: ${clean.rasterTilesPerSecond} tiles/s`);
    assert.ok(clean.frameMs <= LIMITS.frameMs, `frame work stays small at ${THROTTLE}x slower: p95 ${clean.frameMs} ms`);
    for (const key of ["layerRedraws", "rasterTilesPerSecond", "frameMs"]) {
      assert.ok(baby[key] <= LIMITS[key], `a new baby fish too: ${key} ${baby[key]}`);
    }
    // A rings game: halves drawn once per ring, the score redrawn per point.
    assert.ok(rings.rings >= 2 && rings.translates, `a rings game played: ${rings.rings} rings`);
    for (const key of ["layerRedraws", "rasterTilesPerSecond", "frameMs"]) {
      assert.ok(rings[key] <= LIMITS[key], `a rings game too: ${key} ${rings[key]}`);
    }
    console.log(JSON.stringify({ passed: true, throttle: THROTTLE, limits: LIMITS, clean, baby, rings, faults }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
