"use strict";

// The Words tab's rules, kept free of the page so node can test them: which
// pictures make words, the order the words come in, how the board is laid
// out, where the letters start, how loose letters push each other about, and
// which slot a dropped letter fits. word-board.js draws it all and app.js
// routes touches to it.
//
// Sizes are in CSS pixels. A letter's position is the center of its glyph's
// ink box, and a slot's is the center of the etched glyph, so a seated
// letter sits exactly where its slot is.
const WordGame = (() => {
  const MIN_LETTERS = 3;
  const MAX_LETTERS = 6;
  // A plastic letter is its glyph fattened by this much on every side, and
  // this thick, both as fractions of the font size.
  const FATTEN = 0.012;
  const DEPTH = 0.075;
  // Room between a seated letter and the walls of its recess. Kept small
  // so the recess keeps the gaps inside letters like E and S open.
  const CLEARANCE = 0.026;
  // Space between neighboring recesses.
  const SLOT_GAP = 0.12;
  // The board's distance from the screen's sides, as on the puzzle.
  const MARGIN = 8;
  // Letters smaller than this font size would be hard for a toddler to tell
  // apart and to pick up. Only a very short screen, such as a small phone
  // turned sideways, goes below it, down to the smallest.
  const MIN_FONT = 40;
  const SMALLEST_FONT = 20;
  const MAX_FONT = 170;

  // Motion of loose letters, per second.
  const FRICTION = 5.5;
  const STOP_SPEED = 8;
  const BOUNCE = 0.35;
  const MAX_SPEED = 2200;
  // How fast a letter left on the board glides back down to the table.
  const RETURN_SPEED = 320;
  const RETURN_PULL = 9;
  // Pushes slower than this make no sound.
  const BUMP_SPEED = 90;
  // A letter coming back down from the board that lands on another steps
  // aside this fast, rather than resting on top of it.
  const ASIDE_SPEED = 360;
  // The table must be at least this many letters tall, and on a very short
  // screen, at least this many.
  const TABLE_ROWS = 2.1;
  const SHORT_TABLE_ROWS = 1.1;
  // Letters this close still count as touching once they have touched, so
  // a trembling fingertip pressing them together does not rattle.
  const HOLD_SLACK = 3;

  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  function shuffle(values, random) {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  // Every picture whose name is one word of 3 to 6 letters, once each.
  function wordsFrom(pictures) {
    const seen = new Set();
    return pictures.filter((picture) => {
      const word = picture.name.toUpperCase();
      if (!new RegExp(`^[A-Z]{${MIN_LETTERS},${MAX_LETTERS}}$`).test(word) || seen.has(word)) return false;
      seen.add(word);
      return true;
    }).map((picture) => ({ ...picture, word: picture.name.toUpperCase() }));
  }

  // Short words (3 or 4 letters) and long ones (5 or 6) take turns, starting
  // with a short one. Each group deals from a shuffled bag, so every word
  // comes up before any repeats, and never twice in a row.
  function createDeck(words, random = Math.random) {
    const groups = [
      words.filter((entry) => entry.word.length <= 4),
      words.filter((entry) => entry.word.length > 4),
    ].filter((group) => group.length);
    return { groups, bags: groups.map(() => []), last: groups.map(() => null), turn: 0, random };
  }

  function nextWord(deck) {
    const index = deck.turn % deck.groups.length;
    deck.turn += 1;
    const bag = deck.bags[index];
    if (!bag.length) {
      bag.push(...shuffle(deck.groups[index], deck.random));
      if (bag.length > 1 && bag[0] === deck.last[index]) bag.push(bag.shift());
    }
    deck.last[index] = bag.shift();
    return deck.last[index];
  }

  // metrics[char] is the glyph's ink box at a font size of 1: left and right
  // of the pen position, ascent above and descent below the baseline.
  function inkSize(metric, font) {
    return { width: (metric.left + metric.right) * font, height: (metric.ascent + metric.descent) * font };
  }

  // A loose letter's body: its plastic outline as a rounded box.
  function letterBody(metric, font) {
    const { width, height } = inkSize(metric, font);
    const hx = width / 2 + FATTEN * font;
    const hy = height / 2 + FATTEN * font;
    return { hx, hy, r: Math.min(hx, hy) * 0.7 };
  }

  // The etched word, its slots in a row on one baseline starting at left.
  function slotRow(chars, metrics, font, left, baseline) {
    const room = (FATTEN + CLEARANCE) * font;
    let x = left;
    return chars.map((char, index) => {
      const metric = metrics[char];
      const { width, height } = inkSize(metric, font);
      const slot = {
        index,
        char,
        x: x + room + width / 2,
        y: baseline + (metric.descent - metric.ascent) * font / 2,
        hx: width / 2 + room,
        hy: height / 2 + room,
      };
      x += width + 2 * room + SLOT_GAP * font;
      return slot;
    });
  }

  function rowWidth(chars, metrics, font) {
    const room = (FATTEN + CLEARANCE) * font;
    return chars.reduce((sum, char) => sum + inkSize(metrics[char], font).width + 2 * room, 0)
      + SLOT_GAP * font * (chars.length - 1);
  }

  // Where the letters first lie: in rows, a little apart from each other,
  // centered on the table a little above its middle. A row holds as many
  // letters as fit if all were the widest, so the rows are the same however
  // the letters are scrambled.
  function listRows(bodies, arena, font) {
    const gap = 0.34 * font;
    const width = arena.right - arena.left;
    const widest = Math.max(...bodies.map((body) => 2 * body.hx));
    // n letters and the gaps around them: n * widest + (n + 1) * gap <= width.
    const perRow = Math.max(1, Math.floor((width - gap) / (widest + gap)));
    const rows = [];
    for (let index = 0; index < bodies.length; index += perRow) rows.push(bodies.slice(index, index + perRow));
    const rowHeight = Math.max(...bodies.map((body) => 2 * body.hy)) + gap;
    return { rows, gap, rowHeight, height: rows.length * rowHeight - gap };
  }

  // Lays out the board and the table for one word on a screen of this size.
  // band is the grip band's width: loose letters must stay clear of it so
  // they can always be picked up. The largest letters that fit win, with the
  // picture over the word when there is the height, or beside it otherwise.
  function layout({ width, height, band, metrics, chars }) {
    const capHeight = Math.max(...chars.map((char) => metrics[char].ascent));
    const descent = Math.max(0, ...chars.map((char) => metrics[char].descent));
    // The width caps the size; the table's room for the letters, checked
    // below, caps it on short screens.
    const top = Math.min(MAX_FONT, width * 0.21, height * 0.3);
    const fit = { width, height, band, metrics, chars, capHeight, descent };
    for (let font = Math.floor(top); font >= MIN_FONT; font -= 2) {
      for (const arrangement of ["stacked", "side"]) {
        const found = tryLayout({ ...fit, font, arrangement });
        if (found) return found;
      }
    }
    // A very short screen: smaller letters, a smaller picture beside the
    // word, and a table only a row of letters tall.
    for (let font = MIN_FONT; font >= SMALLEST_FONT; font -= 2) {
      for (const arrangement of ["side", "stacked"]) {
        const found = tryLayout({ ...fit, font, arrangement, short: true });
        if (found) return found;
      }
    }
    return tryLayout({ ...fit, font: SMALLEST_FONT, arrangement: "side", short: true, force: true });
  }

  function tryLayout({ width, height, band, metrics, chars, font, capHeight, descent, arrangement, short = false, force = false }) {
    const pad = clamp(Math.round(0.2 * font), short ? 6 : 10, 28);
    const room = (FATTEN + CLEARANCE) * font;
    const rowHeight = (capHeight + descent) * font + 2 * room;
    const word = rowWidth(chars, metrics, font);
    const boardWidth = Math.min(width - 2 * MARGIN, Math.max(word + 2 * pad, 760));
    const stacked = arrangement === "stacked";
    const smallest = short ? 32 : 56;
    const picture = stacked ? Math.round(clamp(1.15 * rowHeight, smallest, 220)) : Math.round(clamp(1.2 * rowHeight, smallest, 200));
    const inner = stacked ? word : picture + pad + word;
    if (!force && inner > boardWidth - 2 * pad) return null;
    const boardHeight = stacked ? pad + picture + 0.5 * pad + rowHeight + pad : pad + Math.max(picture, rowHeight) + pad;
    const board = { x: (width - boardWidth) / 2, y: MARGIN, width: boardWidth, height: boardHeight };
    // The table stops short of the bottom grip band by the plastic's
    // thickness, which is drawn below a letter's outline.
    const arena = { left: band, right: width - band, top: board.y + board.height + 0.3 * font, bottom: height - band - DEPTH * font };

    const bodies = chars.map((char) => letterBody(metrics[char], font));
    const list = listRows(bodies, arena, font);
    // Room for the list, and for the letters to be moved about around it.
    const tallest = Math.max(...bodies.map((body) => 2 * body.hy));
    const tableHeight = arena.bottom - arena.top;
    if (!force && !short && (list.height + 2 * list.gap > tableHeight || tableHeight < TABLE_ROWS * tallest || list.rows.length > 2)) return null;
    if (!force && short && (list.height > tableHeight || tableHeight < SHORT_TABLE_ROWS * tallest || list.rows.length > 3)) return null;

    const left = board.x + (board.width - inner) / 2 + (stacked ? 0 : picture + pad);
    const rowTop = stacked ? board.y + pad + picture + 0.5 * pad : board.y + (board.height - rowHeight) / 2;
    const baseline = rowTop + room + capHeight * font;
    const pictureBox = stacked
      ? { x: board.x + (board.width - picture) / 2, y: board.y + pad, size: picture }
      : { x: board.x + (board.width - inner) / 2, y: board.y + (board.height - picture) / 2, size: picture };
    return {
      font,
      arrangement,
      board,
      picture: pictureBox,
      slots: slotRow(chars, metrics, font, left, baseline),
      arena,
    };
  }

  // The letters' starting places, a scrambled list on the table: their order
  // is never the word's own when another order exists. Each letter is
  // nudged and tilted a little, as if just tipped out of a box.
  function scatter(chars, metrics, geometry, random = Math.random) {
    const { font, arena } = geometry;
    const word = chars.join("");
    let order = chars.map((_, index) => index);
    for (let tries = 0; tries < 30; tries += 1) {
      order = shuffle(chars.map((_, index) => index), random);
      if (order.map((index) => chars[index]).join("") !== word) break;
    }
    const bodies = order.map((index) => ({ index, char: chars[index], ...letterBody(metrics[chars[index]], font) }));
    const { rows, gap, rowHeight, height } = listRows(bodies, arena, font);
    const middle = arena.top + (arena.bottom - arena.top) * 0.42;
    const firstRow = clamp(middle - height / 2, arena.top + gap / 2, arena.bottom - height - gap / 2);
    const jitter = gap * 0.3;
    const placed = [];
    rows.forEach((row, rowIndex) => {
      const span = row.reduce((sum, body) => sum + 2 * body.hx, 0) + gap * (row.length - 1);
      let x = (arena.left + arena.right) / 2 - span / 2;
      const y = firstRow + rowIndex * rowHeight + rowHeight / 2 - gap / 2;
      row.forEach((body) => {
        placed.push({
          ...body,
          x: clamp(x + body.hx + (random() * 2 - 1) * jitter, arena.left + body.hx, arena.right - body.hx),
          y: clamp(y + (random() * 2 - 1) * jitter, arena.top + body.hy, arena.bottom - body.hy),
          tilt: (random() * 2 - 1) * 7,
        });
        x += 2 * body.hx + gap;
      });
    });
    return placed;
  }

  // How far two letters' rounded boxes overlap, and along which direction
  // (from a toward b), or null when they do not touch.
  function contact(a, b, slack = 0) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const ix = (a.hx - a.r) + (b.hx - b.r);
    const iy = (a.hy - a.r) + (b.hy - b.r);
    const gx = Math.sign(dx) * Math.max(0, Math.abs(dx) - ix);
    const gy = Math.sign(dy) * Math.max(0, Math.abs(dy) - iy);
    const reach = a.r + b.r;
    const distance = Math.hypot(gx, gy);
    if (distance > 0) {
      if (distance >= reach + slack) return null;
      return { nx: gx / distance, ny: gy / distance, depth: reach - distance };
    }
    // The boxes' cores overlap: part them along the shallower side.
    const overlapX = ix + reach - Math.abs(dx);
    const overlapY = iy + reach - Math.abs(dy);
    if (overlapX < overlapY) return { nx: dx < 0 ? -1 : 1, ny: 0, depth: overlapX };
    return { nx: 0, ny: dy < 0 ? -1 : 1, depth: overlapY };
  }

  // A held letter follows its finger and pushes; nothing pushes it back.
  // Seated letters and ones sliding into a slot take no part.
  function weight(body) {
    if (body.mode === "free") return 1;
    if (body.mode === "held") return 0;
    return null;
  }

  // Which sides of the table each letter was against at the end of the last
  // step, so it knocks once on reaching a side, not on every step it is
  // pressed there.
  const against = new WeakMap();

  // Keeps a loose letter on the table, bouncing softly off its sides. A
  // letter above the table, as when let go over the board, is not stopped
  // there; it glides back down instead.
  function keepOnTable(body, arena, events) {
    const before = against.get(body) || new Set();
    const after = new Set();
    // gap: how far inside the table the letter's edge is.
    const side = (name, gap, speed) => {
      if (gap <= 0 || (before.has(name) && gap < HOLD_SLACK)) after.add(name);
      if (gap < 0 && speed > BUMP_SPEED && !before.has(name)) events.push({ type: "wall", speed, body });
    };
    const left = body.x - body.hx - arena.left;
    const right = arena.right - body.x - body.hx;
    const bottom = arena.bottom - body.y - body.hy;
    side("left", left, -body.vx);
    side("right", right, body.vx);
    side("bottom", bottom, body.vy);
    if (left < 0) {
      body.x = arena.left + body.hx;
      if (body.vx < 0) body.vx = -body.vx * BOUNCE;
    } else if (right < 0) {
      body.x = arena.right - body.hx;
      if (body.vx > 0) body.vx = -body.vx * BOUNCE;
    }
    if (bottom < 0) {
      body.y = arena.bottom - body.hy;
      // On a table shorter than the letter, it stops on the bottom; a
      // bounce would only lift it back above the table to be pulled down
      // again.
      if (body.vy > 0) body.vy = body.y - body.hy < arena.top ? 0 : -body.vy * BOUNCE;
    }
    against.set(body, after);
  }

  // Above the table and able to come down onto it: a letter already at the
  // bottom of a table too short for it is as far down as it can go.
  function above(body, arena) {
    return body.mode === "free" && body.y - body.hy < arena.top - 0.5 && body.y + body.hy < arena.bottom - 0.5;
  }

  // Which letters touched at the end of the last step, so a knock sounds
  // once when two meet, not on every step they stay pressed together.
  const touching = new WeakMap();

  // Moves the loose letters on by dt seconds. Held letters must already be
  // where their fingers are, with the velocity they moved at. Returns the
  // knocks that happened, for sound.
  function step(bodies, dt, arena) {
    const events = [];
    const touched = new Map(bodies.map((body) => [body, new Set()]));
    bodies.forEach((body) => {
      if (body.mode !== "free") return;
      if (body.pause > 0) {
        body.pause = Math.max(0, body.pause - dt);
        return;
      }
      const rise = arena.top - (body.y - body.hy);
      if (above(body, arena)) body.vy = Math.max(body.vy, Math.min(MAX_SPEED, RETURN_SPEED + rise * RETURN_PULL));
      const speed = Math.hypot(body.vx, body.vy);
      if (speed > MAX_SPEED) {
        body.vx *= MAX_SPEED / speed;
        body.vy *= MAX_SPEED / speed;
      }
      body.x += body.vx * dt;
      body.y += body.vy * dt;
      const decay = Math.exp(-FRICTION * dt);
      body.vx *= decay;
      body.vy *= decay;
      if (Math.hypot(body.vx, body.vy) < STOP_SPEED) {
        body.vx = 0;
        body.vy = 0;
      }
    });
    for (let pass = 0; pass < 4; pass += 1) {
      for (let i = 0; i < bodies.length; i += 1) {
        for (let j = i + 1; j < bodies.length; j += 1) {
          const a = bodies[i];
          const b = bodies[j];
          const wa = weight(a);
          const wb = weight(b);
          if (wa === null || wb === null || wa + wb === 0) continue;
          const wasTouching = touching.get(a)?.has(b);
          const touch = contact(a, b, wasTouching ? HOLD_SLACK : 0);
          if (!touch) continue;
          touched.get(a).add(b);
          touched.get(b).add(a);
          const { nx, ny, depth } = touch;
          if (depth <= 0) continue;
          // Coming down onto a letter from the board, step aside: pushed
          // straight back up, it would never get down onto the table.
          const [falling, below] = above(a, arena) && !above(b, arena) ? [a, b] : above(b, arena) && !above(a, arena) ? [b, a] : [];
          if (falling && Math.abs(ny) > 0.6 && weight(below) !== 0) {
            let side = Math.sign(falling.x - below.x) || (falling.x < (arena.left + arena.right) / 2 ? 1 : -1);
            const clear = below.x + side * (below.hx + 2 * falling.hx);
            if (clear > arena.right || clear < arena.left) side = -side;
            falling.vx = side * Math.max(Math.abs(falling.vx), ASIDE_SPEED);
          }
          const total = wa + wb;
          a.x -= nx * depth * wa / total;
          a.y -= ny * depth * wa / total;
          b.x += nx * depth * wb / total;
          b.y += ny * depth * wb / total;
          const closing = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (closing >= 0) continue;
          const impulse = -(1 + BOUNCE) * closing / total;
          a.vx -= impulse * wa * nx;
          a.vy -= impulse * wa * ny;
          b.vx += impulse * wb * nx;
          b.vy += impulse * wb * ny;
          // A pushed letter moves on at once, even one waiting to slide home.
          a.pause = wa ? 0 : a.pause;
          b.pause = wb ? 0 : b.pause;
          if (-closing > BUMP_SPEED && !wasTouching) events.push({ type: "bump", speed: -closing, a, b });
        }
      }
      bodies.forEach((body) => {
        if (body.mode === "free") keepOnTable(body, arena, events);
      });
    }
    touched.forEach((others, body) => touching.set(body, others));
    return events;
  }

  // One frame: held letters move from where they were to where their
  // fingers are now (targets: [{ body, x, y }]) and everything else moves on
  // by dt. The frame is cut into steps short enough that no letter, even a
  // thin I flicked fast, can pass through another between two steps.
  function advance(bodies, dt, arena, targets = []) {
    const moves = targets.map(({ body, x, y }) => ({ body, fromX: body.x, fromY: body.y, x, y }));
    const reach = Math.max(
      ...moves.map((move) => Math.hypot(move.x - move.fromX, move.y - move.fromY)),
      ...bodies.filter((body) => body.mode === "free").map((body) => Math.min(MAX_SPEED, Math.hypot(body.vx, body.vy)) * dt),
      0,
    );
    const thinnest = Math.min(...bodies.filter((body) => weight(body) !== null).map((body) => Math.min(body.hx, body.hy)), Infinity);
    const steps = clamp(Math.max(Math.ceil(dt * 120), Math.ceil(reach / Math.max(2, thinnest))), 1, 40);
    // How hard a held letter pushes: its finger's speed, but never more than
    // a thrown letter's, however short the frame.
    moves.forEach((move) => {
      const seconds = Math.max(dt, 1 / 120);
      const speed = Math.hypot(move.x - move.fromX, move.y - move.fromY) / seconds;
      const scale = speed > MAX_SPEED ? MAX_SPEED / speed : 1;
      move.vx = (move.x - move.fromX) / seconds * scale;
      move.vy = (move.y - move.fromY) / seconds * scale;
    });
    const events = [];
    for (let index = 1; index <= steps; index += 1) {
      moves.forEach((move) => {
        move.body.vx = move.vx;
        move.body.vy = move.vy;
        move.body.x = move.fromX + (move.x - move.fromX) * index / steps;
        move.body.y = move.fromY + (move.y - move.fromY) * index / steps;
      });
      events.push(...step(bodies, dt / steps, arena));
    }
    moves.forEach((move) => {
      move.body.vx = 0;
      move.body.vy = 0;
    });
    return events;
  }

  function moving(body) {
    return body.mode === "free" && (body.vx !== 0 || body.vy !== 0 || body.pause > 0);
  }

  // Whether a free letter is somewhere it cannot stay: above the table, or
  // overlapping another letter. The page keeps stepping until none are.
  function unsettled(bodies, arena) {
    return bodies.some((body, i) => body.mode === "free" && (moving(body)
      || above(body, arena)
      || bodies.some((other, j) => j !== i && weight(other) !== null && contact(body, other)?.depth > 0.5)));
  }

  // The empty slot a letter let go at (x, y) seats in: one for its own
  // letter, near enough. A forgiving reach, since small hands let go a
  // little early; the nearest of two matching slots wins.
  function seatFor(char, x, y, slots) {
    let best = null;
    let bestDistance = Infinity;
    slots.forEach((slot) => {
      if (slot.filled || slot.char !== char) return;
      if (Math.abs(x - slot.x) > slot.hx * 1.25 + 6 || Math.abs(y - slot.y) > slot.hy * 1.1 + 6) return;
      const distance = Math.hypot(x - slot.x, y - slot.y);
      if (distance < bestDistance) {
        best = slot;
        bestDistance = distance;
      }
    });
    return best;
  }

  // The slot a letter was let go over, whatever its letter.
  function slotUnder(x, y, slots) {
    return slots.find((slot) => Math.abs(x - slot.x) <= slot.hx && Math.abs(y - slot.y) <= slot.hy) || null;
  }

  // What to point out when the child seems stuck: the first empty slot,
  // and the loose letter nearest to it that fits there.
  function hint(slots, letters) {
    for (const slot of slots) {
      if (slot.filled) continue;
      const fits = letters.filter((letter) => letter.char === slot.char && letter.mode === "free");
      if (!fits.length) continue;
      fits.sort((a, b) => Math.hypot(a.x - slot.x, a.y - slot.y) - Math.hypot(b.x - slot.x, b.y - slot.y));
      return { slot, letter: fits[0] };
    }
    return null;
  }

  return {
    MIN_LETTERS,
    MAX_LETTERS,
    FATTEN,
    DEPTH,
    CLEARANCE,
    MIN_FONT,
    SMALLEST_FONT,
    BUMP_SPEED,
    wordsFrom,
    createDeck,
    nextWord,
    letterBody,
    layout,
    scatter,
    contact,
    step,
    advance,
    moving,
    unsettled,
    seatFor,
    slotUnder,
    hint,
  };
})();
if (typeof module !== "undefined") module.exports = WordGame;
