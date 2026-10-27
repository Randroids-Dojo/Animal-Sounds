"use strict";

const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 800, height: 1340 }, hasTouch: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const center = async (locator) => {
    const rect = await locator.boundingBox();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  };
  const touch = async (type, points) => cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: points.map((point) => ({ ...point, radiusX: 10, radiusY: 8, force: 1 })),
  });
  const checkAwake = async () => assert.equal(await page.locator("#idle-dim").isHidden(), true);
  try {
    await page.goto(process.argv[2] || "http://127.0.0.1:8642");
    await page.locator(".tile").first().waitFor();
    await page.evaluate(() => {
      window.playedAnimals = [];
      play = (animal) => window.playedAnimals.push(animal.name);
      window.lastTouchId = null;
      window.addEventListener("pointerdown", (event) => {
        if (event.pointerType === "touch") window.lastTouchId = event.pointerId;
      }, { capture: true });
    });

    // A wake contact and every extra finger in that gesture must be ignored.
    const horse = page.locator(".tile").first();
    const rabbit = page.locator(".tile").nth(1);
    const first = { ...await center(horse), id: 1 };
    const second = { ...await center(rabbit), id: 2 };
    await touch("touchStart", [first]);
    await checkAwake();
    await touch("touchStart", [first, second]);
    await touch("touchEnd", [first]);
    await page.waitForTimeout(130); // The animal-tap arbitration window.
    assert.deepEqual(await page.evaluate(() => window.playedAnimals), [], "extra finger cannot play an animal during wake");
    await touch("touchEnd", []);
    await rabbit.tap();
    await page.waitForFunction(() => window.playedAnimals.length === 1);
    assert.deepEqual(await page.evaluate(() => window.playedAnimals), ["Rabbit"], "next fresh tap works immediately");

    const puzzleTab = page.getByRole("button", { name: "🧩 Puzzle", exact: true });
    const tabPoint = await center(puzzleTab);
    await page.evaluate(() => showIdleDim());
    await page.touchscreen.tap(tabPoint.x, tabPoint.y);
    await checkAwake();
    assert.equal(await page.evaluate(() => document.body.dataset.page), "animals", "wake tap does not change tabs");
    // Some WebViews retarget a compatibility click after the dim layer hides.
    await page.evaluate(() => {
      document.querySelector('[data-page-target="puzzle"]').dispatchEvent(new PointerEvent("click", {
        bubbles: true, cancelable: true, detail: 1, pointerType: "touch", pointerId: window.lastTouchId,
      }));
    });
    assert.equal(await page.evaluate(() => document.body.dataset.page), "animals", "retargeted wake click is swallowed");
    await puzzleTab.tap();
    assert.equal(await page.evaluate(() => document.body.dataset.page), "puzzle", "next tap changes tabs");

    const piece = page.locator("#puzzle-tray .puzzle-piece").first();
    const pieceIndex = await piece.getAttribute("data-index");
    const piecePoint = { ...await center(piece), id: 3 };
    const slotPoint = { ...await center(page.locator(`.puzzle-slot[data-index="${pieceIndex}"]`)), id: 3 };
    await page.evaluate(() => showIdleDim());
    await touch("touchStart", [piecePoint]);
    await checkAwake();
    await touch("touchMove", [slotPoint]);
    await touch("touchEnd", []);
    assert.equal(await page.locator(".puzzle-piece.dragging, .drag-source, .dropped, .puzzle-slot.filled").count(), 0, "wake swipe leaves puzzle untouched");
    await touch("touchStart", [piecePoint]);
    await touch("touchMove", [slotPoint]);
    await touch("touchEnd", []);
    assert.equal(await page.locator(`.puzzle-slot.filled[data-index="${pieceIndex}"]`).count(), 1, "next gesture places the piece");

    // Cancellation must release the guard without waiting for a timeout.
    await page.evaluate(() => showIdleDim());
    await touch("touchStart", [{ ...await center(puzzleTab), id: 4 }]);
    await touch("touchCancel", []);
    const soundsTab = page.getByRole("button", { name: "🐾 Sounds", exact: true });
    await soundsTab.tap();
    assert.equal(await page.evaluate(() => document.body.dataset.page), "animals");

    // Mouse and keyboard activation retain the same wake-then-use behavior.
    await page.evaluate(() => showIdleDim());
    await page.mouse.click(tabPoint.x, tabPoint.y);
    await checkAwake();
    assert.equal(await page.evaluate(() => document.body.dataset.page), "animals");
    await page.mouse.click(tabPoint.x, tabPoint.y);
    assert.equal(await page.evaluate(() => document.body.dataset.page), "puzzle");
    await soundsTab.focus();
    await page.evaluate(() => showIdleDim());
    await page.keyboard.press("Enter");
    await checkAwake();
    assert.equal(await page.evaluate(() => document.body.dataset.page), "puzzle");
    await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(() => document.body.dataset.page), "animals");

    // The waking swipe must not pan the grid; the next swipe can scroll it.
    await page.evaluate(() => { window.scrollTo(0, 0); showIdleDim(); });
    for (const waking of [true, false]) {
      await touch("touchStart", [{ x: 400, y: 1100, id: 5 }]);
      for (let y = 1000; y >= 500; y -= 100) {
        await touch("touchMove", [{ x: 400, y, id: 5 }]);
      }
      await touch("touchEnd", []);
      if (waking) assert.equal(await page.evaluate(() => window.scrollY), 0, "wake swipe cannot scroll the grid");
      else await page.waitForFunction(() => window.scrollY > 0);
    }
    assert.deepEqual(errors, []);
    console.log("Wake-only gesture checks passed: multi-touch, delayed click, puzzle drag, cancellation, mouse, keyboard, and scrolling.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
