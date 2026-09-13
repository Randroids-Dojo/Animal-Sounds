"use strict";

// Run against the local static server (or pass a deployed URL). Playwright
// uses real browser layout and pointer input, including both rotation angles.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 800, height: 1340 }, hasTouch: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const evidence = fs.mkdtempSync(path.join(os.tmpdir(), "animal-puzzle-portrait-"));
  const center = async (locator) => {
    const rect = await locator.boundingBox();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  };
  const move = async (point) => page.mouse.move(point.x, point.y, { steps: 8 });
  const rotate = async (type, angle) => {
    const portrait = type.startsWith("portrait");
    await page.setViewportSize({ width: portrait ? 800 : 1340, height: portrait ? 1340 : 800 });
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: portrait ? 800 : 1340,
      height: portrait ? 1340 : 800,
      deviceScaleFactor: 1,
      mobile: true,
      screenOrientation: { type, angle },
    });
    await page.waitForFunction((expected) => playViewport.width === 800 && playViewport.height === 1340
      && playViewport.rotation === expected, portrait ? 0 : (angle === 90 ? 90 : -90));
    await page.evaluate(() => new Promise(requestAnimationFrame));
  };
  const geometry = async () => page.evaluate(() => {
    const rect = (id) => {
      const { x, y, width, height } = document.getElementById(id).getBoundingClientRect();
      return { x, y, width, height };
    };
    return { board: rect("puzzle-board"), tray: rect("puzzle-tray"), rotation: playViewport.rotation };
  });
  try {
    await page.goto(process.argv[2] || "http://127.0.0.1:8642");
    await page.locator(".tile").first().waitFor();
    await page.locator("#idle-dim").tap();
    await page.getByRole("button", { name: "🧩 Puzzle", exact: true }).tap();
    const baseline = await geometry();
    assert.equal(baseline.rotation, 0);
    await page.screenshot({ path: path.join(evidence, "portrait.png") });

    for (const [type, angle, rotation] of [["landscapePrimary", 90, 90], ["landscapeSecondary", 270, -90]]) {
      await rotate(type, angle);
      const layout = await geometry();
      assert.equal(layout.rotation, rotation);
      assert.ok(Math.abs(layout.board.width - baseline.board.width) < 1, "board keeps its portrait size");
      for (const rect of [layout.board, layout.tray]) {
        assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 1340 && rect.y + rect.height <= 800, "all pieces fit onscreen");
      }
      assert.ok(rotation === 90 ? layout.board.x > layout.tray.x : layout.board.x < layout.tray.x, "surface counter-rotates with the device");

      const piece = page.locator("#puzzle-tray .puzzle-piece").first();
      const index = await piece.getAttribute("data-index");
      const start = await center(piece);
      await move(start);
      await page.mouse.down();
      const loosePoint = { x: rotation === 90 ? 80 : 1260, y: 400 };
      await move(loosePoint);
      const ghostCenter = await center(page.locator(".puzzle-piece.dragging"));
      assert.ok(Math.hypot(ghostCenter.x - loosePoint.x, ghostCenter.y - loosePoint.y) < 1, "ghost follows the finger in landscape");
      await page.mouse.up();
      const dropped = page.locator(`.puzzle-piece.dropped[data-index="${index}"]`);
      const droppedCenter = await center(dropped);
      assert.ok(Math.hypot(droppedCenter.x - loosePoint.x, droppedCenter.y - loosePoint.y) < 1, "loose piece stays where released");
      await move(droppedCenter);
      await page.mouse.down();
      await move(await center(page.locator(`.puzzle-slot[data-index="${index}"]`)));
      await page.mouse.up();
      assert.equal(await page.locator(`.puzzle-slot.filled[data-index="${index}"]`).count(), 1, "matching slot accepts the piece");
      await page.screenshot({ path: path.join(evidence, `${type}.png`) });
    }

    const filledBefore = await page.locator(".puzzle-slot.filled").count();
    const heldPiece = page.locator("#puzzle-tray .puzzle-piece").first();
    await move(await center(heldPiece));
    await page.mouse.down();
    await rotate("portraitPrimary", 0);
    await page.mouse.up();
    assert.equal(await page.locator(".puzzle-piece.dragging, .drag-source").count(), 0, "rotation cancels an active drag cleanly");
    assert.equal(await page.locator(".puzzle-slot.filled").count(), filledBefore, "rotation preserves placed pieces");

    await rotate("landscapePrimary", 90);
    while (await page.locator("#puzzle-tray .puzzle-piece").count()) {
      const piece = page.locator("#puzzle-tray .puzzle-piece").first();
      const index = await piece.getAttribute("data-index");
      await move(await center(piece));
      await page.mouse.down();
      await move(await center(page.locator(`.puzzle-slot[data-index="${index}"]`)));
      await page.mouse.up();
      assert.equal(await page.locator(`.puzzle-slot.filled[data-index="${index}"]`).count(), 1, `remaining piece ${index} reaches its slot`);
    }
    assert.equal(await page.locator(".puzzle-slot.filled").count(), 9);
    await page.locator("#puzzle-success").waitFor({ state: "visible" });
    await page.screenshot({ path: path.join(evidence, "completed.png") });

    await page.getByRole("button", { name: "🐾 Sounds", exact: true }).tap();
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).transform), "none", "Sounds returns to normal orientation");
    assert.equal(await page.evaluate(() => pages.getBoundingClientRect().left), 0);
    const touchResults = await page.evaluate(fs.readFileSync(path.join(__dirname, "browser-touch-intent.js"), "utf8"));
    assert.ok(touchResults.passed, JSON.stringify(touchResults));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, evidence, touchChecks: touchResults.results.length }, null, 2));
  } catch (error) {
    await page.screenshot({ path: path.join(evidence, "failure.png") });
    console.error(evidence, await page.evaluate(() => ({ viewport: playViewport, filled: puzzlePlaced, dropped: [...document.querySelectorAll(".dropped")].map(p => p.dataset.index) })));
    throw error;
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
