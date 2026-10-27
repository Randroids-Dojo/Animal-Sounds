"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const PuzzleDeck = require("../puzzle-deck.js");

const root = path.join(__dirname, "..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const animals = read("animals.json").filter((animal, index, all) => all.findIndex((other) => other.name === animal.name) === index);
const collections = { animal: animals, dinosaur: read("dinosaurs.json"), food: read("foods.json"), robot: read("robots.json") };

function seeded(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const kindOf = (picture) => Object.keys(collections).find((kind) => collections[kind].includes(picture));

test("every puzzle picture has its art and a recording of its name", () => {
  for (const [kind, pictures] of Object.entries(collections)) {
    assert.ok(pictures.length >= 8, `${kind} has enough pictures`);
    for (const picture of pictures) {
      const art = picture.puzzleImage || picture.image;
      assert.ok(fs.statSync(path.join(root, art)).size > 0, `${picture.name}: ${art}`);
      const voice = `audio/${picture.name.toLowerCase().replace(/\s+/g, "-")}.mp3`;
      assert.ok(fs.statSync(path.join(root, voice)).size > 0, `${picture.name}: ${voice}`);
      if (kind !== "animal") assert.equal(picture.kind, kind, `${picture.name} names its backdrop`);
      if (picture.article) assert.equal(picture.article, "some", `${picture.name}: article`);
    }
  }
  // Dinosaur tiles are wide; the puzzle uses square cutouts made for it.
  for (const dinosaur of collections.dinosaur) assert.match(dinosaur.puzzleImage, /^images\/dinosaurs\/puzzle\/.+\.webp$/);
});

test("kinds take turns, so no kind comes up twice in a row", () => {
  for (let seed = 1; seed <= 50; seed += 1) {
    const deck = PuzzleDeck.create(collections, seeded(seed));
    const kinds = Array.from({ length: 200 }, () => kindOf(PuzzleDeck.next(deck)));
    for (let i = 1; i < kinds.length; i += 1) assert.notEqual(kinds[i], kinds[i - 1], `seed ${seed}, round ${i}`);
    // Every four rounds, each kind comes up once.
    for (let i = 0; i < kinds.length; i += 4) assert.equal(new Set(kinds.slice(i, i + 4)).size, 4);
  }
});

test("each kind shows every picture before any repeats", () => {
  const deck = PuzzleDeck.create(collections, seeded(7));
  const seen = Object.fromEntries(Object.keys(collections).map((kind) => [kind, []]));
  for (let round = 0; round < 4 * 60; round += 1) {
    const picture = PuzzleDeck.next(deck);
    seen[kindOf(picture)].push(picture);
  }
  for (const [kind, pictures] of Object.entries(collections)) {
    const shown = seen[kind];
    for (let start = 0; start + pictures.length <= shown.length; start += pictures.length) {
      assert.equal(new Set(shown.slice(start, start + pictures.length)).size, pictures.length, `${kind} from round ${start}`);
    }
  }
});

test("a single kind still never repeats a picture back to back", () => {
  for (let seed = 1; seed <= 50; seed += 1) {
    const deck = PuzzleDeck.create({ robot: collections.robot }, seeded(seed));
    let previous = null;
    for (let round = 0; round < 100; round += 1) {
      const picture = PuzzleDeck.next(deck);
      assert.notEqual(picture, previous);
      previous = picture;
    }
  }
});

test("empty kinds are skipped", () => {
  const deck = PuzzleDeck.create({ animal: collections.animal, robot: [] });
  for (let round = 0; round < 10; round += 1) assert.equal(kindOf(PuzzleDeck.next(deck)), "animal");
});
