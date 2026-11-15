"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Goldfish = require("../goldfish.js");

const { RULES, DAY, HOUR, MINUTE } = Goldfish;
const T0 = Date.UTC(2026, 10, 14, 9);

// A fish fed to full at each of the day's times (in hours) and given fresh
// water once a day, for the given number of days.
function careFor(days, feedHours = [8, 12, 17]) {
  const fish = Goldfish.create(T0);
  for (let day = 0; day < days; day += 1) {
    for (const hour of feedHours) {
      Goldfish.advance(fish, T0 + day * DAY + hour * HOUR);
      while (Goldfish.eat(fish, T0 + day * DAY + hour * HOUR));
    }
    Goldfish.changeWater(fish);
  }
  Goldfish.advance(fish, T0 + days * DAY);
  return fish;
}

test("a new fish is a small, healthy, hungry baby in clean water", () => {
  const fish = Goldfish.create(T0);
  const looks = Goldfish.looks(fish, T0);
  assert.equal(looks.hungry, true, "the first thing to do is feed it");
  assert.equal(looks.sick, false);
  assert.equal(looks.needsWater, false);
  assert.equal(looks.cloud, 0);
  assert.equal(looks.size, RULES.babySize);
  assert.equal(looks.fins, 0, "with a short tail");
  assert.equal(looks.ageDays, 0);
});

test("feeding fills it, and a nearly full fish ignores flakes", () => {
  const fish = Goldfish.create(T0);
  let eaten = 0;
  while (Goldfish.eat(fish)) eaten += 1;
  assert.equal(eaten, 6, "a hungry new fish eats two feeds of three flakes");
  assert.ok(fish.hunger < RULES.eatsFrom);
  assert.equal(Goldfish.looks(fish, T0).hungry, false);
  // A whole play session later it still is not ready for more.
  Goldfish.advance(fish, T0 + 15 * MINUTE);
  assert.equal(Goldfish.wantsFood(fish), false);
  assert.equal(Goldfish.eat(fish), false);
  // About an hour later it will snack again, and it looks hungry by four hours.
  Goldfish.advance(fish, T0 + 70 * MINUTE);
  assert.equal(Goldfish.wantsFood(fish), true);
  assert.equal(Goldfish.looks(fish, T0 + 70 * MINUTE).hungry, false);
  Goldfish.advance(fish, T0 + 4 * HOUR);
  assert.equal(Goldfish.looks(fish, T0 + 4 * HOUR).hungry, true);
  Goldfish.advance(fish, T0 + 30 * HOUR);
  assert.equal(fish.hunger, 1, "hunger stops at starving");
});

test("uneaten flakes cloud the water, and fresh water clears it", () => {
  const fish = Goldfish.create(T0);
  for (let flake = 0; flake < 4; flake += 1) Goldfish.leftover(fish);
  assert.equal(Goldfish.looks(fish, T0).needsWater, false, "four flakes are not enough");
  Goldfish.leftover(fish);
  const cloudy = Goldfish.looks(fish, T0);
  assert.equal(cloudy.needsWater, true, "five flakes are");
  assert.ok(cloudy.cloud > 0.25, `already looks hazy: ${cloudy.cloud}`);
  assert.equal(cloudy.leftovers, 5);
  Goldfish.changeWater(fish);
  assert.equal(fish.dirt, 0);
  assert.equal(fish.leftovers, 0);
  for (let flake = 0; flake < 100; flake += 1) Goldfish.leftover(fish);
  assert.equal(fish.dirt, 1);
  assert.equal(fish.leftovers, RULES.maxLeftovers, "the pebbles hold only so many");
});

test("water clouds over on its own in about a day and gets bad after two", () => {
  const fish = Goldfish.create(T0);
  Goldfish.advance(fish, T0 + 20 * HOUR);
  assert.equal(Goldfish.looks(fish, T0 + 20 * HOUR).needsWater, false);
  Goldfish.advance(fish, T0 + 25 * HOUR);
  assert.equal(Goldfish.looks(fish, T0 + 25 * HOUR).needsWater, true);
  assert.equal(fish.health, 1, "cloudy water alone does not make it sick yet");
  Goldfish.advance(fish, T0 + 4 * DAY);
  assert.equal(fish.dirt, 1);
});

test("dirty water makes it sick over hours, and clean water makes it well in seconds", () => {
  const fish = Goldfish.create(T0);
  for (let flake = 0; flake < 12; flake += 1) Goldfish.leftover(fish);
  assert.ok(fish.dirt >= RULES.sickeningAt);
  Goldfish.advance(fish, T0 + 2 * HOUR);
  assert.equal(Goldfish.looks(fish, T0 + 2 * HOUR).sick, false, "not sick within one afternoon break");
  Goldfish.advance(fish, T0 + 4 * HOUR);
  const sick = Goldfish.looks(fish, T0 + 4 * HOUR);
  assert.equal(sick.sick, true);
  assert.ok(sick.sickness > 0 && sick.sickness <= 1);
  Goldfish.advance(fish, T0 + 30 * DAY);
  assert.equal(fish.health, 0, "never below the floor");
  assert.equal(Goldfish.looks(fish, T0 + 30 * DAY).sickness, 1);

  Goldfish.changeWater(fish);
  const later = T0 + 30 * DAY;
  Goldfish.advance(fish, later + 10 * 1000);
  assert.equal(Goldfish.looks(fish, later + 10 * 1000).sick, true, "not instantly");
  Goldfish.advance(fish, later + 20 * 1000);
  assert.equal(Goldfish.looks(fish, later + 20 * 1000).sick, false, "well again before the screen would dim");
  Goldfish.advance(fish, later + 2 * MINUTE);
  assert.equal(fish.health, 1);
});

