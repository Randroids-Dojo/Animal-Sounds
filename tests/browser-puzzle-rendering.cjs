"use strict";

// Real touch input with prepared, delayed, and unavailable carry bitmaps.
// Painting is counted separately from touch tracking; this does not measure
// the physical tablet's input-to-display latency.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");

(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_EXECUTABLE_PATH ? undefined : "chrome",
    executablePath: process.env.BROWSER_EXECUTABLE_PATH,
    headless: true,
  });
  const results = [];
  try {
    for (const mode of ["ready", "delayed", "unavailable"]) {
      const context = await browser.newContext({ viewport: { width: 800, height: 1340 }, hasTouch: true });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        window.rasterWrites = 0;
        for (const name of ["fill", "stroke", "drawImage"]) {
          const original = CanvasRenderingContext2D.prototype[name];
          CanvasRenderingContext2D.prototype[name] = function (...args) {
            window.rasterWrites += 1;
            return original.apply(this, args);
          };
        }
      });
      const pending = [];
      let received;
      const artworkRequested = new Promise((resolve) => { received = resolve; });
      if (mode !== "ready") await page.route("**/images/**", (route) => {
        if (route.request().resourceType() !== "fetch") return route.continue();
        received();
        if (mode === "unavailable") return route.abort();
        pending.push(route);
      });
      const cdp = await context.newCDPSession(page);
      const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", {
        type, touchPoints: points.map((point) => ({ ...point, id: 1, radiusX: 10, radiusY: 8, force: 1 })),
      });
      const center = (locator) => locator.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      });
      try {
        await page.goto(process.argv[2] || "http://127.0.0.1:8642");
        await page.locator(".tile").first().waitFor();
        await page.locator("#idle-dim").tap();
        await page.getByRole("button", { name: "🧩 Puzzle", exact: true }).tap();
        if (mode === "ready") await page.evaluate(() => puzzleArtReady);
        else await artworkRequested;
        if (mode === "unavailable") await page.evaluate(() => puzzleArtReady);
        const piece = page.locator("#puzzle-tray .puzzle-piece").first();
        const index = await piece.getAttribute("data-index");
        const start = await center(piece);
        await touch("touchStart", [start]);
        await touch("touchMove", [{ x: start.x + 25, y: start.y }]);
        const ghost = page.locator(".puzzle-piece.dragging");
        await ghost.waitFor();
        assert.equal(await ghost.locator(":scope > canvas").count(), mode === "ready" ? 1 : 0,
          "pickup remains immediate while a bitmap is unavailable");
        if (mode === "delayed") {
          for (const route of pending) await route.continue();
          await page.evaluate(() => puzzleArtReady);
          assert.equal(await ghost.locator(":scope > canvas").count(), 1, "a held piece switches to the prepared bitmap");
          assert.equal(await ghost.getAttribute("data-index"), index, "preparation preserves the active piece");
        }
        const writesBefore = await page.evaluate(() => rasterWrites);
        const home = await center(page.locator(`.puzzle-slot[data-index="${index}"]`));
        for (let step = 1; step <= 60; step += 1) {
          await touch("touchMove", [{ x: start.x + (home.x - start.x) * step / 60, y: start.y + (home.y - start.y) * step / 60 }]);
        }
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const carry = await ghost.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return {
            x: rect.x + rect.width / 2, y: rect.y + rect.height / 2,
            filters: [element, ...element.querySelectorAll("*")].map((node) => getComputedStyle(node).filter),
            svg: element.querySelectorAll("svg").length,
            opacity: getComputedStyle(element).opacity,
            writes: rasterWrites,
          };
        });
        assert.ok(Math.hypot(carry.x - home.x, carry.y - home.y) < 1, "the displayed piece reaches the newest touch position");
        assert.ok(carry.filters.every((filter) => filter === "none"), "the moving copy has no live filters");
        assert.equal(carry.opacity, "1", "the carried copy needs no group transparency");
        assert.equal(carry.writes, writesBefore, "carrying does not redraw the cached canvases");
        if (mode !== "unavailable") assert.equal(carry.svg, 0, "prepared carried artwork has no live SVG masks");
        await touch("touchEnd", []);
        assert.equal(await page.locator(`.puzzle-slot.filled[data-index="${index}"]`).count(), 1, "the same gesture seats its piece");
        await page.waitForTimeout(250);
        assert.equal(await page.locator(".dragging, .sliding, .arriving").count(), 0, "the carried copy cleans up after seating");

        if (mode === "ready") {
          for (const kind of ["animal", "dinosaur", "food", "robot"]) {
            const art = await page.evaluate(async (wanted) => {
              newPuzzle(puzzleDeck.collections[wanted].find((item) => item.hue) || puzzleDeck.collections[wanted][0]);
              await puzzleArtReady;
              return [...puzzleTray.children].map((node) => {
                const canvas = puzzleDragArtwork.get(node);
                return { cached: Boolean(canvas), width: canvas?.width, expected: Math.ceil(seatedPieceSize() * PUZZLE_LIFT_SCALE * Math.min(window.devicePixelRatio || 1, 2)) };
              });
            }, kind);
            assert.equal(art.length, 9);
            assert.ok(art.every((entry) => entry.cached && entry.width === entry.expected), `${kind}: nine bounded bitmaps are prepared`);
          }
        }
        assert.deepEqual(errors, []);
        results.push({ mode, passed: true });
      } finally {
        await context.close();
      }
    }
    console.log(JSON.stringify({ passed: true, browser: browser.version(), results }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
