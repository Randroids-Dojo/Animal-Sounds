"use strict";

// Run against the local static server (or pass a deployed URL). Real CDP
// touch input drives several puzzle fingers at once, and the wrong-slot
// feedback is sampled every frame rather than judged from one screenshot.
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
  const evidence = fs.mkdtempSync(path.join(os.tmpdir(), "animal-puzzle-multitouch-"));
  const center = async (locator) => {
    const rect = await locator.boundingBox();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  };
  // touchEnd lifts only the listed fingers; an empty list lifts them all.
  const touch = async (type, points) => cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: points.map((point) => ({ ...point, radiusX: 10, radiusY: 8, force: 1 })),
  });
  // Chrome delivers touch moves on the next frame, after CDP has returned.
  const settle = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const between = (from, to, t) => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  const trayPiece = (nth) => page.locator("#puzzle-tray .puzzle-piece").nth(nth);
  const slotFor = (index) => page.locator(`.puzzle-slot[data-index="${index}"]`);
  const ghosts = () => page.locator(".puzzle-piece.dragging");
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
    await page.waitForFunction((expected) => playViewport.rotation === expected, portrait ? 0 : 90);
    await page.evaluate(() => new Promise(requestAnimationFrame));
  };

  async function dragTwoAtOnce(label) {
    const first = trayPiece(0);
    const second = trayPiece(1);
    const firstIndex = await first.getAttribute("data-index");
    const secondIndex = await second.getAttribute("data-index");
    const from = [await center(first), await center(second)];
    const to = [await center(slotFor(firstIndex)), await center(slotFor(secondIndex))];
    await touch("touchStart", [{ ...from[0], id: 1 }]);
    await touch("touchStart", [{ ...from[0], id: 1 }, { ...from[1], id: 2 }]);
    for (let step = 1; step <= 10; step += 1) {
      const t = step / 10;
      await touch("touchMove", [{ ...between(from[0], to[0], t), id: 1 }, { ...between(from[1], to[1], t), id: 2 }]);
      if (step === 5) {
        await settle();
        assert.equal(await ghosts().count(), 2, `${label}: both fingers carry a piece`);
        const centers = await Promise.all([0, 1].map((nth) => center(ghosts().nth(nth))));
        for (const finger of [between(from[0], to[0], t), between(from[1], to[1], t)]) {
          assert.ok(centers.some((ghost) => Math.hypot(ghost.x - finger.x, ghost.y - finger.y) < 1), `${label}: each ghost follows its own finger`);
        }
        await page.screenshot({ path: path.join(evidence, `${label}-two-fingers.png`) });
      }
    }
    await settle();
    // Lift only the first finger; the second keeps its piece.
    await touch("touchEnd", [{ ...to[0], id: 1 }]);
    await settle();
    assert.equal(await page.locator(`.puzzle-slot.filled[data-index="${firstIndex}"]`).count(), 1, `${label}: first finger places its piece`);
    assert.equal(await ghosts().count(), 1, `${label}: second finger is still dragging`);
    const nudged = { x: to[1].x + 4, y: to[1].y + 4 };
    await touch("touchMove", [{ ...nudged, id: 2 }]);
    await settle();
    const ghost = await center(ghosts().first());
    assert.ok(Math.hypot(ghost.x - nudged.x, ghost.y - nudged.y) < 1, `${label}: second piece keeps tracking after the first lift`);
    await touch("touchEnd", []);
    await settle();
    assert.equal(await page.locator(`.puzzle-slot.filled[data-index="${secondIndex}"]`).count(), 1, `${label}: second finger places its piece`);
    assert.equal(await page.locator(".puzzle-piece.dragging, .drag-source").count(), 0, `${label}: no drag state remains`);
  }

  try {
    await page.goto(process.argv[2] || "http://127.0.0.1:8642");
    await page.locator(".tile").first().waitFor();
    await page.locator("#idle-dim").tap();
    await page.getByRole("button", { name: "🧩 Puzzle", exact: true }).tap();

    await dragTwoAtOnce("portrait");
    await rotate("landscapePrimary", 90);
    await dragTwoAtOnce("landscape");
    await rotate("portraitPrimary", 0);

    // Leave a piece on someone else's empty slot and sample each frame.
    const piece = trayPiece(0);
    const index = await piece.getAttribute("data-index");
    const wrongIndex = await page.locator(".puzzle-slot:not(.filled)").evaluateAll(
      (slots, own) => slots.map((slot) => slot.dataset.index).find((value) => value !== own), index);
    const start = await center(piece);
    const release = await center(slotFor(wrongIndex));
    await touch("touchStart", [{ ...start, id: 3 }]);
    for (let step = 1; step <= 8; step += 1) await touch("touchMove", [{ ...between(start, release, step / 8), id: 3 }]);
    await settle();
    await page.evaluate((pieceIndex) => {
      const target = document.querySelector(`.puzzle-piece[data-index="${pieceIndex}"]:not(.dragging)`);
      window.mismatchFrames = [];
      const began = performance.now();
      const sample = () => {
        const style = getComputedStyle(target);
        const matrix = style.transform === "none" ? null : new DOMMatrixReadOnly(style.transform);
        const reds = [...style.boxShadow.matchAll(/rgba\(232, 80, 80, ([\d.]+)\)/g)].map((match) => Number(match[1]));
        window.mismatchFrames.push({
          t: performance.now() - began,
          mismatch: target.classList.contains("mismatch"),
          dx: matrix ? matrix.e : 0,
          dy: matrix ? matrix.f : 0,
          glow: reds.length ? Math.max(...reds) : 0,
        });
        if (performance.now() - began < 1600) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }, index);
    await touch("touchEnd", []);
    await page.waitForTimeout(140);
    await page.screenshot({ path: path.join(evidence, "mismatch-glow.png") });
    await page.waitForFunction(() => window.mismatchFrames.at(-1).t >= 1600);
    const frames = await page.evaluate(() => window.mismatchFrames);
    const shown = frames.filter((frame) => frame.mismatch);
    assert.ok(shown.length, "wrong slot triggers the mismatch feedback");
    const startedAt = shown[0].t;
    const after = (ms) => frames.filter((frame) => frame.t - startedAt >= ms);
    const peakShake = Math.max(...shown.map((frame) => Math.abs(frame.dx)));
    const peakGlow = Math.max(...shown.map((frame) => frame.glow));
    const directionChanges = shown.reduce((count, frame, nth) => {
      const previous = shown[nth - 1];
      return count + (previous && Math.sign(previous.dx) && Math.sign(frame.dx) && Math.sign(previous.dx) !== Math.sign(frame.dx) ? 1 : 0);
    }, 0);
    const metrics = {
      peakShakePx: Number(peakShake.toFixed(2)),
      directionChanges,
      peakGlowAlpha: Number(peakGlow.toFixed(3)),
      verticalDriftPx: Math.max(...shown.map((frame) => Math.abs(frame.dy))),
      stillShakingAt450ms: after(450).some((frame) => Math.abs(frame.dx) > 0.01),
      glowAt600ms: Number((after(600)[0]?.glow ?? 0).toFixed(3)),
      feedbackMs: Math.round(shown.at(-1).t - startedAt),
      frames: frames.length,
    };
    assert.ok(peakShake >= 3 && peakShake <= 6, `shake is slight but visible: ${peakShake}px`);
    assert.ok(directionChanges >= 2, "piece shakes back and forth");
    assert.equal(metrics.verticalDriftPx, 0, "shake stays horizontal");
    assert.equal(metrics.stillShakingAt450ms, false, "shake is brief");
    assert.ok(peakGlow >= 0.3 && peakGlow <= 0.45, `glow is faint red: ${peakGlow}`);
    assert.ok(metrics.glowAt600ms > 0 && metrics.glowAt600ms < peakGlow, "glow fades out gradually");
    assert.ok(metrics.feedbackMs >= 800 && metrics.feedbackMs <= 1000, `glow ends after about 0.9 s: ${metrics.feedbackMs}`);
    assert.equal(frames.at(-1).glow, 0, "no red remains afterward");
    const resting = await center(page.locator(`.puzzle-piece.dropped[data-index="${index}"]`));
    assert.ok(Math.hypot(resting.x - release.x, resting.y - release.y) < 1, "piece stays where it was left");
    assert.equal(await slotFor(wrongIndex).evaluate((slot) => slot.classList.contains("filled")), false, "wrong slot stays empty");

    // The same piece can still go home afterward.
    await touch("touchStart", [{ ...resting, id: 4 }]);
    const home = await center(slotFor(index));
    for (let step = 1; step <= 8; step += 1) await touch("touchMove", [{ ...between(resting, home, step / 8), id: 4 }]);
    await settle();
    await touch("touchEnd", []);
    await settle();
    assert.equal(await page.locator(`.puzzle-slot.filled[data-index="${index}"]`).count(), 1, "mismatched piece still fits its own slot");

    // Finish the round two pieces at a time.
    while (await page.locator("#puzzle-tray .puzzle-piece").count() >= 2) await dragTwoAtOnce("finish");
    const last = trayPiece(0);
    if (await last.count()) {
      const lastIndex = await last.getAttribute("data-index");
      const from = await center(last);
      const to = await center(slotFor(lastIndex));
      await touch("touchStart", [{ ...from, id: 5 }]);
      for (let step = 1; step <= 8; step += 1) await touch("touchMove", [{ ...between(from, to, step / 8), id: 5 }]);
      await settle();
      await touch("touchEnd", []);
    }
    await page.locator("#puzzle-success").waitFor({ state: "visible" });
    assert.equal(await page.locator(".puzzle-slot.filled").count(), 9);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, evidence, mismatch: metrics }, null, 2));
  } catch (error) {
    await page.screenshot({ path: path.join(evidence, "failure.png") });
    console.error(evidence);
    throw error;
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