test("one-second ticks and one long jump end up in the same place", () => {
  const ticked = Goldfish.create(T0);
  const jumped = Goldfish.create(T0);
  for (const fish of [ticked, jumped]) for (let flake = 0; flake < 12; flake += 1) Goldfish.leftover(fish);
  for (let second = 1; second <= 3 * 3600; second += 1) Goldfish.advance(ticked, T0 + second * 1000);
  Goldfish.advance(jumped, T0 + 3 * HOUR);
  for (const key of ["hunger", "dirt", "health", "goodMs"]) {
    assert.ok(Math.abs(ticked[key] - jumped[key]) < (key === "goodMs" ? 11 * MINUTE : 0.02), `${key}: ${ticked[key]} vs ${jumped[key]}`);
  }
});

test("it grows over months with care, its tail growing into a fan", () => {
  const sizes = [0, 7, 30, 60, 120, 240].map((days) => [days, Goldfish.looks(careFor(days), T0 + days * DAY)]);
  for (let index = 1; index < sizes.length; index += 1) {
    assert.ok(sizes[index][1].size > sizes[index - 1][1].size, `still growing at ${sizes[index][0]} days`);
  }
  const at = Object.fromEntries(sizes);
  assert.ok(at[7].size < 0.5, `a week old is still small: ${at[7].size}`);
  assert.ok(at[30].size > 0.55 && at[30].size < 0.75, `a month old is half grown: ${at[30].size}`);
  assert.ok(at[120].size > 0.85, `four months old is nearly grown: ${at[120].size}`);
  assert.ok(at[240].size < 1, "never past full size");
  assert.ok(at[120].fins > at[30].fins);
  assert.equal(at[120].ageDays, 120);
});

test("a neglected fish stops growing but never dies, and care brings it back", () => {
  const fish = careFor(30);
  const before = fish.goodMs;
  const away = T0 + 60 * DAY;
  Goldfish.advance(fish, away);
  // It kept growing only until it got too hungry or too sick.
  assert.ok(fish.goodMs - before < 2 * DAY, `hardly grew while away: ${(fish.goodMs - before) / DAY} days`);
  const looks = Goldfish.looks(fish, away);
  assert.equal(looks.sick, true);
  assert.equal(looks.hungry, true);
  Goldfish.changeWater(fish);
  while (Goldfish.eat(fish));
  Goldfish.advance(fish, away + 5 * MINUTE);
  const cared = Goldfish.looks(fish, away + 5 * MINUTE);
  assert.equal(cared.sick, false);
  assert.equal(cared.hungry, false);
  const grown = fish.goodMs;
  Goldfish.advance(fish, away + HOUR);
  assert.ok(fish.goodMs > grown, "growing again");
});

test("a clock set backwards changes nothing, and a huge jump is bounded", () => {
  const fish = Goldfish.create(T0);
  Goldfish.advance(fish, T0 + HOUR);
  const snapshot = { ...fish };
  // A tablet that boots with its clock reset, plays a while, then fixes it.
  Goldfish.advance(fish, T0 - 5 * DAY);
  Goldfish.advance(fish, T0 - 5 * DAY + HOUR);
  assert.deepEqual(fish, snapshot, "nothing changes while the clock is behind");
  const saved = Goldfish.restore(JSON.parse(JSON.stringify(fish)), Date.UTC(2000, 0, 1));
  assert.deepEqual(saved, snapshot, "a save restored under the wrong clock keeps its times");
  Goldfish.advance(fish, T0 + 2 * HOUR);
  assert.ok(Math.abs(fish.hunger - (snapshot.hunger + RULES.hungerPerHour)) < 1e-9, "then one more hour passes, not the wrong stretch");
  assert.equal(Goldfish.looks(fish, Date.UTC(2000, 0, 1)).ageDays, 0, "no negative age under a wrong clock");

  const started = performance.now();
  const far = Goldfish.create(T0);
  Goldfish.advance(far, T0 + 50 * 365 * DAY);
  assert.ok(performance.now() - started < 200, "catching up stays quick");
  assert.ok(far.goodMs <= RULES.maxCatchUp);
});

test("saved state is restored safely", () => {
  const fish = careFor(10);
  const restored = Goldfish.restore(JSON.parse(JSON.stringify(fish)), T0 + 10 * DAY);
  assert.deepEqual(restored, fish);
  for (const junk of [null, "fish", 7, {}, { v: 2, bornAt: T0 }, { v: 1 }, { v: 1, bornAt: "yesterday" }]) {
    assert.deepEqual(Goldfish.restore(junk, T0), Goldfish.create(T0), `starts over from ${JSON.stringify(junk)}`);
  }
  const wild = Goldfish.restore({ v: 1, bornAt: T0, updatedAt: T0 - DAY, hunger: 9, dirt: -3, health: "x", goodMs: -1, leftovers: 1e9 }, T0);
  assert.deepEqual(wild, { v: 1, bornAt: T0, updatedAt: T0, hunger: 1, dirt: 0, health: 1, goodMs: 0, leftovers: RULES.maxLeftovers, ateAt: 0 });
});
