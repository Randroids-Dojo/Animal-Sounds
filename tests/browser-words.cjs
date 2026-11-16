"use strict";

// Run against the local static server (or pass a deployed URL). Plays the
// Words tab with real touches and checks what a child would see and hear.
// The board and the letters fit phones and the tablet, upright and sideways,
// with every letter on the table and clear of the grip band. Dragging each
// letter into its etched slot seats it with a click; the last one brings the
// chime, the word in Randy's voice, in full, and then a new word. A letter
// let go over the wrong slot shakes, sounds a soft "no" and slides back to
// the table, as does any letter let go over the board. A carried letter
// pushes the others out of its way, and a thrown one slides on, both kept on
// the table. Two fingers carry two letters; a palm and the grip band carry
// none. Leaving the tab, dimming or hiding puts a carried letter down and
// stops all motion, a long carry keeps the screen awake, and motion stops
// once every letter is at rest. A frame watcher checks every frame that no
// loose letter leaves the table and seated letters stay in their slots.
// A letter coming down on another on a short sideways table steps aside
// instead of rattling on it forever; the screen turning as the last letter
// seats still celebrates and moves on; and a resting finger never carries a
// letter knocked out from under it. Very short screens still give the
// letters a table to rest on quietly, and a trembling finger pressing
// letters against the table's side does not rattle.
// ONLY=layout,spell,wrong,bump,throw,fingers,palm,band,life,stack,turn,knocked,
// short,tremble runs some parts.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BASE = process.argv[2] || "http://127.0.0.1:8642";
const TABLET = { label: "tablet", width: 800, height: 1340 };
const PHONE = { label: "phone", width: 412, height: 800 };
const VIEWPORTS = [
  PHONE,
  { label: "small phone", width: 360, height: 740 },
  TABLET,
  { label: "tablet sideways", width: 1340, height: 800 },
  { label: "phone sideways", width: 800, height: 412 },
];
const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);
const runs = (part) => !ONLY.length || ONLY.includes(part);
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), "animal-words-"));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function openWords(browser, viewport = TABLET) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    // A clock the test can move forward; the screen-time rules read it.
    const realNow = Date.now.bind(Date);
    let offset = 0;
    Date.now = () => realNow() + offset;
    window.advanceClock = (ms) => { offset += ms; };
    // Every recording's start, pause and end, and any speech fallback.
    window.voice = [];
    const log = (entry) => window.voice.push({ ...entry, t: performance.now() });
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function playLogged(...args) {
      const src = this.getAttribute("src");
      if (!this.voiceLogged) {
        this.voiceLogged = true;
        for (const event of ["playing", "pause", "ended"]) {
          this.addEventListener(event, () => log({ event, src: this.getAttribute("src"), at: this.currentTime, duration: this.duration }));
        }
      }
      log({ event: "play", src });
      return play.apply(this, args);
    };
    if (window.speechSynthesis) speechSynthesis.speak = (utterance) => log({ event: "fallback", text: utterance.text });
  });

  // Fingers down, by id; touchEnd lifts only the listed fingers.
  const down = new Map();
  const send = (type, points) => cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: points.map((point) => ({ radiusX: 8, radiusY: 8, force: 1, ...point })),
  });
  const press = async (id, point, extra = {}) => {
    down.set(id, { ...point, id, ...extra });
    await send("touchStart", [...down.values()]);
  };
  const shift = async (id, point, extra = {}) => {
    down.set(id, { ...down.get(id), ...point, ...extra });
    await send("touchMove", [...down.values()]);
  };
  const lift = async (id) => {
    const point = down.get(id);
    down.delete(id);
    await send("touchEnd", [point]);
  };
  const line = (from, to, steps) => Array.from({ length: steps }, (_, i) => ({
    x: from.x + (to.x - from.x) * (i + 1) / steps,
    y: from.y + (to.y - from.y) * (i + 1) / steps,
  }));
  // Moves paced like a 60 Hz digitizer.
  const glide = async (id, points, gap = 16) => {
    for (const point of points) {
      await shift(id, point);
      await wait(gap);
    }
  };
  const debug = () => page.evaluate(() => wordBoard.debug());
  const toScreen = (state, point) => ({ x: state.origin.left + point.x, y: state.origin.top + point.y });
  const until = async (label, test, timeout = 4000) => {
    const started = Date.now();
    for (;;) {
      const value = await debug();
      if (test(value)) return value;
      if (Date.now() - started > timeout) throw new Error(`${label}: ${JSON.stringify({ ...value, geometry: undefined })}`);
      await wait(50);
    }
  };
  const settled = () => until("the letters come to rest", (value) => !value.running && value.drags === 0, 5000);
  // Carries a letter from its center to a point (screen coordinates).
  // still: the finger stops before lifting, so nothing is thrown.
  const carry = async (letter, to, { id = 1, steps = 14, still = true } = {}) => {
    const state = await debug();
    const from = toScreen(state, letter);
    await press(id, from);
    await glide(id, line(from, to, steps));
    if (still) {
      await shift(id, to);
      await wait(120);
    }
    await lift(id);
  };
  const letterFor = (state, char) => state.letters.find((letter) => letter.char === char && letter.mode === "free");
  const force = (word) => page.evaluate((wanted) => {
    wordBoard.newRound(WordGame.wordsFrom([...animals, ...foods, ...robots]).find((entry) => entry.word === wanted));
  }, word);
  const sounds = () => page.evaluate(() => window.sounds.slice());
  const clearSounds = () => page.evaluate(() => { window.sounds.length = 0; });

  await page.goto(BASE);
  await page.locator(".tile").first().waitFor();
  await page.evaluate(() => {
    // Log the board's sounds by name; they still play.
    window.sounds = [];
    for (const [name, make] of Object.entries(wordSounds)) {
      wordSounds[name] = (...args) => {
        window.sounds.push(name);
        return make(...args);
      };
    }
    const chime = playSuccessChime;
    window.playSuccessChime = () => {
      window.sounds.push("chime");
      chime();
    };
    // Every frame: loose letters stay on the table, seated ones in their
    // slots, and no letter is ever drawn anywhere but where its body is.
    window.offTable = [];
    const look = () => {
      const state = wordBoard.debug();
      if (state.geometry && wordBoard.active) {
        const { arena } = state.geometry;
        for (const letter of state.letters) {
          if (letter.mode === "free" && letter.y - letter.hy >= arena.top - 0.5
            && (letter.x - letter.hx < arena.left - 0.5 || letter.x + letter.hx > arena.right + 0.5 || letter.y + letter.hy > arena.bottom + 0.5)) {
            window.offTable.push({ word: state.word, ...letter });
          }
          if (letter.mode === "seated") {
            const slot = state.slots[letter.slot];
            if (Math.abs(letter.x - slot.x) > 0.01 || Math.abs(letter.y - slot.y) > 0.01) window.offTable.push({ word: state.word, unseated: letter });
          }
        }
      }
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  // Wake the app, then open the tab with a real tap.
  await press(1, { x: viewport.width / 2, y: viewport.height / 2 });
  await lift(1);
  await wait(200);
  const tab = await page.locator('[data-page-target="words"]').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await press(1, tab);
  await wait(40);
  await lift(1);
  await until("a word is laid out", (value) => value.word && value.geometry && !value.running, 6000);
  return { context, page, cdp, errors, press, shift, lift, glide, line, debug, toScreen, until, settled, carry, letterFor, force, sounds, clearSounds };
}

async function noneOffTable(page, label) {
  const off = await page.evaluate(() => ({ count: window.offTable.length, first: window.offTable.slice(0, 3), arena: wordBoard.debug().geometry.arena }));
  assert.equal(off.count, 0, `${label}: every frame, loose letters stay on the table and seated ones in their slots: ${JSON.stringify(off)}`);
}

// Phones and the tablet: one row of tabs, a board across the screen, the
// picture and the etched word inside it, and the letters on the table.
async function checkLayout(browser) {
  const results = [];
  for (const viewport of VIEWPORTS) {
    const words = await openWords(browser, viewport);
    const { page } = words;
    for (const word of ["OWL", "CHEESE", "PIGEON", "BANANA"]) {
      await words.force(word);
      await words.settled();
      // Forced words skip the preloading the next word gets; over the
      // network the picture can take a moment.
      await page.waitForFunction(() => {
        const picture = document.querySelector(".words-picture");
        return picture.complete && picture.naturalWidth > 0;
      }, null, { timeout: 5000 }).catch(() => {});
      const state = await words.debug();
      const label = `${viewport.label} ${word}`;
      const shown = await page.evaluate(() => {
        const rect = (element) => element.getBoundingClientRect().toJSON();
        const tabs = [...document.querySelectorAll("#page-tabs button")];
        const edge = safeEdge();
        return {
          edge,
          oneRow: tabs.every((tab) => Math.abs(tab.getBoundingClientRect().top - tabs[0].getBoundingClientRect().top) < 1),
          clippedTabs: tabs.filter((tab) => tab.scrollWidth > tab.clientWidth + 1 || tab.scrollHeight > tab.clientHeight + 1).map((tab) => tab.textContent.trim()),
          // A label beside its picture must not wrap under it.
          wrappedLabels: tabs.filter((tab) => {
            const label = tab.querySelector(".tab-label");
            if (getComputedStyle(label).position === "absolute" || getComputedStyle(tab).flexDirection === "column") return false;
            const picture = document.createRange();
            picture.selectNodeContents(tab.firstChild);
            return label.getClientRects().length > 1 || label.getBoundingClientRect().top >= picture.getBoundingClientRect().bottom - 2;
          }).map((tab) => tab.textContent.trim()),
          scrolls: document.scrollingElement.scrollHeight > innerHeight + 1 || document.scrollingElement.scrollWidth > innerWidth + 1,
          board: rect(document.querySelector(".words-board")),
          picture: rect(document.querySelector(".words-picture")),
          pictureLoaded: document.querySelector(".words-picture").complete && document.querySelector(".words-picture").naturalWidth > 0,
          screen: rect(document.getElementById("words-screen")),
          bandsClear: [...document.querySelectorAll("#safe-area > div")].every((band) => getComputedStyle(band).backgroundColor === "rgba(0, 0, 0, 0)"),
        };
      });
      const { arena } = state.geometry;
      assert.ok(shown.oneRow, `${label}: the eight tabs share one row`);
      assert.deepEqual(shown.clippedTabs, [], `${label}: every tab fits its picture`);
      assert.deepEqual(shown.wrappedLabels, [], `${label}: no label wraps under its picture`);
      assert.equal(shown.scrolls, false, `${label}: the page does not scroll`);
      assert.ok(shown.bandsClear, `${label}: the band shows the table through it`);
      assert.ok(shown.board.left >= 0 && shown.board.right <= viewport.width + 0.5, `${label}: the board is on screen`);
      assert.ok(shown.board.top >= shown.screen.top, `${label}: the board is below the tabs`);
      assert.ok(shown.pictureLoaded, `${label}: the picture loads`);
      for (const side of ["left", "top"]) assert.ok(shown.picture[side] >= shown.board[side] - 0.5, `${label}: the picture is on the board`);
      assert.ok(shown.picture.right <= shown.board.right + 0.5 && shown.picture.bottom <= shown.board.bottom + 0.5, `${label}: the picture is on the board`);
      for (const letter of state.letters) {
        const left = state.origin.left + letter.x - letter.hx;
        const top = state.origin.top + letter.y - letter.hy;
        assert.equal(letter.mode, "free", `${label}: ${letter.char} starts loose`);
        assert.ok(left >= shown.edge - 0.5 && left + 2 * letter.hx <= viewport.width - shown.edge + 0.5, `${label}: ${letter.char} clear of the side bands`);
        assert.ok(top + 2 * letter.hy <= viewport.height - shown.edge + 0.5, `${label}: ${letter.char} clear of the bottom band`);
        assert.ok(letter.y - letter.hy >= arena.top - 0.5, `${label}: ${letter.char} on the table, below the board`);
        assert.ok(2 * letter.hy >= 34, `${label}: ${letter.char} is ${Math.round(2 * letter.hy)} px tall`);
      }
      // Read as a child would: row by row, each from left to right.
      const rows = [];
      for (const letter of [...state.letters].sort((a, b) => a.y - b.y)) {
        const row = rows.find((other) => Math.abs(other[0].y - letter.y) < letter.hy);
        if (row) row.push(letter);
        else rows.push([letter]);
      }
      const reading = rows.map((row) => row.sort((a, b) => a.x - b.x).map((letter) => letter.char).join("")).join("");
      assert.notEqual(reading, word, `${label}: scrambled`);
      results.push({ label, font: state.geometry.font, arrangement: state.geometry.arrangement, letterPx: Math.round(2 * state.letters[0].hy) });
      await page.screenshot({ path: path.join(evidence, `layout-${viewport.label.replace(/ /g, "-")}-${word}.png`) });
    }
    assert.deepEqual(words.errors, [], `${viewport.label}: no page errors`);
    await words.context.close();
  }
  return results;
}

// Spells two whole words with real touches, the way a child would.
async function checkSpelling(browser, viewport) {
  const words = await openWords(browser, viewport);
  const { page } = words;
  const label = viewport.label;
  const rounds = [];
  for (let round = 0; round < 2; round += 1) {
    const start = await words.debug();
    await words.clearSounds();
    // Letters in a shuffled order of slots, not left to right.
    const order = [...start.slots].sort((a, b) => ((a.index * 7 + 3) % start.slots.length) - ((b.index * 7 + 3) % start.slots.length));
    let completedAt = null;
    for (const [step, slot] of order.entries()) {
      const before = await words.debug();
      const letter = words.letterFor(before, slot.char);
      assert.ok(letter, `${label}: a loose ${slot.char} is on the table`);
      const target = words.toScreen(before, before.slots[slot.index]);
      const from = words.toScreen(before, letter);
      await words.press(1, from);
      const path14 = words.line(from, target, 14);
      await words.glide(1, path14.slice(0, 5));
      // Mid-carry, the letter is lifted and keeps the same spot under the
      // finger. (A letter still sliding from an earlier push is caught
      // wherever the finger lands on it.)
      const grip = async (finger) => {
        await wait(40);
        const state = await words.debug();
        const held = state.letters.find((other) => other.index === letter.index);
        return { held, dx: state.origin.left + held.x - finger.x, dy: state.origin.top + held.y - finger.y };
      };
      const early = await grip(path14[4]);
      await words.glide(1, path14.slice(5, 7));
      const finger = path14[6];
      const late = await grip(finger);
      assert.equal(late.held.mode, "held", `${label}: the finger holds the ${slot.char}`);
      assert.equal(late.held.look, "lifted", `${label}: and it is lifted`);
      assert.ok(Math.abs(early.dx) <= late.held.hx && Math.abs(early.dy) <= late.held.hy, `${label}: the finger is on the letter`);
      assert.ok(Math.abs(late.dx - early.dx) < 1 && Math.abs(late.dy - early.dy) < 1,
        `${label}: the letter keeps the same spot under the finger: ${JSON.stringify([early.dx, early.dy, late.dx, late.dy])}`);
      await words.glide(1, words.line(finger, target, 7));
      await wait(60);
      await words.lift(1);
      if (step === order.length - 1) completedAt = await page.evaluate(() => performance.now());
      const after = await words.until(`${label}: the ${slot.char} seats`, (value) => value.letters.find((other) => other.index === letter.index).mode === "seated");
      const seated = after.letters.find((other) => other.index === letter.index);
      assert.equal(seated.slot, slot.index, `${label}: in the slot it was dropped on`);
      assert.equal(seated.look, "seated");
    }
    const done = await words.debug();
    assert.equal(done.done, true, `${label}: the word is done`);
    const heard = await words.sounds();
    assert.equal(heard.filter((name) => name === "seat").length, start.slots.length, `${label}: one click per letter: ${heard}`);
    assert.equal(heard.filter((name) => name === "chime").length, 1, `${label}: one chime`);
    assert.equal(heard.filter((name) => name === "miss").length, 0, `${label}: no wrong-slot sound`);

    // The word in Randy's voice, once the chime fades, in full.
    const clip = `audio/${start.name.toLowerCase()}.mp3`;
    await page.waitForFunction((src) => window.voice.some((entry) => entry.src === src
      && (entry.event === "ended" || (entry.event === "pause" && entry.at < entry.duration - 0.05))), clip, { timeout: 5000 });
    const next = await words.until(`${label}: a new word follows`, (value) => value.word !== start.word && !value.done, 5000);
    const nextAt = await page.evaluate(() => performance.now());
    const log = await page.evaluate((from) => window.voice.filter((entry) => entry.t >= from), completedAt);
    const spoken = log.filter((entry) => entry.src === clip);
    const started = spoken.find((entry) => entry.event === "playing");
    // Chrome pauses a clip as it reaches its end, then ends it.
    const ended = spoken.find((entry) => entry.event === "ended");
    const cut = spoken.filter((entry) => entry.event === "pause" && entry.at < entry.duration - 0.05);
    assert.deepEqual(log.filter((entry) => entry.event === "fallback"), [], `${label}: the recording plays, not browser speech`);
    assert.equal(spoken.filter((entry) => entry.event === "play").length, 1, `${label}: the word is spoken once`);
    assert.deepEqual(cut, [], `${label}: the word is not cut short`);
    assert.ok(ended, `${label}: the word plays to its end`);
    const startedMs = started.t - completedAt;
    assert.ok(startedMs >= 650 && startedMs <= 1200, `${label}: the word follows the chime: ${Math.round(startedMs)} ms`);
    assert.ok(ended.t < nextAt, `${label}: and ends before the next word`);
    const gap = nextAt - completedAt;
    assert.ok(gap >= 3300 && gap <= 4200, `${label}: the next word comes about 3.4 s later: ${Math.round(gap)} ms`);
    assert.ok(next.letters.every((letter) => letter.mode === "free") && next.slots.every((slot) => !slot.filled), `${label}: the board is reset`);
    rounds.push({ word: start.word, next: next.word, nameMs: Math.round(startedMs), clipMs: Math.round(ended.t - started.t), nextMs: Math.round(gap) });
    await page.screenshot({ path: path.join(evidence, `spell-${label}-${round}.png`) });
  }
  // Short and long words take turns.
  const lengths = [rounds[0].word, rounds[1].word, rounds[1].next].map((word) => word.length <= 4);
  assert.deepEqual(lengths, [lengths[0], !lengths[0], lengths[0]], `${label}: short and long words take turns: ${JSON.stringify(rounds)}`);
  await noneOffTable(page, label);
  assert.deepEqual(words.errors, []);
  await words.context.close();
  return rounds;
}

// Wrong slots and the board: the letter goes back to the table.
async function checkWrong(browser) {
  const words = await openWords(browser, TABLET);
  const { page } = words;
  await words.force("LION");
  await words.settled();
  await words.clearSounds();
  let state = await words.debug();
  const l = words.letterFor(state, "L");
  const oSlot = state.slots.find((slot) => slot.char === "O");
  await words.carry(l, words.toScreen(state, oSlot));
  await wait(120);
  const shaking = await page.evaluate(() => document.querySelector('.word-letter[aria-label="Letter L"] .word-letter-art')
    .getAnimations().some((animation) => animation.playState === "running"));
  assert.ok(shaking, "a letter on the wrong slot shakes");
  // The carry may knock other letters on its way; what matters is the "no".
  const heard = await words.sounds();
  assert.equal(heard.filter((name) => name === "miss").length, 1, `and sounds a soft no: ${heard}`);
  assert.ok(!heard.includes("seat"), "and does not click home");
  state = await words.settled();
  const back = state.letters.find((letter) => letter.index === l.index);
  assert.equal(back.mode, "free", "it does not seat");
  assert.ok(back.y - back.hy >= state.geometry.arena.top - 0.5, "it slides back to the table");
  assert.ok(state.slots.every((slot) => !slot.filled), "the slot stays empty");

  // Let go over the picture: back to the table, without the "no".
  await words.clearSounds();
  const n = words.letterFor(state, "N");
  const picture = state.geometry.picture;
  await words.carry(n, words.toScreen(state, { x: picture.x + picture.size / 2, y: picture.y + picture.size / 2 }));
  state = await words.settled();
  const returned = state.letters.find((letter) => letter.index === n.index);
  assert.ok(returned.y - returned.hy >= state.geometry.arena.top - 0.5, "a letter let go on the board returns to the table");
  // It may knock another letter on its way down, but it is not "wrong".
  assert.ok(!(await words.sounds()).includes("miss"), "with no wrong-slot sound");

  // Let go on the table, still: it stays right there.
  const i = words.letterFor(state, "I");
  const spot = { x: (state.geometry.arena.left + state.geometry.arena.right) / 2, y: state.geometry.arena.bottom - 2 * i.hy };
  const clear = state.letters.every((letter) => letter.index === i.index || Math.hypot(letter.x - spot.x, letter.y - spot.y) > 3 * letter.hy);
  await words.carry(i, words.toScreen(state, spot));
  state = await words.settled();
  const put = state.letters.find((letter) => letter.index === i.index);
  if (clear) assert.ok(Math.hypot(put.x - spot.x, put.y - spot.y) < 1, `a letter put down still stays put: ${JSON.stringify([put.x, put.y, spot])}`);
  await noneOffTable(page, "wrong");
  assert.deepEqual(words.errors, []);
  await words.context.close();
}

// A carried letter pushes the others, which bump and slide but stay on the
// table; the motion stops once everything is at rest.
async function checkBump(browser) {
  const words = await openWords(browser, TABLET);
  const { page } = words;
  await words.force("BANANA");
  await words.settled();
  await words.clearSounds();
  let state = await words.debug();
  // Two letters on the same row: push the left one through the right one.
  const pairs = state.letters.flatMap((a) => state.letters.filter((b) => b.x > a.x && Math.abs(b.y - a.y) < a.hy).map((b) => [a, b]));
  const [pusher, target] = pairs.sort((p, q) => (p[1].x - p[0].x) - (q[1].x - q[0].x))[0];
  const from = words.toScreen(state, pusher);
  const through = words.toScreen(state, { x: target.x + 1.2 * (target.hx + pusher.hx), y: target.y });
  await words.press(1, from);
  await words.glide(1, words.line(from, through, 24));
  const pushed = (await words.debug()).letters.find((letter) => letter.index === target.index);
  assert.ok(pushed.x - target.x > 30 || Math.abs(pushed.y - target.y) > 30, `the pushed letter moves out of the way: ${JSON.stringify([target.x, pushed.x, target.y, pushed.y])}`);
  assert.ok((await words.sounds()).includes("bump"), "and knocks audibly");
  // Shove everything into the left side of the table.
  const wall = words.toScreen(state, { x: state.geometry.arena.left + pusher.hx, y: target.y });
  await words.glide(1, words.line(through, wall, 30), 12);
  await words.lift(1);
  state = await words.settled();
  const arena = state.geometry.arena;
  for (const letter of state.letters) {
    assert.ok(letter.x - letter.hx >= arena.left - 0.5 && letter.x + letter.hx <= arena.right + 0.5, `${letter.char} stays on the table`);
  }
  assert.equal(await page.evaluate(() => WordGame.unsettled(wordBoard.debug().letters, wordBoard.debug().geometry.arena)), false, "no letters left overlapping");
  // At rest, nothing runs: count frames the board asks for over a second.
  const frames = await page.evaluate(() => new Promise((resolve) => {
    let asked = 0;
    const original = window.requestAnimationFrame;
    window.requestAnimationFrame = (callback) => { asked += 1; return original(callback); };
    setTimeout(() => { window.requestAnimationFrame = original; resolve({ asked, running: wordBoard.debug().running }); }, 1000);
  }));
  // The test's own frame watcher asks every frame; the board asks none.
  assert.equal(frames.running, false, "the board's motion stops at rest");
  assert.ok(frames.asked <= 70, `only the watcher asks for frames at rest: ${frames.asked}`);
  await noneOffTable(page, "bump");
  assert.deepEqual(words.errors, []);
  await words.context.close();
}

// A letter let go mid-swipe slides on, slows and stops on the table.
async function checkThrow(browser) {
  const words = await openWords(browser, PHONE);
  const { page } = words;
  await words.force("CAT");
  await words.settled();
  let state = await words.debug();
  const letter = state.letters[0];
  const arena = state.geometry.arena;
  // Clear the others out of the way along the bottom first.
  const from = words.toScreen(state, letter);
  const release = words.toScreen(state, { x: (arena.left + arena.right) / 2, y: arena.bottom - letter.hy - 4 });
  await words.press(1, from);
  await words.glide(1, words.line(from, release, 10));
  const throwTo = { x: release.x + 120, y: release.y - 160 };
  await words.glide(1, words.line(release, throwTo, 6), 8);
  await words.lift(1);
  const lifted = await words.debug();
  const thrown = lifted.letters.find((other) => other.index === letter.index);
  state = await words.settled();
  const rested = state.letters.find((other) => other.index === letter.index);
  const slid = Math.hypot(rested.x - thrown.x, rested.y - thrown.y);
  assert.ok(slid > 30, `a thrown letter slides on: ${Math.round(slid)} px`);
  assert.ok(rested.x + rested.hx <= arena.right + 0.5 && rested.y - rested.hy >= arena.top - 0.5, "and stays on the table");
  await noneOffTable(page, "throw");
  assert.deepEqual(words.errors, []);
  await words.context.close();
}

// Two fingers carry two letters at once; a finger cannot take a letter
// another one carries.
async function checkFingers(browser) {
  const words = await openWords(browser, TABLET);
  const { page } = words;
  await words.force("PIZZA");
  await words.settled();
  let state = await words.debug();
  const [a, b] = [...state.letters].sort((p, q) => p.x - q.x);
  const fromA = words.toScreen(state, a);
  const fromB = words.toScreen(state, b);
  await words.press(1, fromA);
  await words.press(2, fromB);
  const toA = { x: fromA.x - 40, y: fromA.y + 150 };
  const toB = { x: fromB.x + 40, y: fromB.y + 150 };
  const pathA = words.line(fromA, toA, 10);
  const pathB = words.line(fromB, toB, 10);
  for (let i = 0; i < 10; i += 1) {
    await words.shift(1, pathA[i]);
    await words.shift(2, pathB[i]);
    await wait(16);
  }
  await wait(40);
  state = await words.debug();
  assert.equal(state.drags, 2, "two letters are carried at once");
  const atA = state.letters.find((letter) => letter.index === a.index);
  const atB = state.letters.find((letter) => letter.index === b.index);
  assert.ok(Math.abs(state.origin.left + atA.x - toA.x) < 1 && Math.abs(state.origin.top + atA.y - toA.y) < 1, "the first follows its finger");
  assert.ok(Math.abs(state.origin.left + atB.x - toB.x) < 1 && Math.abs(state.origin.top + atB.y - toB.y) < 1, "the second follows its own");
  // A third finger on the first letter cannot take it.
  await words.press(3, toA);
  await words.shift(3, { x: toA.x + 60, y: toA.y });
  await wait(40);
  state = await words.debug();
  assert.equal(state.drags, 2, "a finger cannot take a carried letter");
  assert.ok(Math.abs(state.origin.left + state.letters.find((letter) => letter.index === a.index).x - toA.x) < 1, "which stays with its finger");
  await words.lift(3);
  // Lift one; the other keeps going.
  await words.lift(1);
  await words.glide(2, words.line(toB, { x: toB.x, y: toB.y + 80 }, 6));
  await wait(40);
  state = await words.debug();
  assert.equal(state.drags, 1, "lifting one finger drops only its letter");
  assert.ok(Math.abs(state.origin.top + state.letters.find((letter) => letter.index === b.index).y - (toB.y + 80)) < 1, "the other keeps following");
  await words.lift(2);
  await words.settled();
  await noneOffTable(page, "fingers");
  assert.deepEqual(words.errors, []);
  await words.context.close();
}

// A palm sliding over the letters carries none, while a fingertip still can.
async function checkPalm(browser) {
  const words = await openWords(browser, TABLET);
  await words.force("HORSE");
  await words.settled();
  let state = await words.debug();
  const [palmLetter, fingerLetter] = state.letters;
  const palmFrom = words.toScreen(state, palmLetter);
  await words.press(1, palmFrom, { radiusX: 60, radiusY: 60 });
  await words.glide(1, words.line(palmFrom, { x: palmFrom.x + 90, y: palmFrom.y + 40 }, 8).map((point) => ({ ...point, radiusX: 60, radiusY: 60 })));
  const fingerFrom = words.toScreen(state, fingerLetter);
  await words.press(2, fingerFrom);
  await words.glide(2, words.line(fingerFrom, { x: fingerFrom.x, y: fingerFrom.y + 120 }, 8));
  state = await words.debug();
  assert.equal(state.drags, 1, "only the fingertip carries a letter");
  assert.equal(state.letters.find((letter) => letter.index === palmLetter.index).mode, "free", "the palm's letter stays put");
  assert.equal(state.letters.find((letter) => letter.index === fingerLetter.index).mode, "held", "the finger's letter is carried");
  await words.lift(1);
  await words.lift(2);
  await words.settled();
  assert.deepEqual(words.errors, []);
  await words.context.close();
}

// Touches starting in the grip band carry nothing; a letter let go in the
// band ends up back on the table, where it can be picked up again.
async function checkBand(browser) {
  const words = await openWords(browser, PHONE);
  const { page } = words;
  await words.force("DUCK");
  await words.settled();
  let state = await words.debug();
  const edge = await page.evaluate(() => safeEdge());
  const letter = state.letters[0];
  const bandPoint = { x: edge / 2, y: state.origin.top + letter.y };
  await words.press(1, bandPoint);
  await words.glide(1, words.line(bandPoint, words.toScreen(state, letter), 10));
  await words.glide(1, words.line(words.toScreen(state, letter), { x: 200, y: 600 }, 6));
  state = await words.debug();
  assert.equal(state.drags, 0, "a touch from the band carries nothing");
  await words.lift(1);
  const corner = { x: PHONE.width - edge / 3, y: PHONE.height - edge / 3 };
  // Every frame from the drop: the letter glides back onto the table in
  // small steps rather than jumping there.
  await page.evaluate(() => {
    window.trail = [];
    const follow = () => {
      const letter = wordBoard.debug().letters[1];
      window.trail.push({ x: letter.x, y: letter.y, mode: letter.mode });
      if (window.trail.length < 600) requestAnimationFrame(follow);
    };
    requestAnimationFrame(follow);
  });
  await words.carry(state.letters[1], corner);
  state = await words.settled();
  const trail = await page.evaluate(() => {
    const down = window.trail.findIndex((point) => point.mode !== "held" && window.trail.indexOf(point) > 0 && window.trail.slice(0, window.trail.indexOf(point)).some((earlier) => earlier.mode === "held"));
    const after = window.trail.slice(Math.max(0, down - 1));
    window.trail.length = 600;
    return after.slice(1).map((point, i) => Math.hypot(point.x - after[i].x, point.y - after[i].y));
  });
  const biggest = Math.max(...trail);
  const travelled = trail.reduce((sum, step) => sum + step, 0);
  assert.ok(travelled > 20, `the letter came back from the band: ${Math.round(travelled)} px`);
  assert.ok(biggest < 25, `it glides back, never jumping more than 25 px a frame: ${Math.round(biggest)} px`);
  const put = state.letters[1];
  assert.ok(state.origin.left + put.x + put.hx <= PHONE.width - edge + 0.5 && state.origin.top + put.y + put.hy <= PHONE.height - edge + 0.5,
    "a letter let go in the band is put back clear of it");
  await words.carry(put, words.toScreen(state, { x: put.x - 60, y: put.y - 60 }));
  state = await words.settled();
  assert.ok(Math.hypot(state.letters[1].x - (put.x - 60), state.letters[1].y - (put.y - 60)) < 2, "and can be picked up again");
  // A finger that lands on the letter while it is still gliding back
  // catches it.
  state = await words.debug();
  const again = state.letters[1];
  const from = words.toScreen(state, again);
  await words.press(1, from);
  await words.glide(1, words.line(from, corner, 8));
  await words.lift(1);
  await wait(30);
  state = await words.debug();
  assert.equal(state.letters[1].mode, "placing", "the letter is gliding back");
  // Its center may still be in the band, where touches do nothing, so take
  // hold of the part of it already out of the band.
  const center = words.toScreen(state, state.letters[1]);
  const gliding = { x: Math.min(center.x, PHONE.width - edge - 4), y: Math.min(center.y, PHONE.height - edge - 4) };
  await words.press(1, gliding);
  await words.glide(1, words.line(gliding, { x: 200, y: 500 }, 8));
  state = await words.debug();
  assert.equal(state.letters[1].mode, "held", "a finger on a gliding letter catches it");
  assert.ok(Math.abs(state.origin.left + state.letters[1].x - 200) <= state.letters[1].hx + 14, "and carries it");
  await words.lift(1);
  await words.settled();
  await noneOffTable(page, "band");
  assert.deepEqual(words.errors, []);
  await words.context.close();
}

// Leaving, dimming and hiding put a carried letter down and stop motion; a
// long carry keeps the screen awake; leaving mid-celebration brings a new
// word on return.
async function checkLifecycle(browser) {
  const words = await openWords(browser, TABLET);
  const { page } = words;
  await words.force("WOLF");
  await words.settled();
  let state = await words.debug();
  const tabCenter = (target) => page.locator(`[data-page-target="${target}"]`).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });

  // The tab changes mid-carry. (Chrome sends no click for a second
  // finger's tap while another is down, so this takes the tab change's
  // own path.)
  const letter = state.letters[0];
  const from = words.toScreen(state, letter);
  await words.press(1, from);
  await words.glide(1, words.line(from, { x: from.x + 50, y: from.y + 80 }, 6));
  await page.evaluate(() => showPage("animals"));
  await wait(150);
  state = await words.debug();
  assert.equal(await page.evaluate(() => document.body.dataset.page), "animals", "the tab changes");
  assert.equal(state.drags, 0, "leaving puts the letter down");
  assert.equal(state.running, false, "and stops all motion");
  await words.glide(1, [{ x: from.x + 90, y: from.y + 100 }]);
  await words.lift(1);
  await words.press(1, await tabCenter("words"));
  await wait(40);
  await words.lift(1);
  state = await words.settled();
  assert.equal(state.word, "WOLF", "the same word waits on return");
  assert.ok(state.letters.every((other) => other.mode === "free"), "with the letter loose on the table");

  // Dimming mid-carry, and hiding the page mid-carry.
  for (const [name, stop, resume] of [
    ["dimming", () => showIdleDim(), () => wakeIdleScreen()],
    ["hiding", () => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    }, () => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
      wakeIdleScreen();
    }],
  ]) {
    state = await words.debug();
    const start = words.toScreen(state, state.letters[1]);
    await words.press(1, start);
    await words.glide(1, words.line(start, { x: start.x - 40, y: start.y + 60 }, 6));
    assert.equal((await words.debug()).drags, 1);
    await page.evaluate(stop);
    await wait(100);
    state = await words.debug();
    assert.equal(state.drags, 0, `${name} puts the letter down`);
    assert.equal(state.running, false, `${name} stops all motion`);
    await words.lift(1);
    await page.evaluate(resume);
    await words.settled();
  }

  // A minute-long carry is play the whole time: the screen does not dim.
  // A still finger holding a letter is not play, and the clock check below
  // must be able to dim the screen for that.
  for (const moving of [true, false]) {
    state = await words.debug();
    const start = words.toScreen(state, state.letters[2]);
    await words.press(1, start);
    await words.glide(1, words.line(start, { x: start.x, y: start.y + 30 }, 4));
    for (let i = 1; i <= 60; i += 1) {
      if (moving) await words.shift(1, { x: start.x + 40 * Math.sin(i / 4), y: start.y + 30 + 20 * Math.cos(i / 4) });
      await wait(40);
      if (i === 20 || i === 45) await page.evaluate(() => window.advanceClock(30 * 1000));
    }
    await wait(1100);
    const dimmed = await page.evaluate(() => !idleDim.hidden);
    assert.equal(dimmed, !moving, moving ? "a minute of carrying does not dim the screen" : "a minute of holding still does");
    await words.lift(1);
    if (dimmed) {
      await words.press(1, { x: 400, y: 900 });
      await wait(40);
      await words.lift(1);
    }
    await words.settled();
  }

  // Leave mid-celebration: a new word on return, and the name stops.
  await words.force("COW");
  await words.settled();
  for (const char of ["C", "O", "W"]) {
    state = await words.debug();
    await words.carry(words.letterFor(state, char), words.toScreen(state, state.slots.find((slot) => slot.char === char && !slot.filled)));
    await words.until(`the ${char} seats`, (value) => value.slots.find((slot) => slot.char === char).filled
      && value.letters.every((other) => other.mode !== "seating"));
  }
  assert.equal((await words.debug()).done, true);
  await words.press(1, await tabCenter("fish"));
  await wait(40);
  await words.lift(1);
  await wait(1500);
  const spoke = await page.evaluate(() => window.voice.filter((entry) => entry.src === "audio/cow.mp3" && entry.event === "play").length);
  assert.equal(spoke, 0, "leaving during the chime cancels the name");
  await words.press(1, await tabCenter("words"));
  await wait(40);
  await words.lift(1);
  state = await words.settled();
  assert.notEqual(state.word, "COW", "a new word waits on return");
  assert.equal(state.done, false);
  await noneOffTable(page, "life");
  assert.deepEqual(words.errors, []);
  await words.context.close();
}

