"use strict";

// Run against the local static server (or pass a deployed URL). Plays the
// goldfish tab with real touches and checks what a child would see and hear:
// a hungry new fish asks for food, eats what is sprinkled, refuses food once
// full, and the leftovers cloud the water until Change water appears and
// clears it, with the fish kept under the water line the whole time. Tapping
// the fish, the ship and the water each do their own thing, and a moving
// finger leads the fish while a resting one does not. The fish keeps living
// across reloads and in real time: it grows over months, gets hungry and its
// water clouds overnight, and dirty water left for days makes it sick until
// the water is changed. Nothing animates unless the tab is showing and awake.
// Layouts are checked on phones and the tablet, upright and sideways.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BASE = process.argv[2] || "http://127.0.0.1:8642";
const KEY = "animal-sounds-goldfish-v1";
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const TABLET = { width: 800, height: 1340 };
const VIEWPORTS = [
  { label: "phone", width: 412, height: 800 },
  { label: "small phone", width: 360, height: 740 },
  { label: "tablet", ...TABLET },
  { label: "tablet sideways", width: 1340, height: 800 },
  { label: "phone sideways", width: 800, height: 412 },
];

const evidence = fs.mkdtempSync(path.join(os.tmpdir(), "animal-goldfish-"));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// saved(now) returns the fish to store before the page first loads.
async function openFish(browser, { viewport = TABLET, saved = null } = {}) {
  const context = await browser.newContext({ viewport, hasTouch: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(([key, seed]) => {
    // A clock the test can move forward; everything in the app reads it.
    const realNow = Date.now.bind(Date);
    let offset = Number(sessionStorage.getItem("clock-offset") || 0);
    Date.now = () => realNow() + offset;
    window.advanceClock = (ms) => {
      offset += ms;
      sessionStorage.setItem("clock-offset", String(offset));
    };
    if (seed && !sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem(key, JSON.stringify(new Function("now", `return (${seed})(now)`)(Date.now())));
    }
    // Every recording that starts, and every speech fallback.
    window.media = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function playLogged() {
      window.media.push(new URL(this.currentSrc || this.src, location.href).pathname.replace(/^\//, ""));
      return play.call(this);
    };
    window.speechSynthesis && (window.speechSynthesis.speak = (utterance) => window.media.push(`speech:${utterance.text}`));
  }, [KEY, saved && saved.toString()]);

  const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: points.map((point) => ({ id: 1, radiusX: 8, radiusY: 8, force: 1, ...point })),
  });
  const tapPoint = async (point, hold = 40) => {
    await touch("touchStart", [point]);
    await wait(hold);
    await touch("touchEnd", []);
    await wait(150); // The tap arbitration window.
  };
  const center = async (selector) => {
    const rect = await page.locator(selector).evaluate((element) => element.getBoundingClientRect().toJSON());
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  };
  const tap = async (selector) => tapPoint(await center(selector));
  // Tank coordinates to the screen.
  const onScreen = (point) => page.evaluate(({ x, y }) => {
    const tank = document.getElementById("fish-tank");
    const rect = tank.getBoundingClientRect();
    return { x: rect.left + tank.clientLeft + x, y: rect.top + tank.clientTop + y };
  }, point);
  const debug = () => page.evaluate(() => {
    const state = fishTank.state;
    return { ...fishTank.debug(), state: { ...state } };
  });
  const sounds = () => page.evaluate(() => window.sounds.slice());
  // Whether a button is actually breathing, not just carrying the class.
  const breathing = (selector) => page.locator(selector).evaluate((element) =>
    getComputedStyle(element).animationName.split(",").map((name) => name.trim()).includes("fish-button-wanted"));
  // Every frame: the fish never asks for water while Change water is hidden.
  const watchAsks = () => page.evaluate(() => {
    window.badAsks = [];
    const water = document.getElementById("fish-water");
    const look = () => {
      if (fishTank.active && fishTank.debug().thought === "water" && water.hidden) window.badAsks.push(performance.now());
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  const badAsks = () => page.evaluate(() => window.badAsks.length);
  const until = async (label, test, timeout = 8000) => {
    const started = Date.now();
    for (;;) {
      const value = await debug();
      if (test(value)) return value;
      if (Date.now() - started > timeout) {
        const { geometry, palette, ...shown } = value;
        throw new Error(`${label}: ${JSON.stringify(shown)}`);
      }
      await wait(100);
    }
  };

  const open = async () => {
    await page.locator(".tile").first().waitFor();
    await page.evaluate(() => {
      // Log the tank's sounds by name; they still play.
      window.sounds = [];
      for (const [name, make] of Object.entries(fishSounds)) {
        fishSounds[name] = () => {
          window.sounds.push(name);
          make();
        };
      }
    });
    await tapPoint(await center("#idle-dim"));
    await tap('[data-page-target="fish"]');
    await page.evaluate(() => document.fonts.ready);
    await until("the tank starts", (value) => value.active && value.frames > 5);
  };
  await page.goto(BASE);
  await open();
  const reload = async () => {
    await page.reload();
    await open();
  };
  return { context, page, cdp, errors, touch, tapPoint, tap, center, onScreen, debug, sounds, breathing, watchAsks, badAsks, until, reload };
}

// The fish tab on its own: one row of tabs that are not clipped, a tank and
// buttons clear of the grip band with nothing scrolling, buttons that take a
// tap anywhere on them, and a fish inside the water.
async function checkLayout(browser, viewport) {
  const label = `${viewport.label} ${viewport.width}x${viewport.height}`;
  // Cloudy, so both buttons show.
  const fish = await openFish(browser, { viewport, saved: (now) => ({ v: 1, bornAt: now - 60 * 864e5, updatedAt: now, hunger: 0.5, dirt: 0.5, health: 1, goodMs: 50 * 864e5, leftovers: 6 }) });
  try {
    await wait(400);
    await fish.page.screenshot({ path: path.join(evidence, `${viewport.label.replace(/\s+/g, "-")}.png`) });
    const layout = await fish.page.evaluate(() => {
      // Measure the buttons arrived and at their biggest: the breath peaks
      // halfway through its loop.
      document.getAnimations().forEach((animation) => {
        const timing = animation.effect.getTiming();
        if (timing.iterations !== Infinity) {
          animation.finish();
          return;
        }
        animation.pause();
        animation.currentTime = timing.duration / 2;
      });
      const edge = safeEdge();
      const rect = (element) => element.getBoundingClientRect();
      const tabs = [...document.querySelectorAll("#page-tabs button")];
      const tank = document.getElementById("fish-tank");
      const buttons = [...document.querySelectorAll(".fish-button")].filter((button) => !button.hidden);
      const fishBox = rect(document.querySelector(".tank-fish"));
      const tankBox = rect(tank);
      const debug = fishTank.debug();
      // Five points across each button must land on it.
      const missed = buttons.flatMap((button) => {
        const box = rect(button);
        return [[0.5, 0.5], [0.2, 0.3], [0.8, 0.3], [0.2, 0.7], [0.8, 0.7]]
          .map(([fx, fy]) => [box.left + box.width * fx, box.top + box.height * fy])
          .filter(([x, y]) => !button.contains(document.elementFromPoint(x, y)))
          .map(([x, y]) => `${button.id} at ${Math.round(x)},${Math.round(y)}`);
      });
      const spilled = buttons.flatMap((button) => {
        const box = rect(button);
        return [...button.children].filter((child) => {
          const inner = rect(child);
          return inner.left < box.left - 1 || inner.right > box.right + 1 || inner.top < box.top - 1 || inner.bottom > box.bottom + 1;
        }).map((child) => `${button.id} ${child.tagName}`);
      });
      return {
        spilled,
        edge,
        oneRow: tabs.every((tab) => Math.abs(rect(tab).top - rect(tabs[0]).top) < 1),
        clippedTabs: tabs.filter((tab) => tab.scrollWidth > tab.clientWidth + 1 || tab.scrollHeight > tab.clientHeight + 1).map((tab) => tab.textContent.trim()),
        tank: tankBox.toJSON(),
        buttons: buttons.map((button) => rect(button).toJSON()),
        missed,
        scrolls: document.documentElement.scrollHeight > innerHeight + 1 || document.documentElement.scrollWidth > innerWidth + 1,
        fishInside: debug.fish.x > 0 && debug.fish.x < tank.clientWidth && debug.fish.y > debug.geometry.surface && debug.fish.y < debug.geometry.pebbleTop,
        fishOnScreen: fishBox.width > 0 && fishBox.left < tankBox.right && fishBox.right > tankBox.left,
        fishLength: debug.fish.length,
        tankArea: tank.clientWidth * tank.clientHeight,
        innerWidth,
        innerHeight,
      };
    });
    // The thought bubble stays in the water while the fish swims about,
    // including right up at the surface.
    await fish.page.evaluate(() => document.getAnimations().forEach((animation) => animation.play()));
    const escapes = await fish.page.evaluate(() => new Promise((resolve) => {
      const tank = document.getElementById("fish-tank");
      const bubble = document.querySelector(".tank-thought > span");
      const out = [];
      let frames = 0;
      const { geometry } = fishTank.debug();
      const sample = () => {
        frames += 1;
        // Lead the fish up into a corner at the surface, then let it be.
        // The bubble is placed every frame, shown or not.
        if (frames === 40) {
          const box = tank.getBoundingClientRect();
          fishTank.follow(box.left + 4, box.top + 4);
        }
        if (frames === 120) fishTank.release();
        const box = tank.getBoundingClientRect();
        const rect = bubble.getBoundingClientRect();
        const left = rect.left - box.left - tank.clientLeft;
        const top = rect.top - box.top - tank.clientTop;
        if (left < 0 || left + rect.width > tank.clientWidth || top < geometry.surface || top + rect.height > geometry.pebbleTop) {
          out.push({ frame: frames, left: Math.round(left), top: Math.round(top) });
        }
        if (frames < 200) requestAnimationFrame(sample);
        else resolve(out);
      };
      requestAnimationFrame(sample);
    }));
    assert.equal((await fish.debug()).thought, "food", `${label}: the fish asks for food again once let go`);
    assert.deepEqual(escapes, [], `${label}: the thought bubble stays in the water`);
    const { edge, tank, buttons } = layout;
    assert.ok(layout.oneRow, `${label}: the seven tabs fit in one row`);
    assert.deepEqual(layout.clippedTabs, [], `${label}: no tab is clipped`);
    assert.equal(layout.scrolls, false, `${label}: the page does not scroll`);
    for (const box of [tank, ...buttons]) {
      assert.ok(box.left >= edge - 0.5 && box.right <= layout.innerWidth - edge + 0.5 && box.bottom <= layout.innerHeight - edge + 0.5,
        `${label}: tank and buttons clear the grip band: ${JSON.stringify(box)}`);
    }
    assert.equal(buttons.length, 2, `${label}: Feed and Change water both show`);
    assert.deepEqual(layout.missed, [], `${label}: every part of each button takes a tap`);
    assert.deepEqual(layout.spilled, [], `${label}: each button's picture and word fit inside it`);
    assert.ok(layout.tankArea > layout.innerWidth * layout.innerHeight * 0.3, `${label}: the tank gets most of the screen`);
    assert.ok(layout.fishInside && layout.fishOnScreen, `${label}: the fish is in the water`);
    assert.ok(layout.fishLength >= 80, `${label}: a two-month-old fish is big enough to tap: ${layout.fishLength}px`);
    assert.deepEqual(fish.errors, []);
    return { label, tank: `${Math.round(tank.width)}x${Math.round(tank.height)}`, fish: layout.fishLength };
  } finally {
    await fish.context.close();
  }
}

// Feeding, overfeeding, and changing the water.
async function checkCare(browser) {
  const fish = await openFish(browser);
  const { page } = fish;
  try {
    let value = await fish.debug();
    assert.equal(value.look.hungry, true, "a new fish is hungry");
    assert.equal(value.thought, "food", "it thinks of food");
    assert.equal(await page.locator("#fish-feed.wanted").count(), 1, "Feed glows");
    assert.equal(await fish.breathing("#fish-feed"), true, "and breathes");
    await fish.watchAsks();
    assert.equal(await page.locator("#fish-water").isHidden(), true, "Change water is not shown yet");
    assert.ok(value.look.size < 0.4, "it starts as a baby");
    assert.equal(await page.evaluate(() => countingSince), null, "opening the tab does not count as play");

    await fish.tap("#fish-feed");
    assert.notEqual(await page.evaluate(() => countingSince), null, "feeding counts as play");
    value = await fish.debug();
    assert.equal(value.flakes.length, 3, "one tap sprinkles three flakes");
    assert.ok((await fish.sounds()).includes("sprinkle"), "with a shaker sound");
    value = await fish.until("it eats all three", (v) => v.flakes.length === 0);
    assert.equal(value.leftovers, 0, "none reached the pebbles");
    assert.ok(Math.abs(value.state.hunger - 0.3) < 0.01, `three flakes eaten: ${value.state.hunger}`);
    assert.equal((await fish.sounds()).filter((name) => name === "gulp").length, 3, "a gulp for each");
    assert.equal(value.look.hungry, false, "no longer looks hungry");
    await wait(400);
    assert.equal((await fish.debug()).thought, "", "and stops asking for food");
    assert.equal(await page.locator("#fish-feed.wanted").count(), 0, "Feed stops glowing");

    await fish.tap("#fish-feed");
    value = await fish.until("it eats until full", (v) => v.flakes.length === 0);
    assert.equal(value.leftovers, 0);
    assert.equal(value.look.wantsFood, false, "now it is full");
    assert.ok((await fish.sounds()).includes("happy"), "a happy sound when full");

    // Full: it shakes its head and the food settles on the pebbles.
    await fish.tap("#fish-feed");
    assert.equal((await fish.debug()).fish.shaking, true, "a full fish shakes its head at food");
    value = await fish.until("the flakes settle", (v) => v.flakes.length === 0, 15000);
    assert.equal(value.leftovers, 3, "three flakes on the pebbles");
    assert.equal(value.state.leftovers, 3);
    assert.ok(Math.abs(value.state.dirt - 0.15) < 0.01, `which dirty the water: ${value.state.dirt}`);
    assert.equal(await page.locator("#fish-water").isHidden(), true, "not cloudy enough to change yet");

    await fish.tap("#fish-feed");
    await wait(300);
    await fish.tap("#fish-feed");
    value = await fish.until("more flakes settle", (v) => v.flakes.length === 0, 15000);
    assert.equal(value.leftovers, 9);
    assert.equal(value.look.needsWater, true, "the water is cloudy");
    await wait(1600); // The cloud fades in.
    const cloud = await page.locator(".tank-cloud").evaluate((element) => Number(getComputedStyle(element).opacity));
    assert.ok(cloud > 0.3, `and looks it: ${cloud}`);
    assert.equal(await page.locator("#fish-water").isVisible(), true, "Change water appears");
    value = await fish.debug();
    assert.equal(value.thought, "water", "the fish asks for clean water");
    assert.equal(await page.locator("#fish-water.wanted").count(), 1, "Change water glows");
    assert.equal(await fish.breathing("#fish-water"), true, "and breathes");
    assert.equal(await fish.breathing("#fish-feed"), false, "while Feed is still");
    await page.screenshot({ path: path.join(evidence, "cloudy.png") });

    // Change the water, watching every frame that the fish stays in it.
    await fish.tap("#fish-water");
    const watched = await page.evaluate(() => new Promise((resolve) => {
      const frames = [];
      const started = performance.now();
      const sample = () => {
        const value = fishTank.debug();
        frames.push({ draining: value.draining, level: value.level, top: value.fish.y - value.fish.length * 0.3, flakes: value.flakes.length });
        if (performance.now() - started < 4000) requestAnimationFrame(sample);
        else resolve(frames);
      };
      requestAnimationFrame(sample);
    }));
    const lowest = Math.max(...watched.map((frame) => frame.level));
    assert.ok(watched.some((frame) => frame.draining), "the water drains");
    assert.ok(lowest > (await fish.debug()).geometry.surface + 100, `about half the water goes: down to ${Math.round(lowest)}px`);
    const dry = watched.filter((frame) => frame.top < frame.level - 1);
    assert.deepEqual(dry, [], "the fish stays under the water line in every frame");
    value = await fish.debug();
    assert.equal(value.draining, false, "and it refills");
    assert.ok(value.state.dirt < 0.001, `with clean water: ${value.state.dirt}`);
    assert.equal(value.leftovers, 0, "the old food is gone");
    assert.equal(value.state.leftovers, 0);
    await wait(1500);
    assert.equal(await page.locator(".tank-cloud").evaluate((element) => Number(getComputedStyle(element).opacity)), 0, "the water is clear");
    assert.equal(await page.locator("#fish-water").isHidden(), true, "Change water goes away");
    const heard = await fish.sounds();
    for (const name of ["drain", "fill"]) assert.ok(heard.includes(name), `${name} sound`);
    assert.equal(await fish.badAsks(), 0, "it never asked for water while Change water was hidden");
    assert.deepEqual(fish.errors, []);
    return { sounds: heard.length };
  } finally {
    await fish.context.close();
  }
}

// Taps on the fish, the ship and the water; leading with a finger.
async function checkPlay(browser) {
  // A grown, well, full fish, so it does not chase food or ask for anything.
  const fish = await openFish(browser, { saved: (now) => ({ v: 1, bornAt: now - 90 * 864e5, updatedAt: now, hunger: 0, dirt: 0, health: 1, goodMs: 80 * 864e5, leftovers: 0 }) });
  const { page } = fish;
  try {
    let value = await fish.debug();
    const geometry = value.geometry;

    // Call the fish across the tank and tap it as it passes, holding on a
    // little: by the time the tap is recognized, the fish has moved on.
    const far = { x: value.fish.x > geometry.width / 2 ? geometry.width * 0.1 : geometry.width * 0.9, y: geometry.surface + 90 };
    await page.evaluate(({ x, y }) => fishTank.tap(x, y), await fish.onScreen(far));
    await wait(300);
    value = await fish.debug();
    await fish.tapPoint(await fish.onScreen(value.fish), 450);
    const moved = Math.hypot((await fish.debug()).fish.x - value.fish.x, (await fish.debug()).fish.y - value.fish.y);
    assert.ok(moved > Math.max(value.fish.length * 0.6, 34), `the fish had swum out from under the finger: ${Math.round(moved)}px`);
    await wait(300);
    assert.ok((await page.evaluate(() => window.media)).includes("audio/goldfish.mp3"), "tapping the fish says Goldfish");
    assert.ok(await page.locator(".tank-bubble").count() > 0, "and it blows bubbles");

    // The ship, with the fish held away from it.
    const away = await fish.onScreen({ x: geometry.width * 0.15, y: geometry.surface + 60 });
    await page.evaluate(({ x, y }) => fishTank.follow(x, y), away);
    await wait(2000);
    const ship = await fish.onScreen({ x: geometry.ship.x, y: geometry.ship.y - geometry.ship.size * 0.12 });
    await fish.tapPoint(ship);
    await page.evaluate(() => fishTank.release());
    await wait(400);
    assert.equal((await page.evaluate(() => window.media)).at(-1), "audio/pirate-ship.mp3", "tapping the ship says Pirate ship");
    assert.ok(await page.locator(".tank-bubble").count() > 2, "and bubbles come out of it");
    assert.ok(!(await page.evaluate(() => window.media)).some((entry) => entry.startsWith("speech:")), "recordings, not the speech fallback");

    // The water: the fish comes to see.
    value = await fish.debug();
    const spot = { x: value.fish.x > geometry.width / 2 ? geometry.width * 0.15 : geometry.width * 0.85, y: geometry.surface + (geometry.pebbleTop - geometry.surface) * 0.3 };
    await fish.tapPoint(await fish.onScreen(spot));
    assert.equal((await fish.debug()).coming, true, "a tap on the water calls the fish");
    assert.ok((await fish.sounds()).includes("plip"));
    value = await fish.until("it swims over", (v) => Math.hypot(v.fish.x - spot.x, v.fish.y - spot.y) < v.fish.length * 0.6, 6000);

    // A moving finger leads it.
    const path1 = Array.from({ length: 40 }, (_, i) => ({
      x: geometry.width * (0.2 + 0.6 * i / 39),
      y: geometry.surface + (geometry.pebbleTop - geometry.surface) * (0.6 - 0.2 * Math.sin(i / 39 * Math.PI)),
    }));
    const first = await fish.onScreen(path1[0]);
    await fish.touch("touchStart", [first]);
    for (const point of path1) {
      await fish.touch("touchMove", [await fish.onScreen(point)]);
      await wait(40);
    }
    value = await fish.debug();
    assert.equal(value.following, true, "a moving finger leads the fish");
    await wait(1500);
    value = await fish.debug();
    const end = path1.at(-1);
    assert.ok(Math.hypot(value.fish.x - end.x, value.fish.y - end.y) < value.fish.length, "and the fish catches up");
    await fish.touch("touchEnd", []);
    await wait(100);
    assert.equal((await fish.debug()).following, false, "it lets go with the finger");

    // A leading finger that flattens into a palm lets the fish go.
    const palmPath = Array.from({ length: 30 }, (_, i) => ({ x: geometry.width * (0.8 - 0.5 * i / 29), y: geometry.surface + 120 }));
    await fish.touch("touchStart", [await fish.onScreen(palmPath[0])]);
    for (const [index, point] of palmPath.entries()) {
      const radius = index < 15 ? 8 : 45;
      await fish.touch("touchMove", [{ ...(await fish.onScreen(point)), radiusX: radius, radiusY: radius }]);
      await wait(30);
      if (index === 12) assert.equal((await fish.debug()).following, true, "the finger leads");
    }
    assert.equal((await fish.debug()).following, false, "a palm does not keep leading");
    await fish.touch("touchEnd", []);
    await wait(200);
    // Hungry now, it is free to chase food rather than a finger long gone.
    await page.evaluate(() => { fishTank.state = { ...fishTank.state, hunger: 0.6 }; });
    await fish.tap("#fish-feed");
    assert.ok((await fish.debug()).flakes.length > 0);
    value = await fish.until("the fish is free to eat", (v) => v.flakes.length === 0, 12000);
    assert.equal(value.leftovers, 0, "it ate every flake");
    await page.evaluate(() => { fishTank.state = { ...fishTank.state, hunger: 0 }; });

    // A long lead is play the whole time: the screen does not dim under it.
    const sweep = (i) => ({ x: geometry.width * (0.3 + 0.4 * ((i % 20) / 19)), y: geometry.surface + 150 });
    await fish.touch("touchStart", [await fish.onScreen(sweep(0))]);
    for (let i = 1; i <= 80; i += 1) {
      await fish.touch("touchMove", [await fish.onScreen(sweep(i))]);
      await wait(30);
      // Thirty seconds pass twice during the lead, with real time between.
      if (i === 20 || i === 60) await page.evaluate(() => window.advanceClock(30 * 1000));
    }
    assert.equal(await page.evaluate(() => idleDim.hidden), true, "a minute of leading does not dim the screen");
    assert.equal((await fish.debug()).following, true, "and the fish is still led");
    await fish.touch("touchEnd", []);
    await wait(200);

    // A mouse drag leads; the click that ends it is not also a tap.
    const from = await fish.onScreen({ x: geometry.width * 0.2, y: geometry.surface + 200 });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 120, from.y + 20, { steps: 12 });
    assert.equal((await fish.debug()).following, true, "a mouse drag leads");
    await page.mouse.up();
    await wait(200);
    value = await fish.debug();
    assert.equal(value.following, false);
    assert.equal(value.coming, false, "the click ending a drag is not a tap");

    // A resting finger does nothing.
    const mediaBefore = (await page.evaluate(() => window.media)).length;
    const rest = await fish.onScreen({ x: geometry.width * 0.5, y: geometry.surface + 40 });
    await fish.touch("touchStart", [rest]);
    await wait(1200);
    await fish.touch("touchEnd", []);
    await wait(200);
    value = await fish.debug();
    assert.equal(value.following, false, "a resting finger does not lead");
    assert.equal(value.coming, false, "and a long hold is not a tap");
    assert.equal((await page.evaluate(() => window.media)).length, mediaBefore);
    assert.deepEqual(fish.errors, []);
  } finally {
    await fish.context.close();
  }
}

// Time passes in real time and the fish lives on between visits.
async function checkTime(browser) {
  const results = {};
  // Saved, then back after a reload.
  {
    const fish = await openFish(browser);
    try {
      await fish.tap("#fish-feed");
      await fish.until("eaten", (v) => v.flakes.length === 0);
      const before = await fish.debug();
      await fish.reload();
      const after = await fish.debug();
      assert.ok(Math.abs(after.state.hunger - before.state.hunger) < 0.01, "a reload keeps how hungry it is");
      assert.equal(after.state.bornAt, before.state.bornAt, "and the same fish");
      assert.deepEqual(fish.errors, []);
    } finally {
      await fish.context.close();
    }
  }
  // Overnight: hungry and cloudy, but not sick.
  {
    const fish = await openFish(browser, { saved: (now) => ({ v: 1, bornAt: now - 10 * 864e5, updatedAt: now - 30 * 36e5, hunger: 0, dirt: 0, health: 1, goodMs: 8 * 864e5, leftovers: 0 }) });
    try {
      const value = await fish.debug();
      assert.equal(value.look.hungry, true, "hungry in the morning");
      assert.equal(value.look.needsWater, true, "its water clouded overnight");
      assert.equal(value.look.sick, false, "but it is not sick");
      assert.equal(await fish.page.locator("#fish-water").isVisible(), true);
      assert.equal(value.thought, "food", "it asks for breakfast first");
      assert.equal(value.look.ageDays, 10);
      assert.deepEqual(fish.errors, []);
    } finally {
      await fish.context.close();
    }
  }
  // Four days away: sick in dirty water, then well once it is changed.
  {
    const fish = await openFish(browser, { saved: (now) => ({ v: 1, bornAt: now - 30 * 864e5, updatedAt: now - 4 * 864e5, hunger: 0, dirt: 0, health: 1, goodMs: 25 * 864e5, leftovers: 4 }) });
    const { page } = fish;
    try {
      let value = await fish.debug();
      assert.equal(value.look.sick, true, "sick after days of dirty water");
      assert.equal(value.thought, "water", "it asks for clean water, not food");
      assert.equal(await page.locator("#fish-water.wanted").count(), 1);
      await page.screenshot({ path: path.join(evidence, "sick.png") });
      // It mopes low in the tank.
      const depths = [];
      for (let i = 0; i < 20; i += 1) {
        value = await fish.debug();
        depths.push((value.fish.y - value.geometry.surface) / (value.geometry.pebbleTop - value.geometry.surface));
        await wait(150);
      }
      const meanDepth = depths.reduce((sum, depth) => sum + depth, 0) / depths.length;
      // A sick fish does not eat.
      await fish.tap("#fish-feed");
      value = await fish.until("the food settles", (v) => v.flakes.length === 0, 15000);
      assert.equal(value.state.hunger, 1, "a sick fish leaves its food");
      assert.equal(value.leftovers, 7);
      await fish.watchAsks();
      await fish.tap("#fish-water");
      await fish.until("the water is changed", (v) => !v.draining && v.state.dirt < 0.001, 6000);
      // Still getting well, it asks for food, not for the water it just got,
      // and eats.
      value = await fish.until("then it asks for food", (v) => v.thought === "food", 3000);
      assert.equal(value.look.sick, true, "still getting well");
      await fish.tap("#fish-feed");
      value = await fish.until("and eats again", (v) => v.state.hunger < 1 && v.flakes.length === 0);
      assert.equal(value.leftovers, 0, "every flake eaten");
      // Twenty seconds after the change, with no touch long enough to dim.
      await page.evaluate(() => {
        recordInteraction();
        window.advanceClock(20 * 1000);
      });
      await fish.until("it gets well", (v) => !v.look.sick, 3000);
      assert.equal(await fish.badAsks(), 0, "it never asked for water while Change water was hidden");
      results.sickDepth = Number(meanDepth.toFixed(2));
      assert.ok(meanDepth > 0.55, `it stayed low while sick: ${meanDepth}`);
      assert.deepEqual(fish.errors, []);
    } finally {
      await fish.context.close();
    }
  }
  // Grown over months: bigger, with a fan tail, and orange at every age.
  {
    const baby = await openFish(browser);
    const babyLength = (await baby.debug()).fish.length;
    assert.equal((await baby.debug()).palette.back, "rgb(255, 122, 31)", "a new baby is already orange");
    await baby.context.close();
    const fish = await openFish(browser, { saved: (now) => ({ v: 1, bornAt: now - 150 * 864e5, updatedAt: now, hunger: 0.1, dirt: 0, health: 1, goodMs: 110 * 864e5, leftovers: 0 }) });
    try {
      const value = await fish.debug();
      assert.ok(value.fish.length > babyLength * 2.2, `grown: ${value.fish.length}px, from ${babyLength}px`);
      assert.equal(value.palette.back, "rgb(255, 122, 31)", "orange");
      assert.ok(value.look.fins > 0.6, "with a long fan tail");
      await fish.page.screenshot({ path: path.join(evidence, "grown.png") });
      results.lengths = { baby: babyLength, grown: value.fish.length };
      assert.deepEqual(fish.errors, []);
    } finally {
      await fish.context.close();
    }
  }
  return results;
}

// The tank animates only while it is showing and the app is awake.
async function checkLifecycle(browser) {
  const fish = await openFish(browser);
  const { page } = fish;
  const frames = async () => (await fish.debug()).frames;
  const stopped = async (label) => {
    const before = await frames();
    await wait(400);
    assert.equal(await frames(), before, `${label}: no frames`);
    assert.equal((await fish.debug()).active, false, `${label}: inactive`);
    // The page can stay on screen under the dim or a break; nothing in it
    // may keep looping there either.
    const looping = await page.evaluate(() => document.getAnimations()
      .filter((animation) => animation.playState === "running" && animation.effect.getTiming().iterations === Infinity
        && document.getElementById("fish-screen").contains(animation.effect.target))
      .map((animation) => animation.animationName || animation.effect.target.className));
    assert.deepEqual(looping, [], `${label}: no looping animations`);
  };
  const running = async (label) => {
    const before = await frames();
    await wait(400);
    assert.ok(await frames() > before + 5, `${label}: frames run`);
  };
  try {
    // Leaving with food still falling: the hungry fish eats it while away.
    await fish.tap("#fish-feed");
    await fish.tap('[data-page-target="animals"]');
    await stopped("another tab");
    let value = await fish.debug();
    assert.equal(value.flakes.length, 0, "no flakes are left hanging");
    assert.ok(value.state.hunger < 0.35, "the hungry fish ate them");
    assert.ok(JSON.parse(await page.evaluate((key) => localStorage.getItem(key), KEY)).updatedAt > Date.now() - 5000, "saved on leaving");
    await fish.tap('[data-page-target="fish"]');
    await running("back on the tab");

    // Leaving halfway through a water change finishes it, without a chime
    // on the next page.
    await page.evaluate(() => {
      fishTank.state = { ...fishTank.state, dirt: 0.5, leftovers: 6 };
    });
    await fish.tap("#fish-water");
    await wait(600);
    assert.equal((await fish.debug()).draining, true);
    const heard = (await fish.sounds()).length;
    await fish.tap('[data-page-target="animals"]');
    value = await fish.debug();
    assert.equal(value.draining, false, "the water change finishes on leaving");
    assert.ok(value.state.dirt < 0.001 && value.state.leftovers === 0 && value.leftovers === 0, "with clean water");
    await wait(300);
    assert.deepEqual((await fish.sounds()).slice(heard), [], "and no sound after leaving");
    await fish.tap('[data-page-target="fish"]');
    await running("back again");

    // The puzzle keeps the audio running: the drain must still stop.
    await page.evaluate(() => {
      fishTank.state = { ...fishTank.state, dirt: 0.5, leftovers: 6 };
    });
    await fish.tap("#fish-water");
    await wait(400);
    assert.ok(await page.evaluate(() => fishSoundNodes.size) > 0, "the drain is playing");
    await fish.tap('[data-page-target="puzzle"]');
    assert.equal(await page.evaluate(() => fishSoundNodes.size), 0, "and stops on the puzzle page");
    await fish.tap('[data-page-target="fish"]');
    await running("and back");

    // Hungry, so Feed breathes and the fish thinks of food: both loop, and
    // both must stop under the dim.
    await page.evaluate(() => {
      fishTank.state = { ...fishTank.state, hunger: 0.6 };
    });
    await fish.until("it asks for food", (v) => v.thought === "food", 3000);
    assert.equal(await fish.breathing("#fish-feed"), true);
    await page.evaluate(() => showIdleDim());
    await stopped("dimmed");
    await fish.tapPoint(await fish.center("#idle-dim"));
    await running("woken");

    await fish.until("it asks for food again", (v) => v.thought === "food", 3000);
    await page.evaluate(() => lockForBreak());
    await stopped("screen-time break");
    await page.evaluate(() => resetScreenTime());
    await running("after the break");

    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await stopped("app hidden");
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await stopped("back but dimmed");
    await fish.tapPoint(await fish.center("#idle-dim"));
    await running("woken again");

    // The fish canvas only ever translates.
    const transforms = await page.evaluate(() => new Promise((resolve) => {
      const seen = [];
      const sample = () => {
        const style = getComputedStyle(document.querySelector(".tank-fish"));
        const matrix = new DOMMatrixReadOnly(style.transform);
        seen.push(matrix.a === 1 && matrix.b === 0 && matrix.c === 0 && matrix.d === 1 && style.scale === "none" && style.rotate === "none");
        if (seen.length < 60) requestAnimationFrame(sample);
        else resolve(seen);
      };
      requestAnimationFrame(sample);
    }));
    assert.ok(transforms.every(Boolean), "the fish layer is only ever translated");
    assert.deepEqual(fish.errors, []);
  } finally {
    await fish.context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    // ONLY=care,time runs just those parts.
    const only = (process.env.ONLY || "layout,care,play,time,lifecycle").split(",");
    const results = { passed: true };
    if (only.includes("layout")) {
      results.layouts = [];
      for (const viewport of VIEWPORTS) results.layouts.push(await checkLayout(browser, viewport));
    }
    if (only.includes("care")) results.care = await checkCare(browser);
    if (only.includes("play")) await checkPlay(browser);
    if (only.includes("time")) results.time = await checkTime(browser);
    if (only.includes("lifecycle")) await checkLifecycle(browser);
    console.log(JSON.stringify({ ...results, evidence }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  console.error(`Evidence: ${evidence}`);
  process.exitCode = 1;
});
