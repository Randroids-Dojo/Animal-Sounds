"use strict";

// Run against the local static server (or pass a deployed URL). Checks the
// jigsaw itself with real touch input: only a piece's shape can be grabbed, a
// piece lands where its own center is (even when carried by a knob), it slides
// into place, and a finished puzzle is one seamless picture. The seam check
// compares pixels and first proves it can see a piece moved 6 px. Every
// recording's play, pause and end is logged, so the animal's name is checked
// for being spoken after the chime, to the end, before the next round.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  // VIEWPORT=412x800 runs the same checks at phone size. PUZZLE=dinosaur (or
  // animal, food, robot) plays a picture of that kind.
  const [width, height] = (process.env.VIEWPORT || "800x1340").split("x").map(Number);
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const evidence = fs.mkdtempSync(path.join(os.tmpdir(), "animal-puzzle-jigsaw-"));
  const center = async (locator) => {
    const rect = await locator.boundingBox();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  };
  const touch = async (type, points) => cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: points.map((point) => ({ ...point, radiusX: 10, radiusY: 8, force: 1 })),
  });
  const settle = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const between = (from, to, t) => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  const drag = async (from, to, id = 1) => {
    await touch("touchStart", [{ ...from, id }]);
    for (let step = 1; step <= 8; step += 1) await touch("touchMove", [{ ...between(from, to, step / 8), id }]);
    await settle();
    await touch("touchEnd", []);
    await settle();
  };
  const slotFor = (index) => page.locator(`.puzzle-slot[data-index="${index}"]`);

  // Picture pixels inside the board's frame, read back from a screenshot.
  async function boardPixels() {
    const box = await page.evaluate(() => {
      const board = document.getElementById("puzzle-board").getBoundingClientRect();
      const border = parseFloat(getComputedStyle(document.getElementById("puzzle-board")).borderTopWidth);
      return { x: board.x + border, y: board.y + border, width: board.width - 2 * border, height: board.height - 2 * border };
    });
    const clip = { x: Math.ceil(box.x), y: Math.ceil(box.y), width: Math.floor(box.width) - 1, height: Math.floor(box.height) - 1 };
    const png = await page.screenshot({ clip });
    return page.evaluate(async ({ data, width, height }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = Object.assign(document.createElement("canvas"), { width, height });
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      return Array.from(context.getImageData(0, 0, width, height).data);
    }, { data: png.toString("base64"), width: clip.width, height: clip.height }).then((pixels) => ({ pixels, ...clip }));
  }

  function differingPixels(a, b, threshold) {
    let count = 0;
    for (let i = 0; i < a.width * a.height; i += 1) {
      let delta = 0;
      for (let channel = 0; channel < 3; channel += 1) delta = Math.max(delta, Math.abs(a.pixels[i * 4 + channel] - b.pixels[i * 4 + channel]));
      if (delta > threshold) count += 1;
    }
    return count;
  }

  // Pixels unlike every reference pixel within one pixel of them. Each piece
  // is snapped to whole pixels on its own, so its straight outlines may sit
  // up to a pixel off the whole picture; anything farther is a misplaced piece.
  function misplacedPixels(a, reference, threshold) {
    const { width, height } = a;
    let count = 0;
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const i = (y * width + x) * 4;
        let matched = false;
        for (let dy = -1; dy <= 1 && !matched; dy += 1) {
          for (let dx = -1; dx <= 1 && !matched; dx += 1) {
            const j = ((y + dy) * width + x + dx) * 4;
            let delta = 0;
            for (let channel = 0; channel < 3; channel += 1) delta = Math.max(delta, Math.abs(a.pixels[i + channel] - reference.pixels[j + channel]));
            matched = delta <= threshold;
          }
        }
        if (!matched) count += 1;
      }
    }
    return count;
  }

  // Seated pieces must hide the board completely: any pixel whose color
  // changes with the backdrop behind them is a gap.
  async function seeThrough() {
    const board = page.locator("#puzzle-board");
    await board.evaluate((element) => { element.style.background = "#F0F"; });
    await settle();
    const magenta = await boardPixels();
    await board.evaluate((element) => { element.style.background = "#0F0"; });
    await settle();
    const green = await boardPixels();
    return { magenta, gaps: differingPixels(magenta, green, 12) };
  }

  await page.addInitScript(() => {
    window.speechLog = [];
    const log = (entry) => window.speechLog.push({ ...entry, t: performance.now() });
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      const src = this.getAttribute("src");
      if (!this.speechLogged) {
        this.speechLogged = true;
        for (const event of ["playing", "pause", "ended"]) {
          this.addEventListener(event, () => log({ event, src, at: this.currentTime, duration: this.duration }));
        }
      }
      log({ event: "play", src });
      return play.apply(this, args);
    };
    const speak = speechSynthesis.speak.bind(speechSynthesis);
    speechSynthesis.speak = (utterance) => {
      log({ event: "fallback", text: utterance.text });
      speak(utterance);
    };
  });

  try {
    await page.goto(process.argv[2] || "http://127.0.0.1:8642");
    await page.locator(".tile").first().waitFor();
    await page.locator("#idle-dim").tap();
    await page.getByRole("button", { name: "🧩 Puzzle", exact: true }).tap();
    if (process.env.PUZZLE) {
      // PUZZLE=robot:Robot Cat picks one picture.
      await page.evaluate(([kind, name]) => {
        const pictures = puzzleDeck.collections[kind].filter((picture) => !name || picture.name === name);
        newPuzzle(pictures[Math.floor(Math.random() * pictures.length)]);
      }, process.env.PUZZLE.split(":"));
    }
    const picture = await page.evaluate(() => ({ name: currentPuzzle.name, kind: currentPuzzle.kind || "animal" }));
    await settle();
    await page.screenshot({ path: path.join(evidence, "round.png") });

    assert.equal(await page.locator("#puzzle-cuts mask").count(), 9, "one cut shape per piece");
    assert.equal(await page.locator("#puzzle-tray .puzzle-piece svg [mask]").count(), 9, "each piece shows only its own cut");
    assert.equal(await page.locator("#puzzle-board .slot-edge").count(), 9, "the board outlines every piece");

    // Find a tray piece with a knob, and that knob's tip on screen.
    const knob = await page.evaluate(() => {
      const span = parseFloat(getComputedStyle(document.getElementById("puzzle-screen")).getPropertyValue("--piece-span"));
      let best = null;
      for (const piece of document.querySelectorAll("#puzzle-tray .puzzle-piece")) {
        const edge = piece.querySelector(".piece-edge");
        const matrix = edge.getScreenCTM();
        const box = piece.getBoundingClientRect();
        const cx = box.left + box.width / 2;
        const cy = box.top + box.height / 2;
        const half = box.width / span / 2;
        const length = edge.getTotalLength();
        for (let at = 0; at <= length; at += length / 600) {
          const point = edge.getPointAtLength(at);
          const x = matrix.a * point.x + matrix.c * point.y + matrix.e;
          const y = matrix.b * point.x + matrix.d * point.y + matrix.f;
          const out = Math.max(Math.abs(x - cx) - half, Math.abs(y - cy) - half);
          if (!best || out > best.out) best = { index: piece.dataset.index, x, y, cx, cy, out, cell: 2 * half, box: { left: box.left, top: box.top } };
        }
      }
      const owner = (x, y) => document.elementFromPoint(x, y)?.closest(".puzzle-piece")?.dataset.index ?? null;
      const length = Math.hypot(best.x - best.cx, best.y - best.cy);
      const direction = { x: (best.x - best.cx) / length, y: (best.y - best.cy) / length };
      const grip = { x: best.x - direction.x * 4, y: best.y - direction.y * 4 };
      return {
        ...best,
        span,
        direction,
        grip,
        gripOwner: owner(grip.x, grip.y),
        cornerOwner: owner(best.box.left + 3, best.box.top + 3),
      };
    });
    assert.ok(knob.out > 0.2 * knob.cell, `found a knob that sticks out ${knob.out.toFixed(1)} px`);
    assert.equal(knob.gripOwner, knob.index, "a knob's tip can be grabbed");
    assert.notEqual(knob.cornerOwner, knob.index, "a piece's empty box corner cannot be grabbed");

    // Carry the piece by its knob. It grows to its seated size around the
    // finger. Its center lands a fifth of a cell from its spot, toward the
    // knob, so the finger itself ends up outside that spot.
    const home = await center(slotFor(knob.index));
    const homeBox = await slotFor(knob.index).boundingBox();
    const grow = homeBox.width / knob.cell;
    const landing = { x: home.x + knob.direction.x * 0.2 * homeBox.width, y: home.y + knob.direction.y * 0.2 * homeBox.width };
    const release = { x: landing.x + (knob.grip.x - knob.cx) * grow, y: landing.y + (knob.grip.y - knob.cy) * grow };
    assert.ok(release.x < homeBox.x || release.x > homeBox.x + homeBox.width
      || release.y < homeBox.y || release.y > homeBox.y + homeBox.height, "the finger lets go outside the piece's spot");
    await touch("touchStart", [{ ...knob.grip, id: 1 }]);
    for (let step = 1; step <= 8; step += 1) await touch("touchMove", [{ ...between(knob.grip, release, step / 8), id: 1 }]);
    await settle();
    const carried = await page.locator(".puzzle-piece.dragging").evaluate((ghost) => {
      const size = parseFloat(ghost.style.width);
      const translation = new DOMMatrixReadOnly(ghost.style.transform);
      return { size, x: translation.m41 + size / 2, y: translation.m42 + size / 2 };
    });
    assert.ok(Math.abs(carried.size - homeBox.width * knob.span) < 1, `the piece is carried at its seated size: ${carried.size}px`);
    assert.ok(Math.hypot(carried.x - landing.x, carried.y - landing.y) < 1, "the carried piece keeps its grip point under the finger");
    await page.screenshot({ path: path.join(evidence, "carried-by-knob.png") });
    // Sample the seating motion every frame from the moment the finger lifts.
    await page.evaluate((index) => {
      window.snapFrames = [];
      const began = performance.now();
      const sample = () => {
        const piece = document.querySelector(`.puzzle-slot.filled[data-index="${index}"] .puzzle-piece`);
        if (piece) {
          const rect = piece.getBoundingClientRect();
          window.snapFrames.push({ t: performance.now() - began, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, animating: piece.getAnimations().length });
        }
        if (performance.now() - began < 500) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }, knob.index);
    await touch("touchEnd", []);
    await page.waitForFunction(() => window.snapFrames.length && window.snapFrames.at(-1).t >= 480);
    assert.equal(await page.locator(`.puzzle-slot.filled[data-index="${knob.index}"]`).count(), 1, "the piece seats by its center");
    const frames = await page.evaluate(() => window.snapFrames);
    const offset = (frame) => Math.hypot(frame.x - home.x, frame.y - home.y);
    const snap = {
      startOffsetPx: Number(offset(frames[0]).toFixed(1)),
      settledAtMs: Math.round(frames.find((frame) => !frame.animating).t - frames[0].t),
      finalOffsetPx: Number(offset(frames.at(-1)).toFixed(2)),
      frames: frames.length,
    };
    assert.ok(snap.startOffsetPx > 0.1 * knob.cell, `the piece starts where it was let go: ${snap.startOffsetPx}px`);
    assert.ok(snap.settledAtMs < 300, `the piece slides home quickly: ${snap.settledAtMs}ms`);
    assert.ok(snap.finalOffsetPx < 0.5, `the piece ends exactly in its spot: ${snap.finalOffsetPx}px`);

    // Finish the puzzle, then freeze the celebration at its first frame.
    await page.evaluate(() => {
      new MutationObserver((_, observer) => {
        if (!document.getElementById("puzzle-screen").classList.contains("puzzle-complete")) return;
        window.completedAt = performance.now();
        observer.disconnect();
      }).observe(document.getElementById("puzzle-screen"), { attributes: true, attributeFilter: ["class"] });
    });
    while (await page.locator("#puzzle-tray .puzzle-piece").count()) {
      const piece = page.locator("#puzzle-tray .puzzle-piece").first();
      const index = await piece.getAttribute("data-index");
      await drag(await center(piece), await center(slotFor(index)), 2);
      assert.equal(await page.locator(`.puzzle-slot.filled[data-index="${index}"]`).count(), 1, `piece ${index} seats`);
    }
    await page.evaluate(() => {
      document.getAnimations().forEach((animation) => {
        if (animation.effect?.target?.classList?.contains("puzzle-slot")) {
          animation.pause();
          animation.currentTime = 0;
        } else animation.finish();
      });
      document.getElementById("puzzle-success").style.visibility = "hidden";
      // Hold this round while the picture is measured; the name still plays.
      clearTimeout(puzzleSuccessTimer);
    });
    await settle();
    await page.screenshot({ path: path.join(evidence, "assembled.png") });

    // Without the cut lines, the seated pieces must reproduce the full picture.
    await page.addStyleTag({ content: ".piece-edge, .puzzle-guide { visibility: hidden; }" });
    const assembled = await seeThrough();
    await page.locator("#puzzle-board").screenshot({ path: path.join(evidence, "assembled-on-green.png") });
    await page.evaluate(() => {
      const reference = document.querySelector(".puzzle-guide").cloneNode(true);
      reference.id = "reference-picture";
      reference.querySelectorAll(".slot-edge").forEach((edge) => edge.remove());
      reference.querySelector(".puzzle-hint").removeAttribute("class");
      Object.assign(reference.style, { zIndex: "40", visibility: "visible" });
      document.getElementById("puzzle-board").append(reference);
    });
    await settle();
    const reference = await boardPixels();
    await page.evaluate(() => document.getElementById("reference-picture").remove());
    const misregistered = misplacedPixels(assembled.magenta, reference, 100);
    // Length of the inner cuts on screen: every piece outline, less the
    // picture's border, counts each cut twice.
    const cutPx = await page.evaluate(() => {
      const guide = document.querySelector(".puzzle-guide");
      const scale = guide.getBoundingClientRect().width / guide.viewBox.baseVal.width;
      const outlines = [...guide.querySelectorAll(".slot-edge")].reduce((sum, edge) => sum + edge.getTotalLength(), 0);
      return (outlines - 4 * guide.viewBox.baseVal.width) / 2 * scale;
    });
    const seams = { gaps: assembled.gaps, misregisteredPerCutPx: Number((misregistered / cutPx).toFixed(3)) };

    // Prove both checks see a misplaced piece before trusting them. Neighbors
    // overlap by about 3 px, so shift one twice that.
    await page.evaluate(() => {
      document.querySelector('.puzzle-slot[data-index="4"] .puzzle-piece').style.translate = "6px 0";
    });
    const shifted = await seeThrough();
    const shiftedMisregistered = misplacedPixels(shifted.magenta, reference, 100);
    assert.ok(shifted.gaps > 100, `the gap check sees a 6 px misplacement: ${shifted.gaps} px`);
    assert.ok(shiftedMisregistered > Math.max(100, 4 * misregistered), `the picture check sees it too: ${shiftedMisregistered} vs ${misregistered} px`);
    assert.equal(seams.gaps, 0, `seated pieces leave no gaps: ${seams.gaps} px show the backdrop`);
    assert.ok(seams.misregisteredPerCutPx < 0.05, `seated pieces line up with the picture: ${seams.misregisteredPerCutPx} px misplaced per px of cut`);

    // The animal's own recording plays once the chime has faded, in full,
    // and well before the next round would start 4.2 s after completion.
    const clip = `audio/${picture.name.toLowerCase().replace(/\s+/g, "-")}.mp3`;
    await page.waitForFunction((src) => window.speechLog.some((entry) => entry.src === src
      && (entry.event === "ended" || (entry.event === "pause" && entry.at < entry.duration - 0.05))), clip, { timeout: 5000 });
    const { log, completedAt } = await page.evaluate(() => ({ log: window.speechLog, completedAt: window.completedAt }));
    const after = log.filter((entry) => entry.t >= completedAt).map((entry) => ({ ...entry, ms: Math.round(entry.t - completedAt) }));
    const name = after.filter((entry) => entry.src === clip);
    const started = name.find((entry) => entry.event === "playing");
    const ended = name.find((entry) => entry.event === "ended" || entry.event === "pause");
    const spoken = {
      clip,
      startedMs: started.ms,
      endedMs: ended.ms,
      clipSeconds: Number(ended.duration.toFixed(2)),
      cutShort: name.filter((entry) => entry.event === "pause" && entry.at < entry.duration - 0.05).length,
      otherSounds: after.filter((entry) => entry.src !== clip).length,
    };
    assert.deepEqual(after.filter((entry) => entry.event === "fallback"), [], "the recording plays, not browser speech");
    assert.equal(name.filter((entry) => entry.event === "play").length, 1, "the name is spoken once");
    assert.ok(spoken.startedMs >= 650 && spoken.startedMs <= 1000, `the name follows the chime: ${spoken.startedMs} ms`);
    assert.equal(spoken.cutShort, 0, "the name is not cut short");
    assert.ok(spoken.endedMs - spoken.startedMs >= 1000 * spoken.clipSeconds - 50, "the whole clip plays");
    assert.ok(spoken.endedMs < 4200 - 1000, `the name ends well before the next round: ${spoken.endedMs} ms`);
    assert.equal(spoken.otherSounds, 0, "nothing else is spoken");
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, evidence, picture, knobPx: Number(knob.out.toFixed(1)), snap, seams, shifted6px: { gaps: shifted.gaps, misregistered: shiftedMisregistered }, spoken }, null, 2));
  } catch (error) {
    await page.screenshot({ path: path.join(evidence, "failure.png") });
    console.error(evidence);
    throw error;
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
