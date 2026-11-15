"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const FishRings = require("../fish-rings.js");
const FishTalk = require("../fish-talk.js");

function seeded(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("a ring waits for the swim plus time to react, less as the score climbs", () => {
  const speed = 400;
  // Standing next to it, a first ring still gives over three seconds.
  assert.ok(FishRings.timeLimit(0, speed, 0) > 3);
  // Farther rings give more time; the swim is at most of full speed.
  assert.ok(FishRings.timeLimit(600, speed, 0) > FishRings.timeLimit(200, speed, 0));
  assert.ok(FishRings.timeLimit(600, speed, 0) - FishRings.timeLimit(0, speed, 0) > 600 / speed);
  // Quicker with each ring, down to a floor that stays fair.
  for (let score = 1; score < 40; score += 1) {
    assert.ok(FishRings.timeLimit(300, speed, score) <= FishRings.timeLimit(300, speed, score - 1));
  }
  assert.equal(FishRings.timeLimit(0, speed, 1000), FishRings.REACT_FLOOR);
});

test("a ring is sized for the fish, within bounds", () => {
  for (const L of [30, 87, 140, 230, 400]) {
    const { rx, ry, thickness } = FishRings.size(L);
    assert.ok(ry >= 46 && ry <= 110, `height for ${L}`);
    assert.ok(ry - thickness > L * 0.2, `the hole is taller than a fish of ${L} is deep`);
    assert.ok(rx < ry, "seen from the side");
  }
});

test("a ring goes in the water, a fair swim away, clear of what it must avoid", () => {
  const random = seeded(5);
  const area = { left: 60, right: 640, top: 160, bottom: 840 };
  const avoid = [{ left: 450, right: 700, top: 0, bottom: 260 }];
  for (let round = 0; round < 500; round += 1) {
    const fish = { x: 60 + random() * 580, y: 160 + random() * 680 };
    const spot = FishRings.place(random, area, fish, { near: 180, far: 900, avoid });
    const distance = Math.hypot(spot.x - fish.x, spot.y - fish.y);
    assert.ok(spot.x >= area.left && spot.x <= area.right && spot.y >= area.top && spot.y <= area.bottom, "in the water");
    assert.ok(distance >= 180 && distance <= 900, `a fair swim: ${distance}`);
    assert.ok(!(spot.x > 450 && spot.y < 260), "clear of the Rings button");
  }
  // Nowhere fits: it still lands in the water, across from the fish.
  const cramped = FishRings.place(random, { left: 100, right: 120, top: 100, bottom: 120 }, { x: 105, y: 110 }, { near: 500, far: 600 });
  assert.deepEqual(cramped, { x: 120, y: 110 });
});

test("the fish is through when its middle is in the hole", () => {
  const ring = { x: 300, y: 400, ...FishRings.size(150) };
  const L = 150;
  assert.equal(FishRings.through({ x: 300, y: 400 }, L, ring), true, "dead centre");
  assert.equal(FishRings.through({ x: 300 + ring.rx + L * 0.2, y: 400 }, L, ring), true, "nose in");
  assert.equal(FishRings.through({ x: 300, y: 400 + ring.ry - ring.thickness + 2 }, L, ring), false, "under the hole");
  assert.equal(FishRings.through({ x: 300 + ring.rx + L * 0.3, y: 400 }, L, ring), false, "not there yet");
});

test("the game's lines are written and counting goes to twenty", () => {
  assert.equal(FishTalk.GAME.count.length, 20);
  assert.equal(FishTalk.GAME.count[0].text, "One!");
  assert.equal(FishTalk.GAME.count[19].text, "Twenty!");
  assert.ok(FishTalk.all().includes(FishTalk.GAME.start), "recorded with the rest");
});
