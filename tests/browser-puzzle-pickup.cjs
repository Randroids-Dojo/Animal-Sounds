"use strict";

// Real touch pickup, including WebViews that do not target an unpainted SVG
// hit path. BROWSER_EXECUTABLE_PATH can point to an older Chromium binary.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");

(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_EXECUTABLE_PATH ? undefined : "chrome",
    executablePath: process.env.BROWSER_EXECUTABLE_PATH,
    headless: true,
  });
  const results = [];
  const [width, height] = (process.env.VIEWPORT || "800x1340").split("x").map(Number);
  try {
    for (const svgHits of [false, true]) {
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: true });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const cdp = await context.newCDPSession(page);
      const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", {
        type, touchPoints: points.map((point) => ({ ...point, radiusX: 10, radiusY: 8, force: 1 })),
      });
      const settle = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const center = (locator) => locator.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      });
      const glide = async (from, to, id = 1) => {
        for (let step = 1; step <= 8; step += 1) {
          await touch("touchMove", [{ id, x: from.x + (to.x - from.x) * step / 8, y: from.y + (to.y - from.y) * step / 8 }]);
        }
        await settle();
      };
      const slot = (index) => page.locator(`.puzzle-slot[data-index="${index}"]`);
      try {
        await page.goto(process.argv[2] || "http://127.0.0.1:8642");
        await page.locator(".tile").first().waitFor();
        await page.locator("#idle-dim").tap();
        await page.getByRole("button", { name: "🧩 Puzzle", exact: true }).tap();
        if (!svgHits) await page.addStyleTag({ content: ".piece-hit { pointer-events: none !important; }" });

        const piece = page.locator("#puzzle-tray .puzzle-piece").first();
        const index = Number(await piece.getAttribute("data-index"));
        const from = await center(piece);
        if (!svgHits) {
          assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y).closest(".puzzle-piece"), from), null,
            "the regression case receives no native SVG piece hit");
        }
        await touch("touchStart", [{ ...from, id: 1 }]);
        assert.equal(await page.evaluate(() => puzzleDragCandidates.size), 1, "touching a piece registers pickup intent");
        await touch("touchMove", [{ x: from.x + 2, y: from.y, id: 1 }]);
        assert.equal(await page.locator(".puzzle-piece.dragging").count(), 0, "a resting finger does not carry a piece");
        await touch("touchCancel", []);
        assert.equal(await page.evaluate(() => puzzleDragCandidates.size), 0, "canceling a resting contact clears its intent");
        await touch("touchStart", [{ ...from, id: 1 }]);
        await touch("touchMove", [{ x: from.x + 8, y: from.y, id: 1 }]);
        await settle();
        assert.equal(await page.locator(".puzzle-piece.dragging").count(), 1, "a short intentional move picks the piece up");
        await glide(from, await center(slot((index + 1) % 9)));
        await touch("touchEnd", []);
        const dropped = page.locator(`.puzzle-piece.dropped[data-index="${index}"]`);
        await dropped.waitFor();
        await page.waitForTimeout(1000);
        const resting = await center(dropped);
        await touch("touchStart", [{ ...resting, id: 2 }]);
        await glide(resting, await center(slot(index)), 2);
        await touch("touchEnd", []);
        assert.equal(await page.locator(`.puzzle-slot.filled[data-index="${index}"]`).count(), 1, "the dropped piece can be picked up again and seated");

        while (await page.locator("#puzzle-tray .puzzle-piece").count()) {
          const next = page.locator("#puzzle-tray .puzzle-piece").first();
          const nextIndex = await next.getAttribute("data-index");
          const start = await center(next);
          await touch("touchStart", [{ ...start, id: 3 }]);
          await glide(start, await center(slot(nextIndex)), 3);
          await touch("touchEnd", []);
          assert.equal(await slot(nextIndex).locator(".puzzle-piece:disabled").count(), 1, `piece ${nextIndex} seats`);
        }
        assert.equal(await page.locator(".puzzle-slot.filled").count(), 9, "all nine pieces complete the puzzle");
        await page.locator("#puzzle-success").waitFor({ state: "visible" });
        await page.waitForTimeout(250);
        assert.equal(await page.locator(".drag-source, .dragging, .sliding, .arriving").count(), 0, "completion leaves no captured or hidden pieces");
        assert.deepEqual(errors, []);
        results.push({ svgHits, passed: true });
      } finally {
        await context.close();
      }
    }
    console.log(JSON.stringify({ passed: true, browser: browser.version(), results }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
