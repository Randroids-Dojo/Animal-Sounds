"use strict";

// The rings game's rules, with no drawing or input: where the next ring goes,
// how long it waits, and when the fish has swum through it. fish-tank.js
// plays the game; tests/fish-rings.test.js checks these.
(function exposeFishRings(globalScope) {
  // Time to react on top of the swim: generous at first, quicker as the
  // score climbs, never below the floor.
  const REACT_START = 3.2;
  const REACT_STEP = 0.12;
  const REACT_FLOOR = 1.4;

  // Seconds a ring waits: the swim from the fish at game speed (it has to
  // turn and speed up, so most of full speed), plus time to react.
  function timeLimit(distance, speed, score) {
    return distance / (speed * 0.75) + Math.max(REACT_FLOOR, REACT_START - REACT_STEP * score);
  }

  // A ring's size for a fish of length L: tall enough to swim through
  // easily, narrow because it is seen from the side.
  function size(L) {
    const ry = Math.max(46, Math.min(110, L * 0.75));
    return { rx: ry * 0.38, ry, thickness: ry * 0.22 };
  }

  // Where the next ring goes: inside area, a fair swim from the fish, and
  // clear of the boxes in avoid (each { left, top, right, bottom }).
  function place(random, area, fish, { near, far, avoid = [] }) {
    const clear = (x, y) => !avoid.some((box) => x > box.left && x < box.right && y > box.top && y < box.bottom);
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const x = area.left + random() * (area.right - area.left);
      const y = area.top + random() * (area.bottom - area.top);
      const distance = Math.hypot(x - fish.x, y - fish.y);
      if (distance >= near && distance <= far && clear(x, y)) return { x, y };
    }
    // A cramped tank: across from the fish, at the middle height.
    const x = fish.x < (area.left + area.right) / 2 ? area.right : area.left;
    return { x, y: (area.top + area.bottom) / 2 };
  }

  // The fish is through when its middle is inside the ring's hole: within
  // the hoop's depth (plus some body) across, and within its height.
  function through(fish, L, ring) {
    return Math.abs(fish.x - ring.x) < ring.rx + L * 0.25 && Math.abs(fish.y - ring.y) < ring.ry - ring.thickness;
  }

  const api = { REACT_START, REACT_STEP, REACT_FLOOR, timeLimit, size, place, through };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalScope.FishRings = api;
})(typeof globalThis === "undefined" ? window : globalThis);