// On a short, sideways table, a letter let go on the board straight above
// another comes down beside it and settles, without knocking on and on.
async function checkStack(browser) {
  const words = await openWords(browser, { label: "phone sideways", width: 800, height: 412 });
  const { page } = words;
  const results = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await words.force("LION");
    let state = await words.settled();
    const { arena, board } = state.geometry;
    const [first] = state.letters;
    const front = { x: (arena.left + arena.right) / 2 + 40 * (attempt % 3 - 1), y: arena.bottom - first.hy - 1 };
    await words.carry(first, words.toScreen(state, front));
    state = await words.settled();
    const below = state.letters.find((letter) => letter.index === first.index);
    // Drop the letter whose own recess is farthest away, so it cannot seat.
    const slotX = (letter) => state.slots.find((slot) => slot.char === letter.char).x;
    const top = state.letters.filter((letter) => letter.index !== first.index)
      .sort((a, b) => Math.abs(slotX(b) - below.x) - Math.abs(slotX(a) - below.x))[0];
    const over = { x: below.x + [0, 4, -8][attempt % 3], y: Math.min(board.y + board.height - 6, arena.top - top.hy - 4) };
    await words.carry(top, words.toScreen(state, over));
    // Only what happens after it is let go: the carry up to the board may
    // push other letters on the way, and those knocks are real.
    await words.clearSounds();
    const started = Date.now();
    state = await words.settled();
    const knocks = (await words.sounds()).filter((name) => name === "bump").length;
    results.push({ ms: Date.now() - started, knocks });
    assert.ok(Date.now() - started < 3000, `attempt ${attempt}: the letters settle: ${JSON.stringify(results)}`);
    assert.ok(knocks <= 3, `attempt ${attempt}: a knock or two, not a rattle: ${JSON.stringify(results)}`);
    assert.ok(state.letters.every((letter) => letter.mode === "free"), `attempt ${attempt}: nothing seated by accident`);
    for (const letter of state.letters) assert.ok(letter.y - letter.hy >= arena.top - 0.5, `attempt ${attempt}: ${letter.char} on the table: ${JSON.stringify({ arena, letters: state.letters.map(({ char, x, y, hx, hy, mode }) => ({ char, x, y, hx, hy, mode })) })}`);
  }
  await noneOffTable(page, "stack");
  assert.deepEqual(words.errors, []);
  await words.context.close();
  return results;
}

