"use strict";

// Run against the local static server (or pass a deployed URL). Checks the
// puzzle layout on phones and the tablet, upright and counter-rotated: one row
// of tabs, a board as wide as the screen less a small margin, and a tray whose
// pieces all sit clear of the grip band. A tray piece grows to its seated size
// when picked up, and goes back to its tray size where it is put down. Rounds
// take turns between animals, dinosaurs, foods and robots, each on its own
// backdrop, and every picture and name recording they use loads.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MARGIN = 8;
const VIEWPORTS = [
  { label: "phone", width: 412, height: 800 },
  { label: "short phone", width: 412, height: 740 },
  { label: "small phone", width: 360, height: 740 },
  { label: "tablet", width: 800, height: 1340 },
  { label: "phone sideways", width: 800, height: 412, orientation: "landscapePrimary", angle: 90 },
];

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const evidence = fs.mkdtempSync(path.join(os.tmpdir(), "animal-puzzle-layout-"));
  const results = [];
  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: true });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      if (viewport.orientation) {
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: true,
          screenOrientation: { type: viewport.orientation, angle: viewport.angle },
        });
      }
      await page.goto(process.argv[2] || "http://127.0.0.1:8642");
      await page.locator(".tile").first().waitFor();
      await page.locator("#idle-dim").tap();
      await page.getByRole("button", { name: "🧩 Puzzle", exact: true }).tap();
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const label = `${viewport.label} ${viewport.width}x${viewport.height}`;
      await page.screenshot({ path: path.join(evidence, `${viewport.label.replace(/\s+/g, "-")}.png`) });

      // Everything is measured in the portrait play surface's coordinates.
      const layout = await page.evaluate(() => {
        const rect = (element) => puzzleRect(element);
        const tabs = [...document.querySelectorAll("#page-tabs button")].map(rect);
        const pieces = [...document.querySelectorAll("#puzzle-tray .puzzle-piece")].map(rect);
        return {
          play: { width: playViewport.width, height: playViewport.height },
          edge: safeEdge(),
          tabs,
          board: rect(document.getElementById("puzzle-board")),
          pieces,
          seated: seatedPieceSize(),
        };
      });
      const { play, edge, board, pieces, tabs } = layout;
      const sameRow = tabs.every((tab) => Math.abs(tab.top - tabs[0].top) < 1);
      const metrics = {
        label,
        boardPx: Math.round(board.width),
        marginsPx: [Math.round(board.left), Math.round(play.width - board.left - board.width)],
        trayPiecePx: Math.round(pieces[0].width),
        seatedPiecePx: Math.round(layout.seated),
        lowestPiecePx: Math.round(Math.max(...pieces.map((piece) => piece.top + piece.height))),
        bottomBandPx: play.height - edge,
      };
      assert.ok(sameRow, `${label}: the six tabs fit in one row`);
      assert.ok(Math.abs(board.width - (play.width - 2 * MARGIN)) < 1, `${label}: the board spans the screen less ${MARGIN} px: ${board.width}`);
      assert.ok(Math.abs(metrics.marginsPx[0] - metrics.marginsPx[1]) <= 1, `${label}: the board is centered`);
      for (const piece of pieces) {
        assert.ok(piece.left >= edge - 0.5 && piece.left + piece.width <= play.width - edge + 0.5, `${label}: tray pieces clear the side bands`);
        assert.ok(piece.top >= board.top + board.height, `${label}: tray pieces sit below the board`);
        assert.ok(piece.top + piece.height <= play.height - edge + 0.5, `${label}: tray pieces clear the bottom band`);
      }
      assert.ok(pieces[0].width >= 48, `${label}: tray pieces are big enough to grab: ${pieces[0].width}`);

      if (!viewport.orientation) {
        // Pick a piece up by its center, carry it a little, and put it down
        // over the tray, away from every spot on the board.
        const piece = page.locator("#puzzle-tray .puzzle-piece").first();
        const index = await piece.getAttribute("data-index");
        const box = await piece.boundingBox();
        const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        const to = { x: from.x + box.width * 0.6, y: from.y + 6 };
        const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", {
          type, touchPoints: points.map((point) => ({ ...point, id: 1, radiusX: 10, radiusY: 8, force: 1 })),
        });
        await touch("touchStart", [from]);
        for (let step = 1; step <= 6; step += 1) {
          await touch("touchMove", [{ x: from.x + (to.x - from.x) * step / 6, y: from.y + (to.y - from.y) * step / 6 }]);
        }
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const carried = await page.locator(".puzzle-piece.dragging").evaluate((ghost) => parseFloat(ghost.style.width));
        await touch("touchEnd", []);
        const dropped = page.locator(`.puzzle-piece.dropped[data-index="${index}"]`);
        await dropped.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
        const rest = await dropped.boundingBox();
        metrics.carriedPx = Math.round(carried);
        assert.ok(Math.abs(carried - layout.seated) < 1, `${label}: a picked-up piece grows to its seated size: ${carried}`);
        assert.ok(Math.abs(rest.width - box.width) < 1, `${label}: a put-down piece goes back to its tray size: ${rest.width}`);
        assert.ok(Math.hypot(rest.x + rest.width / 2 - to.x, rest.y + rest.height / 2 - to.y) < 1, `${label}: it rests where the finger let go`);
        assert.equal(await page.locator(".puzzle-slot.filled").count(), 0, `${label}: nothing seats from the tray`);
      }
      if (viewport.label === "phone") {
        const rounds = await page.evaluate(async () => {
          const played = [];
          for (let round = 0; round < 12; round += 1) {
            newPuzzle();
            const art = document.querySelector("#puzzle-board .puzzle-guide image").getAttribute("href");
            const voice = voicePath(currentPuzzle.name);
            played.push({
              name: currentPuzzle.name,
              kind: currentPuzzle.kind || "animal",
              backdrop: document.querySelector("#puzzle-board .puzzle-guide use").getAttribute("href"),
              pieceBackdrops: [...document.querySelectorAll("#puzzle-tray .puzzle-piece use")].map((use) => use.getAttribute("href")),
              title: document.getElementById("puzzle-name").textContent,
              artLoads: (await fetch(art)).ok,
              voiceLoads: (await fetch(voice)).ok,
            });
          }
          return played;
        });
        for (let i = 0; i < rounds.length; i += 1) {
          const round = rounds[i];
          assert.equal(round.backdrop, `#puzzle-scene-${round.kind}`, `${round.name} uses its kind's backdrop`);
          assert.ok(round.pieceBackdrops.every((href) => href === round.backdrop), `${round.name}: every piece shares it`);
          assert.match(round.title, /^Build (a|an|some) .+!$/);
          assert.ok(round.artLoads && round.voiceLoads, `${round.name}: picture and recording load`);
          if (i) assert.notEqual(round.kind, rounds[i - 1].kind, "no kind twice in a row");
        }
        assert.equal(new Set(rounds.map((round) => round.kind)).size, 4, "all four kinds come up");
        metrics.rounds = rounds.map((round) => round.title).join(" | ");
      }
      assert.deepEqual(errors, []);
      results.push(metrics);
      await context.close();
    }
    console.log(JSON.stringify({ passed: true, evidence, results }, null, 2));
  } catch (error) {
    console.error(evidence, JSON.stringify(results));
    throw error;
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
