"use strict";

// Each card starts with its animal, then exhausts a shuffled bag before
// reshuffling. Even across bags, the current item cannot appear twice in a row.
const AlphabetCards = (() => {
  function shuffle(values, random = Math.random) {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function create(group, random = Math.random) {
    return { letter: group.letter, spokenLetter: group.spokenLetter || group.letter, items: group.items, index: 0,
      remaining: shuffle(group.items.map((_, i) => i).slice(1), random) };
  }

  function advance(card, random = Math.random) {
    if (card.items.length < 2) return card.items[card.index];
    if (!card.remaining.length) {
      card.remaining = shuffle(card.items.map((_, i) => i), random);
      if (card.remaining[0] === card.index) {
        [card.remaining[0], card.remaining[1]] = [card.remaining[1], card.remaining[0]];
      }
    }
    card.index = card.remaining.shift();
    return card.items[card.index];
  }

  return { create, advance };
})();
if (typeof module !== "undefined") module.exports = AlphabetCards;