// The screen turns while the last letter is still sliding into its slot:
// it seats with its click, the word is celebrated and a new one follows.
async function checkTurn(browser) {
  const words = await openWords(browser, TABLET);
  const { page } = words;
  await words.force("CAT");
  await words.settled();
  await words.clearSounds();
  let state = await words.debug();
  for (const [step, slot] of state.slots.entries()) {
    state = await words.debug();
    const letter = words.letterFor(state, slot.char);
    const from = words.toScreen(state, letter);
    await words.press(1, from);
    await words.glide(1, words.line(from, words.toScreen(state, slot), 10));
    await wait(80);
    await words.lift(1);
    if (step < state.slots.length - 1) await wait(400);
  }
  await page.setViewportSize({ width: 1340, height: 800 });
  const next = await words.until("a new word follows the turn", (value) => value.word !== "CAT" && !value.done, 6000);
  const heard = await words.sounds();
  assert.equal(heard.filter((name) => name === "seat").length, 3, `the last letter clicks home too: ${heard}`);
  assert.ok(heard.includes("chime"), "the word is celebrated");
  assert.equal(next.geometry.arrangement, (await words.debug()).geometry.arrangement);
  assert.ok(next.letters.every((letter) => letter.mode === "free"));
  await noneOffTable(page, "turn");
  assert.deepEqual(words.errors, []);
  await words.context.close();
}

