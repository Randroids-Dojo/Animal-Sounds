"use strict";

// Run against the local static server (or pass a deployed URL). Real CDP
// touches check that the grip band around every page ignores taps, swipes,
// drags, and wake taps, while content just inside it keeps working.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");

const W = 800;
const H = 1340;
const PAGES = ["animals", "dinosaurs", "foods", "alphabet", "lessons", "puzzle"];

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // touchEnd lifts only the listed fingers; an empty list lifts them all.
  const touch = async (type, points) => cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: points.map((point) => ({ ...point, radiusX: 10, radiusY: 8, force: 1 })),
  });
  // Chrome delivers touch moves on the next frame, after CDP has returned.
  const settle = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const tap = async (point, id = 1) => {
    await touch("touchStart", [{ ...point, id }]);
    await touch("touchEnd", [{ ...point, id }]);
    await page.waitForTimeout(150); // The animal-tap arbitration window.
  };
  const swipe = async (from, to, id = 2, held = []) => {
    await touch("touchStart", [...held, { ...from, id }]);
    for (let step = 1; step <= 10; step += 1) {
      const t = step / 10;
      await touch("touchMove", [...held, { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, id }]);
    }
    await touch("touchEnd", [{ ...to, id }]);
    await page.waitForTimeout(300);
  };
  const center = async (locator) => {
    const rect = await locator.boundingBox();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  };
  const state = () => page.evaluate(() => ({
    page: document.body.dataset.page,
    played: window.played.slice(),
    scrollY: Math.round(scrollY),
    drags: puzzleDrags.size + puzzleDragCandidates.size,
    dropped: document.querySelectorAll(".puzzle-piece.dropped").length,
    dimmed: !idleDim.hidden,
  }));

  try {
    await page.goto(process.argv[2] || "http://127.0.0.1:8642");
    await page.locator(".tile").first().waitFor();
    const S = await page.evaluate(() => safeEdge());
    assert.ok(S >= 40, `band is wide enough for a grip: ${S}px`);
    const inBand = [
      { x: S / 2, y: S / 2 }, { x: W / 2, y: S / 2 }, { x: W - S / 2, y: S / 2 },
      { x: S / 2, y: H / 2 }, { x: W - S / 2, y: H / 2 },
      { x: S / 2, y: H - S / 2 }, { x: W / 2, y: H - S / 2 }, { x: W - S / 2, y: H - S / 2 },
      { x: S - 2, y: H / 3 }, { x: W - S + 2, y: (2 * H) / 3 },
    ];
    const grip = { x: S / 2, y: H / 2, id: 7 };

    // Grip contacts cannot wake the dimmed screen; a tap inside the band can.
    await page.evaluate(() => {
      window.played = [];
      // Alphabet entries carry their tile instead of a name.
      play = (entry) => window.played.push(entry.tile?.querySelector(".tile-name").textContent ?? entry.name);
      showIdleDim();
    });
    for (const point of inBand) await tap(point);
    assert.equal((await state()).dimmed, true, "band taps leave the screen dimmed");
    await tap({ x: W / 2, y: H / 2 });
    assert.equal((await state()).dimmed, false, "a tap inside the band wakes the screen");

    for (const target of PAGES) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await tap(await center(page.locator(`[data-page-target="${target}"]`)));
      assert.equal((await state()).page, target, `${target}: its tab works`);

      const layout = await page.evaluate((edge) => {
        const misses = [];
        for (let i = 0; i <= 40; i += 1) {
          const f = i / 40;
          for (const [x, y] of [[f * (innerWidth - 1), 1], [f * (innerWidth - 1), innerHeight - 2], [1, f * (innerHeight - 1)],
            [innerWidth - 2, f * (innerHeight - 1)], [f * (innerWidth - 1), edge - 1], [edge - 1, f * (innerHeight - 1)],
            [innerWidth - edge, f * (innerHeight - 1)], [f * (innerWidth - 1), innerHeight - edge]]) {
            if (!document.elementFromPoint(x, y)?.parentElement?.matches("#safe-area")) misses.push([Math.round(x), Math.round(y)]);
          }
        }
        const screen = document.querySelector(".app-screen:not([inert])");
        // The puzzle board may reach under the band: it never takes a touch,
        // and pieces seat by their own center. Tray pieces must stay clear.
        const controls = [...document.querySelectorAll("#page-tabs button"), ...screen.querySelectorAll("button, summary")];
        const intruders = controls.map((element) => [element, element.getBoundingClientRect()])
          .filter(([, rect]) => rect.width && (rect.left < edge || rect.right > innerWidth - edge || rect.top + scrollY < edge))
          .map(([element]) => element.className || element.tagName);
        const lastBottom = Math.max(...controls.map((element) => element.getBoundingClientRect().bottom + scrollY));
        return { misses, intruders, reachable: lastBottom <= document.documentElement.scrollHeight - edge };
      }, S);
      assert.deepEqual(layout.misses, [], `${target}: every edge point lands on the band`);
      assert.deepEqual(layout.intruders, [], `${target}: no control sits in the band`);
      assert.ok(layout.reachable, `${target}: the last control scrolls clear of the band`);

      const before = await state();
      for (const point of inBand) await tap(point);
      await swipe({ x: S / 2, y: H - 200 }, { x: S / 2, y: 300 });
      await swipe({ x: W - S / 2, y: H - 200 }, { x: W - S / 2, y: 300 });
      assert.deepEqual(await state(), before, `${target}: band taps and swipes do nothing`);
    }

    // Scrolling pages: the same tile ignores the band but answers just above it.
    for (const target of ["animals", "dinosaurs", "foods", "alphabet"]) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await tap(await center(page.locator(`[data-page-target="${target}"]`)));
      // The first tile below the fold, scrolled up until 30px clear the band.
      const nth = await page.evaluate(() => [...document.querySelectorAll(".app-screen:not([inert]) .tile")]
        .findIndex((element) => element.getBoundingClientRect().top > innerHeight));
      const tile = page.locator(".app-screen:not([inert]) .tile").nth(nth);
      const name = await tile.evaluate((element, [edge, height]) => {
        window.scrollTo(0, element.getBoundingClientRect().top + scrollY - (height - edge - 30));
        return element.querySelector(".tile-name").textContent;
      }, [S, H]);
      await settle();
      const rect = await tile.boundingBox();
      assert.ok(Math.abs(rect.y - (H - S - 30)) < 1, `${target}: tile straddles the bottom band`);
      const x = rect.x + rect.width / 2;
      await tap({ x, y: H - S / 2 });
      assert.deepEqual((await state()).played, [], `${target}: the tile part under the band is inert`);
      await tap({ x, y: H - S - 15 });
      assert.equal((await state()).played.at(-1), name, `${target}: the visible part above the band still plays`);
      await page.evaluate(() => { window.played = []; });
    }

    // A hand holding the edge does not block tapping or scrolling elsewhere.
    await page.evaluate(() => window.scrollTo(0, 0));
    await tap(await center(page.locator('[data-page-target="animals"]')));
    const firstTile = page.locator("#grid .tile").first();
    const firstName = await firstTile.locator(".tile-name").textContent();
    await touch("touchStart", [grip]);
    const tilePoint = await center(firstTile);
    await touch("touchStart", [grip, { ...tilePoint, id: 8 }]);
    await touch("touchEnd", [{ ...tilePoint, id: 8 }]);
    await page.waitForTimeout(150);
    await touch("touchEnd", [grip]);
    await page.waitForTimeout(150);
    assert.deepEqual((await state()).played, [firstName], "a grip does not block an animal tap");
    await touch("touchStart", [grip]);
    await swipe({ x: W / 2, y: H - 200 }, { x: W / 2, y: 300 }, 9, [grip]);
    await touch("touchEnd", [grip]);
    const gripScroll = (await state()).scrollY;
    assert.ok(gripScroll > 150, `a grip does not stop another finger scrolling: ${gripScroll}px`);

    // Puzzle: a grip cannot claim pieces, and loose pieces stay clear of the band.
    await page.evaluate(() => window.scrollTo(0, 0));
    await tap(await center(page.locator('[data-page-target="puzzle"]')));
    const piece = page.locator("#puzzle-tray .puzzle-piece").first();
    const index = await piece.getAttribute("data-index");
    await touch("touchStart", [grip]);
    await swipe(await center(piece), await center(page.locator(`.puzzle-slot[data-index="${index}"]`)), 3, [grip]);
    await touch("touchEnd", [grip]);
    assert.equal(await page.locator(`.puzzle-slot.filled[data-index="${index}"]`).count(), 1, "a grip does not block a puzzle drag");

    for (const [orientation, angle] of [["portraitPrimary", 0], ["landscapePrimary", 90]]) {
      const portrait = orientation.startsWith("portrait");
      const width = portrait ? W : H;
      const height = portrait ? H : W;
      await page.setViewportSize({ width, height });
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width, height, deviceScaleFactor: 1, mobile: true, screenOrientation: { type: orientation, angle },
      });
      await page.waitForFunction((rotation) => playViewport.rotation === rotation, portrait ? 0 : 90);
      await settle();
      for (const corner of [{ x: 4, y: 4 }, { x: width - 4, y: height - 4 }, { x: 4, y: height - 4 }, { x: width - 4, y: 4 }]) {
        const loose = page.locator("#puzzle-tray .puzzle-piece").first();
        const looseIndex = await loose.getAttribute("data-index");
        await swipe(await center(loose), corner, 4);
        const dropped = page.locator(`.puzzle-piece.dropped[data-index="${looseIndex}"]`);
        // Wait out the shrink back to its resting size.
        await dropped.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
        const rect = await dropped.boundingBox();
        assert.ok(rect.x >= S - 0.5 && rect.y >= S - 0.5 && rect.x + rect.width <= width - S + 0.5 && rect.y + rect.height <= height - S + 0.5,
          `${orientation}: a piece released in the band rests clear of it ${JSON.stringify(rect)}`);
      }
    }

    // The video's hold-to-close button sits inside the band.
    const close = await page.evaluate(() => {
      overlay.hidden = false;
      const rect = document.getElementById("close-btn").getBoundingClientRect();
      overlay.hidden = true;
      return { top: rect.top, right: innerWidth - rect.right };
    });
    assert.ok(close.top >= S && close.right >= S, `close button clears the band: ${JSON.stringify(close)}`);

    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, safeEdge: S, pages: PAGES.length, gripScroll }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
