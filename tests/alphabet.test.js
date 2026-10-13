"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Alphabet = require("../alphabet.js");
const groups = require("../alphabet.json");

test("A–Z have five distinct matching choices with local images and phrases", () => {
  assert.equal(groups.map(group => group.letter).join(""), "ABCDEFGHIJKLMNOPQRSTUVWXYZ");
  for (const group of groups) {
    assert.ok(group.items.length >= 5);
    assert.equal(new Set(group.items.map(item => item.name)).size, group.items.length);
    for (const item of group.items) {
      assert.equal(item.name[0], group.letter);
      for (const asset of [item.image, item.audio]) {
        assert.ok(fs.statSync(path.join(__dirname, "..", asset)).size > 0, asset);
      }
    }
  }
});

test("initial animal appears first, then every alternative before repeats", () => {
  for (const group of groups) {
    const card = Alphabet.create(group);
    assert.equal(card.items[card.index], group.items[0]);
    const seen = new Set([card.index]);
    for (let i = 1; i < group.items.length; i++) {
      Alphabet.advance(card);
      assert.ok(!seen.has(card.index));
      seen.add(card.index);
    }
    assert.equal(seen.size, group.items.length);
  }
});

test("shuffles stay independent and never repeat adjacent items across cycles", () => {
  for (const random of [() => 0, () => 0.999, Math.random]) {
    const a = Alphabet.create(groups[0], random);
    const b = Alphabet.create(groups[1], random);
    for (let i = 0; i < 100; i++) {
      const before = a.index;
      Alphabet.advance(a, random);
      assert.notEqual(a.index, before);
      assert.equal(b.index, 0);
    }
  }
});

test('every alphabet choice uses explicit US letter pronunciation and refreshed audio', () => {
  const pronunciations = require('../alphabet-pronunciations.json');
  assert.equal(pronunciations.Y, 'Why');
  assert.equal(pronunciations.Z, 'Zee');
  for (const group of groups) {
    const card = Alphabet.create(group);
    assert.equal(card.spokenLetter, pronunciations[group.letter]);
    for (const item of group.items) assert.ok(/-us(?:-v\d+)?\.mp3$/.test(item.audio));
  }
});