// A finger resting on a letter that another finger knocks away does not
// then carry it from afar.
async function checkKnocked(browser) {
  const words = await openWords(browser, TABLET);
  const { page } = words;
  await words.force("BANANA");
  let state = await words.settled();
  const { arena } = state.geometry;
  const pairs = state.letters.flatMap((a) => state.letters.filter((b) => b.x > a.x && Math.abs(b.y - a.y) < a.hy).map((b) => [a, b]));
  const [pusher, rested] = pairs.sort((p, q) => (p[1].x - p[0].x) - (q[1].x - q[0].x))[0];
  const finger = words.toScreen(state, rested);
  await words.press(1, finger);
  await wait(50);
  const from = words.toScreen(state, pusher);
  await words.press(2, from);
  await words.glide(2, words.line(from, words.toScreen(state, { x: Math.min(arena.right - pusher.hx, rested.x + 3 * rested.hx), y: rested.y }), 6), 12);
  await words.lift(2);
  await words.until("the knocked letter comes to rest", (value) => !value.running, 4000);
  state = await words.debug();
  const knocked = state.letters.find((letter) => letter.index === rested.index);
  const reach = (letter) => Math.abs(finger.x - state.origin.left - letter.x) <= letter.hx + 14 && Math.abs(finger.y - state.origin.top - letter.y) <= letter.hy + 14;
  assert.ok(!reach(knocked), "the letter was knocked out from under the finger");
  await words.glide(1, words.line(finger, { x: finger.x, y: finger.y + 40 }, 5));
  state = await words.debug();
  const carried = state.letters.find((letter) => letter.mode === "held");
  if (carried) {
    assert.notEqual(carried.index, rested.index, "the finger does not carry the knocked letter from afar");
    assert.ok(Math.abs(state.origin.left + carried.x - finger.x) <= carried.hx + 14, "only a letter under the finger");
  }
  await words.lift(1);
  await words.settled();
  await noneOffTable(page, "knocked");
  assert.deepEqual(words.errors, []);
  await words.context.close();
}

