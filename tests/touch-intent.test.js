"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const TouchIntent = require("../touch-intent.js");

const limits = {
  maxDuration: 700,
  maxDistance: 12,
  maxMajor: 70,
  maxArea: 2800,
};

function pointer(overrides = {}) {
  return {
    pointerId: 1,
    clientX: 100,
    clientY: 100,
    width: 24,
    height: 18,
    timeStamp: 1000,
    ...overrides,
  };
}

test("accepts a brief, stationary fingertip tap", () => {
  const candidate = TouchIntent.beginCandidate(pointer());
  TouchIntent.updateCandidate(candidate, pointer({ clientX: 105, timeStamp: 1150 }));
  assert.equal(TouchIntent.isPlausibleTap(candidate, 1150, limits), true);
});

test("rejects a long resting contact even when it never moves", () => {
  const candidate = TouchIntent.beginCandidate(pointer());
  assert.equal(TouchIntent.isPlausibleTap(candidate, 1800, limits), false);
});

test("rejects broad palm or belly contact geometry", () => {
  const wide = TouchIntent.beginCandidate(pointer({ width: 84, height: 22 }));
  const broad = TouchIntent.beginCandidate(pointer({ width: 60, height: 50 }));
  assert.equal(TouchIntent.looksLikeBroadContact(wide, limits), true);
  assert.equal(TouchIntent.looksLikeBroadContact(broad, limits), true);
});

test("falls back safely when contact geometry is unavailable", () => {
  const candidate = TouchIntent.beginCandidate(pointer({ width: 1, height: 1 }));
  assert.equal(candidate.hasContactGeometry, false);
  assert.equal(TouchIntent.isPlausibleTap(candidate, 1200, limits), true);
});

test("ranks the smaller fingertip ahead of another simultaneous contact", () => {
  const fingertip = {
    ...TouchIntent.beginCandidate(pointer({ pointerId: 2, width: 22, height: 18 })),
    endedAt: 1200,
  };
  const extraFinger = {
    ...TouchIntent.beginCandidate(pointer({ pointerId: 3, width: 35, height: 28 })),
    endedAt: 1190,
  };
  assert.equal([extraFinger, fingertip].sort(TouchIntent.compareTapCandidates)[0], fingertip);
});

test("tracks peak movement and contact size across the pointer stream", () => {
  const candidate = TouchIntent.beginCandidate(pointer());
  TouchIntent.updateCandidate(candidate, pointer({ clientX: 118, width: 75, height: 25 }));
  assert.equal(candidate.maxDistance, 18);
  assert.equal(candidate.maxContactMajor, 75);
  assert.equal(TouchIntent.isPlausibleTap(candidate, 1200, limits), false);
});
