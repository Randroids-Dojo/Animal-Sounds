"use strict";

// Picks each round's puzzle picture. Kinds (animals, dinosaurs, foods,
// robots) take turns in a shuffled order, so no kind comes up twice in a row
// and a big kind cannot crowd out a small one. Each kind deals its pictures
// from a shuffled bag, so every picture appears before any repeats, and the
// same picture never comes up twice in a row.
const PuzzleDeck = (() => {
  function shuffle(values, random) {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function draw(bag, values, previous, random) {
    if (!bag.length) {
      bag.push(...shuffle(values, random));
      if (bag.length > 1 && bag[0] === previous) bag.push(bag.shift());
    }
    return bag.shift();
  }

  // collections: { kind: [picture, ...] }. Empty kinds are skipped.
  function create(collections, random = Math.random) {
    const kinds = Object.keys(collections).filter((kind) => collections[kind].length);
    return { collections, kinds, random, kindBag: [], bags: {}, kind: null, picture: null };
  }

  function next(deck) {
    deck.kind = draw(deck.kindBag, deck.kinds, deck.kind, deck.random);
    deck.bags[deck.kind] ||= [];
    deck.picture = draw(deck.bags[deck.kind], deck.collections[deck.kind], deck.picture, deck.random);
    return deck.picture;
  }

  return { create, next };
})();
if (typeof module !== "undefined") module.exports = PuzzleDeck;