// Very short screens, such as small phones turned sideways in Chrome: the
// letters lie on a table at least a letter tall, clear of the grip band,
// and come to rest without a sound.
async function checkShort(browser) {
  const results = [];
  for (const viewport of [{ width: 900, height: 300 }, { width: 780, height: 290 }, { width: 740, height: 360 }, { width: 640, height: 280 }]) {
    const label = `${viewport.width}x${viewport.height}`;
    const words = await openWords(browser, { label, ...viewport });
    const { page } = words;
    for (const word of ["CAT", "BANANA"]) {
      await words.force(word);
      await words.clearSounds();
      await wait(1500);
      const state = await words.debug();
      const { arena } = state.geometry;
      const edge = await page.evaluate(() => safeEdge());
      assert.equal(state.running, false, `${label} ${word}: the letters come to rest`);
      assert.deepEqual((await words.sounds()).filter((name) => name === "bump"), [], `${label} ${word}: without a sound`);
      for (const letter of state.letters) {
        assert.ok(arena.bottom - arena.top >= 2 * letter.hy, `${label} ${word}: the table is at least a letter tall`);
        assert.ok(letter.y - letter.hy >= arena.top - 0.5 && letter.y + letter.hy <= arena.bottom + 0.5, `${label} ${word}: ${letter.char} on the table`);
        assert.ok(state.origin.top + letter.y + letter.hy <= viewport.height - edge + 0.5, `${label} ${word}: ${letter.char} clear of the band`);
      }
      results.push({ label, word, font: state.geometry.font, arrangement: state.geometry.arrangement });
      await page.screenshot({ path: path.join(evidence, `short-${label}-${word}.png`) });
    }
    await noneOffTable(page, label);
    assert.deepEqual(words.errors, []);
    await words.context.close();
  }
  return results;
}

