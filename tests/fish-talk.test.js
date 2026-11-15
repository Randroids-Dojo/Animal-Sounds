"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Goldfish = require("../goldfish.js");
const FishTalk = require("../fish-talk.js");

const { DAY, HOUR, MINUTE } = Goldfish;
const T0 = Date.UTC(2026, 10, 15, 9);

function seeded(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const keys = (fish, now) => {
  const { status, about } = FishTalk.facts(Goldfish.looks(fish, now), fish, now);
  return { status: status.map((fact) => fact.key), about: about.map((fact) => fact.key) };
};

// n taps on an unchanging fish.
function taps(fish, now, n, talker = FishTalk.createTalker(seeded(3))) {
  const look = Goldfish.looks(fish, now);
  return Array.from({ length: n }, () => FishTalk.next(talker, look, fish, now));
}

test("every line has words and a recording", () => {
  const all = FishTalk.all();
  assert.equal(new Set(all.map((line) => line.id)).size, all.length, "ids are unique");
  for (const line of all) {
    assert.ok(line.text.trim(), line.id);
    assert.ok(fs.statSync(path.join(__dirname, "..", line.audio)).size > 0, `${line.id}: ${line.audio}`);
  }
});

test("its age is said in days, then weeks, months and years", () => {
  const said = (days) => FishTalk.ageLine(days).text;
  assert.equal(said(0), "The goldfish was born today!");
  assert.equal(said(1), "The goldfish is one day old.");
  assert.equal(said(6), "The goldfish is six days old.");
  assert.equal(said(7), "The goldfish is one week old.");
  assert.equal(said(27), "The goldfish is three weeks old.");
  assert.equal(said(28), "The goldfish is one month old.");
  assert.equal(said(61), "The goldfish is two months old.");
  assert.equal(said(364), "The goldfish is eleven months old.");
  assert.equal(said(365), "The goldfish is one year old!");
  assert.equal(said(4 * 365.25 + 1), "The goldfish is four years old!");
  assert.equal(said(10000), "The goldfish is more than five years old!");
  for (let days = 0; days < 4000; days += 1) assert.ok(FishTalk.ageLine(days), `a line for day ${days}`);
});

test("what it talks about follows how it is doing", () => {
  const fish = Goldfish.create(T0);
  assert.deepEqual(keys(fish, T0), { status: ["hungry"], about: ["self", "hello"] }, "a new fish");
  const self = FishTalk.facts(Goldfish.looks(fish, T0), fish, T0).about.find((fact) => fact.key === "self");
  assert.deepEqual(self.lines.map((line) => line.id), ["age-today", "size-baby"], "its age and size share a turn");

  while (Goldfish.eat(fish, T0));
  assert.deepEqual(keys(fish, T0).status, [], "fed");
  assert.deepEqual(keys(fish, T0).about, ["ate", "happy", "self", "hello"], "just ate, and happy");
  assert.deepEqual(keys(fish, T0 + 11 * MINUTE).about, ["happy", "self", "hello"], "a while after eating");

  for (let flake = 0; flake < 3; flake += 1) Goldfish.leftover(fish);
  assert.deepEqual(keys(fish, T0).status, ["overfed"], "full, with food on the pebbles");
  for (let flake = 0; flake < 3; flake += 1) Goldfish.leftover(fish);
  assert.deepEqual(keys(fish, T0).status, ["overfed", "cloudy"], "and now the water is cloudy");

  // Days in dirty water: sick, and too sick to want food.
  Goldfish.advance(fish, T0 + 4 * DAY);
  assert.deepEqual(keys(fish, T0 + 4 * DAY).status, ["sick"]);
  Goldfish.changeWater(fish);
  Goldfish.advance(fish, T0 + 4 * DAY + 5000);
  assert.deepEqual(keys(fish, T0 + 4 * DAY + 5000).status, ["better", "hungry"], "fresh water: getting better, and hungry");
  assert.ok(!keys(fish, T0 + 4 * DAY + 5000).about.includes("happy"), "not happy yet");
});

test("it grows from a baby to growing to grown", () => {
  const sized = (goodDays) => {
    const fish = { ...Goldfish.create(T0), hunger: 0, goodMs: goodDays * DAY };
    const self = FishTalk.facts(Goldfish.looks(fish, T0), fish, T0).about.find((fact) => fact.key === "self");
    return self.lines[1].id.replace("size-", "");
  };
  assert.equal(sized(0), "baby");
  assert.equal(sized(30), "growing");
  assert.equal(sized(150), "grown");
});

test("how it is doing comes every other tap, each phrasing in turn", () => {
  const fish = Goldfish.create(T0);
  const said = taps(fish, T0, 12);
  said.forEach((line, index) => {
    assert.equal(line.fact === "hungry", index % 2 === 0, `tap ${index + 1}: ${line.fact}`);
  });
  const hungry = said.filter((line) => line.fact === "hungry").map((line) => line.id);
  assert.equal(new Set(hungry.slice(0, 3)).size, 3, "all three hungry lines before any repeats");
  // In between: its age or size, then a hello, in turn.
  const about = said.filter((line) => line.fact !== "hungry").slice(0, 4);
  assert.deepEqual(about.map((line) => line.fact), ["self", "hello", "self", "hello"]);
  assert.deepEqual(about.filter((line) => line.fact === "self").map((line) => line.id).sort(), ["age-today", "size-baby"]);
});

test("a happy fish talks about itself, and never says the same thing twice in a row", () => {
  const fish = { ...Goldfish.create(T0), hunger: 0 };
  const said = taps(fish, T0, 40);
  assert.ok(said.every((line) => !FishTalk.STATUS.includes(line.fact)));
  // Happy, then its age or size, then a hello, each in turn: nothing comes
  // back within three taps.
  for (let index = 2; index < said.length; index += 1) {
    const window = said.slice(index - 2, index + 1).map((line) => line.id);
    assert.equal(new Set(window).size, 3, `taps ${index - 1} to ${index + 1}: ${window}`);
  }
  assert.ok(new Set(said.slice(0, 8).map((line) => line.id)).size >= 6, `variety: ${said.slice(0, 8).map((line) => line.id)}`);
});

test("no line comes twice in a row however the fish changes between taps", () => {
  const random = seeded(11);
  const talker = FishTalk.createTalker(random);
  let last = null;
  let now = T0;
  const fish = Goldfish.create(T0);
  for (let tap = 0; tap < 3000; tap += 1) {
    // Anything can happen between taps: time, food, leftovers, fresh water.
    const roll = random();
    if (roll < 0.3) now += random() * 6 * HOUR;
    else if (roll < 0.5) Goldfish.eat(fish, now);
    else if (roll < 0.6) Goldfish.leftover(fish);
    else if (roll < 0.65) Goldfish.changeWater(fish);
    else now += random() * 20 * 1000;
    Goldfish.advance(fish, now);
    const line = FishTalk.next(talker, Goldfish.looks(fish, now), fish, now);
    assert.ok(line && line.text && line.audio, `tap ${tap}`);
    assert.notEqual(line.id, last, `tap ${tap} repeats ${line.id}`);
    last = line.id;
  }
});
