"use strict";

// The pet goldfish's care rules, with no drawing or input. Everything runs on
// real time: the app calls advance() with the clock whenever it looks at the
// fish, so hours and days pass while the tab, the app, or the tablet is off.
//
// - Hunger climbs from full to starving in 12 hours. Each flake eaten takes a
//   tenth off. A fish that is nearly full ignores flakes, and flakes that reach
//   the pebbles stay there and make the water cloudier.
// - The water clouds over on its own in about four days.
// - Water this cloudy makes the fish sick over a few hours. Clean water makes
//   it well again within seconds, so a child sees the fix work.
// - The fish grows over months, but only while it is fed and well. It starts as
//   a small bronze baby and turns gold as it grows, as real goldfish do.
// - It never dies. The worst it gets is sick and hungry, and care undoes both.
(function exposeGoldfish(globalScope) {
  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  const RULES = {
    hungerPerHour: 1 / 12,
    // Shows its hunger in the tank from here.
    hungryAt: 0.32,
    // Eats a flake only with at least this much room.
    eatsFrom: 0.08,
    flakeFood: 0.1,
    dirtPerHour: 1 / 96,
    leftoverDirt: 0.05,
    // The water looks cloudy and the Change water button appears.
    cloudyAt: 0.25,
    // Water this cloudy makes the fish sick.
    sickeningAt: 0.6,
    sickPerHour: 1 / 6,
    // Well again in about 15 seconds, before the app dims for idling (45 s).
    recoverPerMinute: 2,
    // Looks sick below this health.
    sickBelow: 0.5,
    // Grows only while fed and well.
    growsBelowHunger: 0.85,
    growsFromHealth: 0.5,
    // Growth follows 1 - e^(-days / growthDays): about 90% grown by 100 days.
    growthDays: 45,
    babySize: 0.38,
    // Bronze until this many days of good care, gold by the second number.
    goldFromDays: 5,
    goldByDays: 50,
    // Catching up on a very long absence stops here.
    maxCatchUp: 400 * DAY,
    maxLeftovers: 24,
  };

  const clamp01 = (value) => Math.max(0, Math.min(1, value));
  const smoothstep = (from, to, value) => {
    const t = clamp01((value - from) / (to - from));
    return t * t * (3 - 2 * t);
  };
  const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback);

  // A new fish is hungry, so the first thing to do is feed it.
  function create(now = Date.now()) {
    return { v: 1, bornAt: now, updatedAt: now, hunger: 0.6, dirt: 0, health: 1, goodMs: 0, leftovers: 0 };
  }

  // Saved state can be missing, old, or edited by hand. Times are kept even
  // if they are ahead of this clock: a tablet that boots with its clock
  // reset must not change the fish for good. It waits until the clock
  // catches up again (see advance).
  function restore(saved, now = Date.now()) {
    if (!saved || typeof saved !== "object" || saved.v !== 1 || !Number.isFinite(saved.bornAt)) return create(now);
    const bornAt = saved.bornAt;
    return {
      v: 1,
      bornAt,
      updatedAt: Math.max(bornAt, finite(saved.updatedAt, bornAt)),
      hunger: clamp01(finite(saved.hunger, 0.6)),
      dirt: clamp01(finite(saved.dirt, 0)),
      health: clamp01(finite(saved.health, 1)),
      goodMs: Math.max(0, finite(saved.goodMs, 0)),
      leftovers: Math.max(0, Math.min(RULES.maxLeftovers, Math.floor(finite(saved.leftovers, 0)))),
    };
  }

  // Integrates in steps short enough that a threshold crossed mid-gap still
  // takes effect at about the right time.
  function advance(state, now = Date.now()) {
    if (!(now > state.updatedAt)) {
      // A clock behind the last update changes nothing. Time starts passing
      // again once the clock gets back past it, so a clock that was wrong for
      // a while is neither replayed nor lost.
      return state;
    }
    let left = Math.min(now - state.updatedAt, RULES.maxCatchUp);
    while (left > 0) {
      const step = Math.min(left, 10 * MINUTE);
      const hours = step / HOUR;
      if (state.hunger < RULES.growsBelowHunger && state.health >= RULES.growsFromHealth) state.goodMs += step;
      if (state.dirt >= RULES.sickeningAt) state.health -= RULES.sickPerHour * hours;
      else if (state.dirt < RULES.cloudyAt) state.health += RULES.recoverPerMinute * (step / MINUTE);
      state.health = clamp01(state.health);
      state.hunger = clamp01(state.hunger + RULES.hungerPerHour * hours);
      state.dirt = clamp01(state.dirt + RULES.dirtPerHour * hours);
      left -= step;
    }
    state.updatedAt = now;
    return state;
  }

  function wantsFood(state) {
    return state.hunger >= RULES.eatsFrom;
  }

  function eat(state) {
    if (!wantsFood(state)) return false;
    state.hunger = clamp01(state.hunger - RULES.flakeFood);
    return true;
  }

  // An uneaten flake settles on the pebbles.
  function leftover(state) {
    state.dirt = clamp01(state.dirt + RULES.leftoverDirt);
    state.leftovers = Math.min(RULES.maxLeftovers, state.leftovers + 1);
  }

  function changeWater(state) {
    state.dirt = 0;
    state.leftovers = 0;
  }

  function goodDays(state) {
    return state.goodMs / DAY;
  }

  // Everything the tank needs to draw the fish and its water.
  function looks(state, now = Date.now()) {
    const days = goodDays(state);
    const sick = state.health < RULES.sickBelow;
    return {
      // Of its full-grown length.
      size: RULES.babySize + (1 - RULES.babySize) * (1 - Math.exp(-days / RULES.growthDays)),
      // 0 is a bronze baby, 1 is gold.
      gold: smoothstep(RULES.goldFromDays, RULES.goldByDays, days),
      // How far its fins have grown into a flowing fan tail.
      fins: smoothstep(10, 150, days),
      fullness: 1 - state.hunger,
      hungry: state.hunger >= RULES.hungryAt,
      wantsFood: wantsFood(state),
      // 0 is well; 1 is as sick as it gets.
      sickness: clamp01((RULES.sickBelow - state.health) / RULES.sickBelow),
      sick,
      // Rises quickly at first, so the water already looks hazy when the
      // Change water button appears.
      cloud: clamp01((state.dirt - 0.05) / 0.85) ** 0.8,
      needsWater: state.dirt >= RULES.cloudyAt,
      leftovers: state.leftovers,
      ageDays: Math.max(0, Math.floor((now - state.bornAt) / DAY)),
    };
  }

  const api = { RULES, DAY, HOUR, MINUTE, create, restore, advance, wantsFood, eat, leftover, changeWater, goodDays, looks };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalScope.Goldfish = api;
})(typeof globalThis === "undefined" ? window : globalThis);