// A fingertip trembling as it presses one letter against another lying at
// the table's side makes one knock, not a rattle.
async function checkTremble(browser) {
  const words = await openWords(browser, TABLET);
  const { page } = words;
  await words.force("BEAR");
  let state = await words.settled();
  const { arena } = state.geometry;
  const [pinned, pressing] = state.letters;
  await words.carry(pinned, words.toScreen(state, { x: arena.right - pinned.hx, y: (arena.top + arena.bottom) / 2 }));
  state = await words.settled();
  const against = state.letters.find((letter) => letter.index === pinned.index);
  const from = words.toScreen(state, state.letters.find((letter) => letter.index === pressing.index));
  const press = words.toScreen(state, { x: against.x - against.hx - pressing.hx + 6, y: against.y });
  await words.press(1, from);
  await words.glide(1, words.line(from, press, 16));
  await wait(200);
  await words.clearSounds();
  for (let i = 0; i < 240; i += 1) {
    await words.shift(1, { x: press.x + 2 * Math.sin(i * 1.7), y: press.y + 2 * Math.cos(i * 2.3) });
    await wait(16);
  }
  const knocks = (await words.sounds()).filter((name) => name === "bump");
  await words.lift(1);
  await words.settled();
  assert.deepEqual(knocks, [], "no rattle while pressed with a trembling finger");
  await noneOffTable(page, "tremble");
  assert.deepEqual(words.errors, []);
  await words.context.close();
}

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const report = {};
  try {
    if (runs("layout")) report.layout = await checkLayout(browser);
    if (runs("spell")) report.spell = [await checkSpelling(browser, TABLET), await checkSpelling(browser, PHONE)];
    if (runs("wrong")) await checkWrong(browser);
    if (runs("bump")) await checkBump(browser);
    if (runs("throw")) await checkThrow(browser);
    if (runs("fingers")) await checkFingers(browser);
    if (runs("palm")) await checkPalm(browser);
    if (runs("band")) await checkBand(browser);
    if (runs("life")) await checkLifecycle(browser);
    if (runs("stack")) report.stack = await checkStack(browser);
    if (runs("turn")) await checkTurn(browser);
    if (runs("knocked")) await checkKnocked(browser);
    if (runs("short")) report.short = await checkShort(browser);
    if (runs("tremble")) await checkTremble(browser);
    console.log(JSON.stringify({ passed: true, evidence, ...report }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  console.error(`Evidence: ${evidence}`);
  process.exitCode = 1;
});
