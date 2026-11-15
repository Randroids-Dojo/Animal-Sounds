"use strict";

// What the goldfish tank says when the fish is tapped: a short line in Randy's
// voice about how the fish is doing right now. The recordings are in
// audio/fish/ (scripts/build-fish-voice.py makes them from LINES).
//
// Each tap picks from the facts that are true right now. Facts about what the
// fish needs or how it is doing come every other tap, so the child hears them
// often; in between come a meal it just had, how happy it is, its age or size
// (sharing one turn), or a greeting. Each fact takes its turn, and each fact's lines are all used
// before any repeats, so no line comes twice in a row.
(function exposeFishTalk(globalScope) {
  const NUMBERS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven"];
  const line = (id, text) => ({ id, text, audio: `audio/fish/${id}.mp3` });

  const LINES = {
    // How it is doing, most important first.
    sick: [
      line("sick-1", "The goldfish feels sick."),
      line("sick-2", "The water is dirty. Let's change the water!"),
      line("sick-3", "Poor goldfish! Clean water will help."),
    ],
    better: [
      line("better-1", "The goldfish is feeling better!"),
      line("better-2", "Clean water! The goldfish is getting better."),
    ],
    hungry: [
      line("hungry-1", "The goldfish is hungry!"),
      line("hungry-2", "Time to feed the goldfish!"),
      line("hungry-3", "The goldfish wants some food."),
    ],
    overfed: [
      line("overfed-1", "The goldfish is full. No more food!"),
      line("overfed-2", "Too much food makes the water dirty."),
    ],
    cloudy: [
      line("cloudy-1", "The water is getting cloudy."),
      line("cloudy-2", "Time to change the water!"),
    ],
    // About the fish.
    ate: [
      line("ate-1", "Yum! The goldfish just ate."),
      line("ate-2", "The goldfish has a full tummy."),
    ],
    happy: [
      line("happy-1", "The goldfish is happy!"),
      line("happy-2", "The goldfish loves clean water."),
    ],
    baby: [line("size-baby", "The goldfish is a little baby.")],
    growing: [line("size-growing", "The goldfish is growing!")],
    grown: [line("size-grown", "The goldfish is all grown up!")],
    hello: [
      { id: "goldfish", text: "Goldfish!", audio: "audio/goldfish.mp3" },
      line("hello-1", "Blub, blub, blub!"),
      line("hello-2", "Hello, goldfish!"),
      line("hello-3", "Look at the goldfish swim!"),
    ],
    age: [
      line("age-today", "The goldfish was born today!"),
      ...NUMBERS.slice(0, 6).map((word, index) => line(`age-${index + 1}-day`, `The goldfish is ${word} ${index ? "days" : "day"} old.`)),
      ...NUMBERS.slice(0, 3).map((word, index) => line(`age-${index + 1}-week`, `The goldfish is ${word} ${index ? "weeks" : "week"} old.`)),
      ...NUMBERS.slice(0, 11).map((word, index) => line(`age-${index + 1}-month`, `The goldfish is ${word} ${index ? "months" : "month"} old.`)),
      ...NUMBERS.slice(0, 5).map((word, index) => line(`age-${index + 1}-year`, `The goldfish is ${word} ${index ? "years" : "year"} old!`)),
      line("age-many-years", "The goldfish is more than five years old!"),
    ],
  };
  const STATUS = ["sick", "better", "hungry", "overfed", "cloudy"];
  // Ate a flake this recently: "just ate".
  const JUST_ATE_MS = 10 * 60 * 1000;

  // The one age line that fits, in days, then weeks, months and years.
  function ageLine(days) {
    const find = (id) => LINES.age.find((entry) => entry.id === id);
    if (days < 1) return find("age-today");
    if (days < 7) return find(`age-${days}-day`);
    if (days < 28) return find(`age-${Math.floor(days / 7)}-week`);
    if (days < 365) return find(`age-${Math.max(1, Math.min(11, Math.floor(days / 30.44)))}-month`);
    const years = Math.max(1, Math.floor(days / 365.25));
    return find(years > 5 ? "age-many-years" : `age-${years}-year`);
  }

  // The facts true right now, as { key, lines }, status facts first.
  // look is Goldfish.looks(); state is the fish's saved state.
  function facts(look, state, now) {
    const dirtySick = look.sick && look.needsWater;
    const status = [];
    if (dirtySick) status.push("sick");
    else if (look.sick) status.push("better");
    if (look.hungry && !dirtySick) status.push("hungry");
    if (!look.wantsFood && look.leftovers > 0 && !look.sick) status.push("overfed");
    if (look.needsWater && !look.sick) status.push("cloudy");
    const about = [];
    if (!look.hungry && state.ateAt && now - state.ateAt < JUST_ATE_MS) about.push("ate");
    if (!status.length) about.push("happy");
    // Its age and its size take turns in one slot.
    const size = look.size < 0.5 ? "baby" : look.size < 0.88 ? "growing" : "grown";
    const self = { key: "self", lines: [ageLine(look.ageDays), LINES[size][0]] };
    return {
      status: status.map((key) => ({ key, lines: LINES[key] })),
      about: [...about.map((key) => ({ key, lines: LINES[key] })), self, { key: "hello", lines: LINES.hello }],
    };
  }

  function createTalker(random = Math.random) {
    return { taps: 0, statusTurn: 0, aboutTurn: 0, bags: new Map(), last: null, random };
  }

  // The fact's next line: a shuffled bag, refilled when empty, never
  // starting with this fact's last line or the line just said.
  function draw(talker, fact) {
    let bag = talker.bags.get(fact.key);
    const ids = fact.lines.map((entry) => entry.id).join(" ");
    if (!bag || !bag.order.length || bag.ids !== ids) {
      const order = [...fact.lines.keys()];
      for (let index = order.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(talker.random() * (index + 1));
        [order[index], order[swap]] = [order[swap], order[index]];
      }
      const recent = [bag?.last, talker.last];
      if (order.length > 1 && recent.includes(fact.lines[order[0]].id)) order.push(order.shift());
      bag = { ids, order, last: bag?.last };
      talker.bags.set(fact.key, bag);
    }
    const chosen = fact.lines[bag.order.shift()];
    bag.last = chosen.id;
    return chosen;
  }

  // The next thing to say. Status facts every other tap when there are any.
  function next(talker, look, state, now = Date.now()) {
    const { status, about } = facts(look, state, now);
    const statusTurn = status.length && talker.taps % 2 === 0;
    talker.taps += 1;
    let pool = statusTurn ? status : about;
    let turn = statusTurn ? "statusTurn" : "aboutTurn";
    let fact = pool[talker[turn] % pool.length];
    // A fact whose only line was just said gives way to the next fact.
    if (fact.lines.length === 1 && fact.lines[0].id === talker.last) {
      talker[turn] += 1;
      fact = pool[talker[turn] % pool.length];
      if (fact.lines.length === 1 && fact.lines[0].id === talker.last) {
        pool = statusTurn ? about : status.length ? status : about;
        turn = statusTurn ? "aboutTurn" : "statusTurn";
        fact = pool[talker[turn] % pool.length];
      }
    }
    talker[turn] += 1;
    const chosen = draw(talker, fact);
    talker.last = chosen.id;
    return { ...chosen, fact: fact.key };
  }

  const all = () => Object.values(LINES).flat();
  const api = { LINES, STATUS, JUST_ATE_MS, ageLine, facts, createTalker, next, all };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalScope.FishTalk = api;
})(typeof globalThis === "undefined" ? window : globalThis);
