"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const WordGame = require("../word-game.js");

const root = path.join(__dirname, "..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const pictures = [...read("animals.json"), ...read("foods.json"), ...read("robots.json")];
const words = WordGame.wordsFrom(pictures);

// Fredoka at the board's weight, measured in Chrome: left, right, ascent and
// descent of each glyph's ink at a font size of 1.
const RAW = {"A":[-0.005,0.705,0.691,0.024],"B":[-0.062,0.688,0.731,0.016],"C":[-0.034,0.704,0.744,0.028],"D":[-0.063,0.707,0.731,0.016],"E":[-0.063,0.646,0.731,0.016],"F":[-0.06,0.59,0.731,0.028],"G":[-0.033,0.748,0.744,0.028],"H":[-0.063,0.698,0.744,0.028],"I":[-0.068,0.245,0.744,0.028],"J":[-0.003,0.51,0.744,0.028],"K":[-0.063,0.705,0.744,0.028],"L":[-0.06,0.603,0.744,0.016],"M":[-0.056,0.778,0.731,0.028],"N":[-0.064,0.695,0.744,0.028],"O":[-0.029,0.762,0.744,0.028],"P":[-0.063,0.64,0.731,0.028],"Q":[-0.029,0.801,0.744,0.082],"R":[-0.062,0.688,0.731,0.028],"S":[-0.038,0.638,0.744,0.028],"T":[0.007,0.633,0.731,0.028],"U":[-0.063,0.697,0.744,0.028],"V":[-0.014,0.673,0.744,0.028],"W":[-0.001,0.936,0.744,0.028],"X":[0,0.599,0.744,0.028],"Y":[-0.005,0.619,0.744,0.028],"Z":[0.01,0.648,0.731,0.016]};
const metrics = Object.fromEntries(Object.entries(RAW).map(([char, [left, right, ascent, descent]]) => [char, { left, right, ascent, descent }]));

// Screens below the header, as the browser lays them out: phones and the
// tablet, upright and sideways.
const SCREENS = [
  { label: "phone", width: 412, height: 694 },
  { label: "small phone", width: 360, height: 634 },
  { label: "tablet", width: 800, height: 1227 },
  { label: "tablet sideways", width: 1340, height: 694 },
  { label: "phone sideways", width: 800, height: 306 },
];
const BAND = 48;

function seeded(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const free = (overrides) => ({ vx: 0, vy: 0, mode: "free", pause: 0, ...overrides });
// The loose letters for a word: its own, then extras. With no seed, the
// widest extras possible, which need the most room on the table.
function loose(word, seed) {
  const extras = seed === undefined
    ? [...WordGame.extraLetters(word, () => 0)].map(() => null)
    : WordGame.extraLetters(word, seeded(seed));
  if (seed === undefined) {
    const width = (char) => metrics[char].left + metrics[char].right;
    const widest = Object.keys(metrics).filter((char) => !word.includes(char)).sort((a, b) => width(b) - width(a));
    extras.splice(0, extras.length, ...widest.slice(0, extras.length));
  }
  return { chars: [...word], letters: [...word, ...extras] };
}
const box = (x, y, size = 40) => free({ x, y, hx: size / 2, hy: size / 2, r: size * 0.35 });
const overlapping = (bodies) => bodies.some((a, i) => bodies.some((b, j) => j > i && WordGame.contact(a, b)?.depth > 0.5));

test("words are the pictures' one-word names of 3 to 6 letters, with art and a recording", () => {
  assert.ok(words.length >= 30, `enough words: ${words.length}`);
  assert.equal(new Set(words.map((entry) => entry.word)).size, words.length, "each word once");
  for (const entry of words) {
    assert.match(entry.word, /^[A-Z]{3,6}$/);
    assert.equal(entry.word, entry.name.toUpperCase());
    assert.ok(fs.statSync(path.join(root, entry.image)).size > 0, `${entry.name}: ${entry.image}`);
    assert.ok(fs.statSync(path.join(root, `audio/${entry.name.toLowerCase()}.mp3`)).size > 0, `${entry.name}: recording`);
  }
  for (const left of ["Guinea Pig", "Hummingbird", "Rooster", "Robot Dog"]) {
    assert.ok(!words.some((entry) => entry.name === left), `${left} is not a word here`);
  }
  for (const kept of ["Cat", "Cow", "Egg", "Pizza", "Banana", "Robot"]) {
    assert.ok(words.some((entry) => entry.name === kept), `${kept} is a word`);
  }
});

test("short and long words take turns, starting short, and each comes up before any repeats", () => {
  const deck = WordGame.createDeck(words, seeded(3));
  const shortCount = words.filter((entry) => entry.word.length <= 4).length;
  const longCount = words.length - shortCount;
  const dealt = Array.from({ length: 400 }, () => WordGame.nextWord(deck));
  dealt.forEach((entry, index) => {
    assert.equal(entry.word.length <= 4, index % 2 === 0, `deal ${index} (${entry.word}) is ${index % 2 ? "long" : "short"}`);
    if (index) assert.notEqual(entry, dealt[index - 1]);
  });
  const shortDeals = dealt.filter((_, index) => index % 2 === 0);
  const longDeals = dealt.filter((_, index) => index % 2 === 1);
  assert.equal(new Set(shortDeals.slice(0, shortCount)).size, shortCount, "every short word before a repeat");
  assert.equal(new Set(longDeals.slice(0, longCount)).size, longCount, "every long word before a repeat");
  // Across bag refills the same word never comes twice in a row in its group.
  for (const group of [shortDeals, longDeals]) group.forEach((entry, index) => index && assert.notEqual(entry, group[index - 1]));
});

test("extra letters: three for a short word, two for a long one, none in the word, none twice", () => {
  for (const { word } of words) {
    for (let seed = 0; seed < 30; seed += 1) {
      const extras = WordGame.extraLetters(word, seeded(seed));
      assert.equal(extras.length, word.length <= 4 ? 3 : 2, word);
      assert.equal(new Set(extras).size, extras.length, `${word}: ${extras}`);
      for (const char of extras) {
        assert.match(char, /^[A-Z]$/);
        assert.ok(!word.includes(char), `${word}: ${char} is not in the word`);
      }
    }
  }
  // Over many rounds every letter not in the word turns up.
  const seen = new Set();
  for (let seed = 0; seed < 400; seed += 1) WordGame.extraLetters("CAT", seeded(seed)).forEach((char) => seen.add(char));
  assert.equal(seen.size, 23);
});

test("every word fits every screen: board on screen, letters big and on the table", () => {
  for (const screen of SCREENS) {
    for (const { word } of words) {
      const { chars, letters } = loose(word);
      const geometry = WordGame.layout({ ...screen, band: BAND, metrics, chars, letters });
      const label = `${screen.label} ${word}`;
      const { board, picture, slots, arena, font } = geometry;
      assert.ok(font >= WordGame.MIN_FONT, `${label}: font ${font}`);
      assert.ok(board.x >= 0 && board.x + board.width <= screen.width, `${label}: board across the screen`);
      for (const slot of slots) {
        assert.ok(slot.x - slot.hx >= board.x && slot.x + slot.hx <= board.x + board.width, `${label}: ${slot.char} inside the board`);
        assert.ok(slot.y - slot.hy >= board.y && slot.y + slot.hy <= board.y + board.height, `${label}: ${slot.char} inside the board`);
        const clear = picture.x + picture.size <= slot.x - slot.hx || slot.x + slot.hx <= picture.x
          || picture.y + picture.size <= slot.y - slot.hy;
        assert.ok(clear, `${label}: the picture keeps off ${slot.char}`);
      }
      slots.slice(1).forEach((slot, index) => assert.ok(slot.x - slot.hx > slots[index].x + slots[index].hx, `${label}: recesses apart`));
      assert.ok(arena.top >= board.y + board.height, `${label}: the table is below the board`);
      assert.ok(arena.left >= BAND && arena.right <= screen.width - BAND && arena.bottom <= screen.height - BAND, `${label}: the table clears the band`);
      const placed = WordGame.scatter(letters, metrics, geometry, seeded(word.length), chars.length);
      assert.equal(placed.length, letters.length, `${label}: every letter, extras too`);
      for (const body of placed) {
        assert.ok(body.x - body.hx >= arena.left && body.x + body.hx <= arena.right, `${label}: ${body.char} on the table`);
        assert.ok(body.y - body.hy >= arena.top && body.y + body.hy <= arena.bottom, `${label}: ${body.char} on the table`);
        // A toddler's fingertip, plus the margin pickup allows around it.
        assert.ok(2 * body.hy + 28 >= 48, `${label}: ${body.char} big enough to pick up`);
        assert.ok(Math.abs(body.tilt) <= 7);
      }
      assert.equal(overlapping(placed.map((body) => free(body))), false, `${label}: letters start apart`);
    }
  }
});

test("the letters start scrambled: read in order, the word's own letters never spell it", () => {
  const geometry = WordGame.layout({ width: 800, height: 1227, band: BAND, metrics, chars: [..."CAT"] });
  for (const { word } of words) {
    for (let seed = 0; seed < 40; seed += 1) {
      const { chars, letters } = loose(word, seed);
      const fit = WordGame.layout({ width: 800, height: 1227, band: BAND, metrics, chars, letters });
      const placed = WordGame.scatter(letters, metrics, fit, seeded(seed), chars.length);
      const own = placed.filter((body) => body.index < chars.length).map((body) => body.char).join("");
      assert.notEqual(own, word, `${word} seed ${seed}`);
      assert.deepEqual(placed.map((body) => body.index).sort((a, b) => a - b), letters.map((_, index) => index), `${word}: each letter once`);
    }
  }
  assert.equal(geometry.slots.map((slot) => slot.char).join(""), "CAT");
});

test("overlapping letters are pushed apart along the shallower side", () => {
  const a = box(100, 100);
  const b = box(130, 104);
  const touch = WordGame.contact(a, b);
  assert.ok(touch && touch.depth > 0 && touch.nx > 0.5, JSON.stringify(touch));
  assert.equal(WordGame.contact(box(100, 100), box(160, 100)), null, "letters apart do not touch");
  const arena = { left: 0, right: 1000, top: 0, bottom: 1000 };
  const bodies = [a, b];
  WordGame.step(bodies, 1 / 120, arena);
  assert.equal(overlapping(bodies), false);
  assert.ok(a.x < 100 && b.x > 130, "both move, each half the way");
});

test("a held letter pushes a loose one out of its way and sends it sliding", () => {
  const arena = { left: 0, right: 1000, top: 0, bottom: 1000 };
  const held = { ...box(300, 500), mode: "held" };
  const loose = box(345, 500);
  const bodies = [held, loose];
  const dt = 1 / 120;
  const events = [];
  for (let i = 0; i < 12; i += 1) {
    held.vx = 600;
    held.x += held.vx * dt;
    events.push(...WordGame.step(bodies, dt, arena));
  }
  assert.ok(loose.x - loose.hx >= held.x + held.hx - 0.5 || !WordGame.contact(held, loose), "the loose letter is pushed clear");
  assert.ok(loose.vx > 400, `it slides on: ${loose.vx}`);
  assert.equal(held.x, 300 + 12 * 600 * dt, "nothing pushes back on the held letter");
  assert.ok(events.some((event) => event.type === "bump"), "the bump is heard");
  // Then it slows to a stop without leaving the table.
  for (let i = 0; i < 600; i += 1) WordGame.step(bodies.filter((body) => body !== held), dt, arena);
  assert.equal(loose.vx, 0);
  assert.ok(loose.x + loose.hx <= arena.right);
});

test("loose letters stay on the table, bouncing softly off its sides", () => {
  const arena = { left: 48, right: 364, top: 250, bottom: 646 };
  const random = seeded(9);
  const bodies = Array.from({ length: 6 }, () => ({ ...box(120 + random() * 160, 300 + random() * 300, 56),
    vx: (random() * 2 - 1) * 2200, vy: (random() * 2 - 1) * 2200 }));
  for (let i = 0; i < 1200; i += 1) {
    WordGame.step(bodies, 1 / 120, arena);
    for (const body of bodies) {
      assert.ok(body.x - body.hx >= arena.left - 0.01 && body.x + body.hx <= arena.right + 0.01, `step ${i}: inside sideways`);
      assert.ok(body.y + body.hy <= arena.bottom + 0.01, `step ${i}: above the bottom`);
    }
  }
  assert.equal(WordGame.unsettled(bodies, arena), false, "all come to rest, apart, in ten seconds");
});

test("a letter let go over the board glides back down to the table", () => {
  const arena = { left: 48, right: 752, top: 470, bottom: 1180 };
  const body = { ...box(400, 300, 100), pause: 0.3 };
  const bodies = [body, box(400, 560, 100)];
  let steps = 0;
  while (WordGame.unsettled(bodies, arena) && steps < 1200) {
    WordGame.step(bodies, 1 / 120, arena);
    steps += 1;
  }
  assert.ok(steps < 300, `back within 2.5 s: ${steps / 120} s`);
  assert.ok(body.y - body.hy >= arena.top - 0.5, "on the table");
  assert.equal(overlapping(bodies), false, "and it made room for itself");
});

test("seated letters and letters sliding home take no part in pushing", () => {
  const arena = { left: 0, right: 1000, top: 0, bottom: 1000 };
  const seated = { ...box(100, 100), mode: "seated" };
  const sliding = { ...box(110, 100), mode: "seating" };
  const loose = box(120, 100);
  WordGame.step([seated, sliding, loose], 1 / 120, arena);
  assert.deepEqual([seated.x, sliding.x, loose.x], [100, 110, 120]);
});

test("a dropped letter seats in a matching empty slot within reach, the nearest of two", () => {
  const chars = [..."APPLE"];
  const { slots } = WordGame.layout({ width: 412, height: 694, band: BAND, metrics, chars });
  const [a, p1, p2] = slots;
  assert.equal(WordGame.seatFor("A", a.x + a.hx * 0.9, a.y - a.hy * 0.5, slots), a, "near the A seats the A");
  assert.equal(WordGame.seatFor("P", a.x, a.y, slots), null, "a P over the A does not seat");
  assert.equal(WordGame.slotUnder(a.x, a.y, slots), a, "and is over the A");
  assert.equal(WordGame.seatFor("P", p2.x - 2, p2.y, slots), p2, "either P slot takes a P");
  p2.filled = true;
  assert.equal(WordGame.seatFor("P", p2.x, p2.y, slots), null, "not a filled one");
  assert.equal(WordGame.seatFor("P", p1.x + p1.hx, p1.y, slots), p1, "the empty one beside it does");
  assert.equal(WordGame.seatFor("A", a.x, a.y + a.hy * 3, slots), null, "too far below");
});

test("a hint points at the first empty slot and the nearest loose letter that fits it", () => {
  const slots = [{ char: "C", x: 100, y: 50, filled: true }, { char: "A", x: 200, y: 50 }, { char: "T", x: 300, y: 50 }];
  const letters = [
    { char: "T", mode: "free", x: 300, y: 300 },
    { char: "A", mode: "free", x: 600, y: 300 },
    { char: "A", mode: "held", x: 200, y: 100 },
    { char: "A", mode: "free", x: 250, y: 300 },
  ];
  const found = WordGame.hint(slots, letters);
  assert.equal(found.slot, slots[1]);
  assert.equal(found.letter, letters[3]);
  assert.equal(WordGame.hint(slots.map((slot) => ({ ...slot, filled: true })), letters), null);
});

test("a letter coming down from the board onto another steps aside and settles, quietly", () => {
  // A short, sideways table: one letter at the front, another let go on the
  // board straight above it.
  for (const offset of [0, 4, -6, 15]) {
    const arena = { left: 48, right: 752, top: 147, bottom: 251 };
    const resting = box(400, arena.bottom - 30, 60);
    const falling = { ...box(400 + offset, arena.top - 40, 60), pause: 0.12 };
    const bodies = [resting, falling];
    let knocks = 0;
    let steps = 0;
    while (WordGame.unsettled(bodies, arena) && steps < 1200) {
      knocks += WordGame.step(bodies, 1 / 120, arena).filter((event) => event.type === "bump").length;
      steps += 1;
    }
    assert.ok(steps < 360, `offset ${offset}: settles within 3 s, not ${steps / 120} s`);
    assert.ok(knocks <= 2, `offset ${offset}: knocks once or twice, not ${knocks} times`);
    assert.ok(falling.y - falling.hy >= arena.top - 0.5, `offset ${offset}: on the table`);
    assert.equal(overlapping(bodies), false);
  }
});

test("letters pressed together knock when they meet, then stay quiet", () => {
  const arena = { left: 0, right: 1000, top: 0, bottom: 1000 };
  const held = { ...box(300, 500), mode: "held" };
  const loose = box(420, 500);
  const bodies = [held, loose];
  const knocks = [];
  // Push it into the right side of the table, then keep it pressed there.
  for (let frame = 0; frame < 150; frame += 1) {
    const events = WordGame.advance(bodies, 1 / 60, arena, [{ body: held, x: Math.min(held.x + 30, arena.right - 60), y: 500 }]);
    knocks.push(...events.filter((event) => event.type === "bump").map(() => frame));
  }
  assert.ok(knocks.length >= 1, "the push is heard");
  assert.equal(loose.x, arena.right - 20, "the loose letter is pressed against the side");
  assert.deepEqual(knocks.filter((frame) => frame >= 40), [], `no rattle while pressed: ${knocks}`);
});

test("a thin letter flicked fast pushes the others rather than passing through", () => {
  const arena = { left: 48, right: 1252, top: 300, bottom: 1200 };
  const body = (hx, hy, extra) => ({ hx, hy, r: 0.7 * Math.min(hx, hy), vx: 0, vy: 0, mode: "free", pause: 0, ...extra });
  for (const fps of [60, 30]) {
    for (const [label, hx, hy, otherHx] of [["I into I", 8, 34, 8], ["I into A", 14, 66, 60], ["A into A", 30, 33, 30]]) {
      for (const speed of [1000, 2500, 4000, 6000]) {
        const held = body(hx, hy, { mode: "held", x: 200, y: 700 });
        const other = body(otherHx, hy, { x: 600, y: 705 });
        const dt = 1 / fps;
        for (let frame = 0; frame < 60; frame += 1) {
          WordGame.advance([held, other], dt, arena, [{ body: held, x: Math.min(held.x + speed * dt, 1000), y: 700 }]);
        }
        assert.ok(other.x > held.x, `${fps} fps, ${label} at ${speed} px/s: pushed ahead, not passed through`);
      }
    }
  }
});

test("the table is always at least two letters tall", () => {
  for (const screen of SCREENS) {
    for (const { word } of words) {
      const { chars, letters } = loose(word);
      const geometry = WordGame.layout({ ...screen, band: BAND, metrics, chars, letters });
      const tallest = Math.max(...letters.map((char) => 2 * WordGame.letterBody(metrics[char], geometry.font).hy));
      assert.ok(geometry.arena.bottom - geometry.arena.top >= 2 * tallest, `${screen.label} ${word}: ${Math.round(geometry.arena.bottom - geometry.arena.top)} px for ${Math.round(tallest)} px letters`);
    }
  }
});

test("however short the frame, a held letter pushes no harder than a throw", () => {
  const arena = { left: 0, right: 2000, top: 0, bottom: 1000 };
  for (const dt of [0.001, 1 / 240, 1 / 60]) {
    const held = { ...box(300, 500), mode: "held" };
    const loose = box(341, 500);
    WordGame.advance([held, loose], dt, arena, [{ body: held, x: 310, y: 500 }]);
    assert.ok(Math.hypot(loose.vx, loose.vy) <= 2200 * 1.35 + 1, `dt ${dt}: pushed at ${Math.round(loose.vx)} px/s`);
    assert.ok(loose.vx <= 10 / Math.max(dt, 1 / 120) * 1.35 + 1, `dt ${dt}: about the finger's own speed`);
  }
});

test("a trembling finger pressing a letter against another at the table's side does not rattle", () => {
  const arena = { left: 48, right: 752, top: 400, bottom: 1180 };
  const pinned = box(arena.right - 30, 800, 60);
  const held = { ...box(arena.right - 92, 800, 60), mode: "held" };
  const bodies = [pinned, held];
  const knocks = [];
  // Pressed in, then held there with a fingertip's tremble for two seconds.
  for (let frame = 0; frame < 150; frame += 1) {
    const press = arena.right - 60 - 30 + (frame < 20 ? -40 + frame * 2 : 2 * Math.sin(frame * 1.7));
    const events = WordGame.advance(bodies, 1 / 60, arena, [{ body: held, x: press, y: 800 + Math.cos(frame * 2.3) }]);
    knocks.push(...events.map((event) => `${frame}:${event.type}`));
  }
  assert.deepEqual(knocks.filter((knock) => Number(knock.split(":")[0]) >= 30), [], `no rattle while pressed: ${knocks}`);
});

test("short screens keep a table at least one letter tall, and their letters come to rest", () => {
  for (const width of [568, 640, 740, 780, 800, 900, 960]) {
    for (const height of [180, 210, 240, 270, 290, 300, 330]) {
      for (const word of ["CAT", "PIZZA", "BANANA"]) {
        const { chars, letters } = loose(word);
        const geometry = WordGame.layout({ width, height, band: BAND, metrics, chars, letters });
        const label = `${width}x${height} ${word}`;
        const tallest = Math.max(...letters.map((char) => 2 * WordGame.letterBody(metrics[char], geometry.font).hy));
        assert.ok(geometry.arena.bottom - geometry.arena.top >= tallest, `${label}: a table ${Math.round(geometry.arena.bottom - geometry.arena.top)} px tall for ${Math.round(tallest)} px letters`);
        const bodies = WordGame.scatter(letters, metrics, geometry, seeded(width + height), chars.length).map((body) => free(body));
        let knocks = 0;
        let steps = 0;
        while (WordGame.unsettled(bodies, geometry.arena) && steps < 600) {
          knocks += WordGame.step(bodies, 1 / 120, geometry.arena).length;
          steps += 1;
        }
        assert.ok(steps < 600, `${label}: the letters come to rest`);
        assert.equal(knocks, 0, `${label}: without a sound`);
      }
    }
  }
});

test("a letter's plastic side stays clear of the bottom grip band", () => {
  for (const screen of SCREENS) {
    for (const { word } of words) {
      const geometry = WordGame.layout({ ...screen, band: BAND, metrics, ...loose(word) });
      assert.ok(geometry.arena.bottom + WordGame.DEPTH * geometry.font <= screen.height - BAND + 0.01, `${screen.label} ${word}`);
    }
  }
});

test("on every screen width, the starting rows fit the table whatever the scramble", () => {
  for (let width = 320; width <= 1400; width += 8) {
    for (const height of [360, 800]) {
      for (const { word } of words) {
        for (let seed = 0; seed < 3; seed += 1) {
          const { chars, letters } = seed ? loose(word, seed + width) : loose(word);
          const geometry = WordGame.layout({ width, height, band: BAND, metrics, chars, letters });
          const placed = WordGame.scatter(letters, metrics, geometry, seeded(seed + width), chars.length);
          const label = `${width}x${height} ${word} seed ${seed}`;
          assert.equal(overlapping(placed.map((body) => free(body))), false, `${label}: letters start apart`);
          for (const body of placed) {
            assert.ok(body.y - body.hy >= geometry.arena.top - 0.01 && body.y + body.hy <= geometry.arena.bottom + 0.01, `${label}: ${body.char} on the table`);
          }
        }
      }
    }
  }
});

test("a letter on a table shorter than itself rests on the bottom rather than rattling", () => {
  const arena = { left: 0, right: 600, top: 100, bottom: 130 };
  const bodies = [box(200, 80, 60), box(400, 60, 60)];
  let knocks = 0;
  let steps = 0;
  while (WordGame.unsettled(bodies, arena) && steps < 600) {
    knocks += WordGame.step(bodies, 1 / 120, arena).length;
    steps += 1;
  }
  assert.ok(steps < 240, `comes to rest: ${steps / 120} s`);
  assert.ok(knocks <= 2, `with a knock at most: ${knocks}`);
  for (const body of bodies) assert.equal(body.y + body.hy, arena.bottom, "on the bottom");
});
