"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Jigsaw = require("../jigsaw.js");

const GRID = 3;

function seeded(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rounds(count = 200) {
  return Array.from({ length: count }, (_, seed) => Jigsaw.createCuts(GRID, GRID, seeded(seed + 1)));
}

// Splits a piece path into its four sides (top, right, bottom, left), each as
// the full list of points it passes through or is steered by.
function sides(path, column, row) {
  const S = Jigsaw.SIZE;
  const x = column * S;
  const y = row * S;
  const corners = [[x + S, y], [x + S, y + S], [x, y + S], [x, y]];
  const tokens = path.trim().split(/\s+/);
  assert.equal(tokens[0], "M");
  let at = [Number(tokens[1]), Number(tokens[2])];
  assert.deepEqual(at, [x, y]);
  const result = [];
  let current = { flat: true, points: [at], segments: 0 };
  for (let i = 3; i < tokens.length;) {
    const command = tokens[i++];
    if (command === "Z") break;
    const count = command === "C" ? 3 : 1;
    for (let n = 0; n < count; n += 1) {
      at = [Number(tokens[i++]), Number(tokens[i++])];
      current.points.push(at);
    }
    current.segments += 1;
    if (command === "C") current.flat = false;
    const corner = corners[result.length];
    if (at[0] === corner[0] && at[1] === corner[1]) {
      result.push(current);
      current = { flat: true, points: [at], segments: 0 };
    }
  }
  assert.equal(result.length, 4, "four sides that end on the cell corners");
  return result;
}

function cubic(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return [0, 1].map((axis) => u * u * u * p0[axis] + 3 * u * u * t * p1[axis] + 3 * u * t * t * p2[axis] + t * t * t * p3[axis]);
}

function sample(points, steps = 60) {
  const result = [];
  for (let i = 0; i + 3 < points.length; i += 3) {
    for (let s = 0; s <= steps; s += 1) result.push(cubic(points[i], points[i + 1], points[i + 2], points[i + 3], s / steps));
  }
  return result;
}

test("neighbors trace exactly the same cut, so assembled pieces leave no gaps", () => {
  for (const cuts of rounds()) {
    const piece = (column, row) => sides(Jigsaw.piecePath(cuts, column, row), column, row);
    for (let row = 0; row < GRID; row += 1) {
      for (let column = 0; column < GRID; column += 1) {
        const [, right, bottom] = piece(column, row);
        if (column < GRID - 1) assert.deepEqual(right.points, [...piece(column + 1, row)[3].points].reverse());
        if (row < GRID - 1) assert.deepEqual(bottom.points, [...piece(column, row + 1)[0].points].reverse());
      }
    }
  }
});

test("the outer border is flat and every inner side has one knob or socket", () => {
  for (const cuts of rounds(20)) {
    for (let row = 0; row < GRID; row += 1) {
      for (let column = 0; column < GRID; column += 1) {
        const [top, right, bottom, left] = sides(Jigsaw.piecePath(cuts, column, row), column, row);
        const border = [row === 0, column === GRID - 1, row === GRID - 1, column === 0];
        [top, right, bottom, left].forEach((side, n) => {
          assert.equal(side.flat, border[n]);
          assert.equal(side.segments, border[n] ? 1 : 3);
        });
      }
    }
  }
});

test("knobs stay inside the shared piece box, which is centered on the cell", () => {
  let deepest = 0;
  for (const cuts of rounds()) {
    for (let row = 0; row < GRID; row += 1) {
      for (let column = 0; column < GRID; column += 1) {
        const box = Jigsaw.pieceBox(column, row);
        assert.equal(box.x + box.size / 2, (column + 0.5) * Jigsaw.SIZE);
        assert.equal(box.y + box.size / 2, (row + 0.5) * Jigsaw.SIZE);
        for (const side of sides(Jigsaw.piecePath(cuts, column, row), column, row)) {
          for (const [x, y] of sample(side.points)) {
            assert.ok(x > box.x && x < box.x + box.size && y > box.y && y < box.y + box.size, `${x},${y} in ${JSON.stringify(box)}`);
            deepest = Math.max(deepest, column * Jigsaw.SIZE - x, x - (column + 1) * Jigsaw.SIZE, row * Jigsaw.SIZE - y, y - (row + 1) * Jigsaw.SIZE);
          }
        }
      }
    }
  }
  // Knobs are big enough to see and grip, but never reach the box's edge.
  assert.ok(deepest > 0.22 * Jigsaw.SIZE && deepest < Jigsaw.PAD, `deepest knob ${deepest}`);
});

test("every knob locks: its head is wider than its neck", () => {
  for (const cuts of rounds()) {
    for (const [row, column, horizontal] of [
      ...cuts.horizontal.flatMap((cells, r) => cells.map((_, c) => [r, c, true])),
      ...cuts.vertical.flatMap((cells, r) => cells.map((_, c) => [r, c, false])),
    ]) {
      // Measure the cut from the piece above or left of it, in (along, out).
      const [, right, bottom] = sides(Jigsaw.piecePath(cuts, column, row), column, row);
      const edge = horizontal ? cuts.horizontal[row][column] : cuts.vertical[row][column];
      const points = sample(horizontal ? bottom.points : right.points, 200).map(([x, y]) => horizontal
        ? [x, (y - (row + 1) * Jigsaw.SIZE) * edge.flip]
        : [y, (x - (column + 1) * Jigsaw.SIZE) * edge.flip]);
      const peak = Math.max(...points.map(([, out]) => out));
      const widths = [];
      for (let level = 0.15 * peak; level < 0.9 * peak; level += peak / 40) {
        const crossings = [];
        for (let i = 1; i < points.length; i += 1) {
          const [a, b] = [points[i - 1], points[i]];
          if ((a[1] - level) * (b[1] - level) <= 0 && a[1] !== b[1]) {
            crossings.push(a[0] + (b[0] - a[0]) * (level - a[1]) / (b[1] - a[1]));
          }
        }
        widths.push(Math.max(...crossings) - Math.min(...crossings));
      }
      const neckAt = widths.indexOf(Math.min(...widths.slice(0, widths.length / 2)));
      const head = Math.max(...widths.slice(neckAt));
      assert.ok(head > widths[neckAt] * 1.25, `head ${head} vs neck ${widths[neckAt]}`);
    }
  }
});

test("pieces never rotate, so each spot's shape is unique", () => {
  for (const cuts of rounds(20)) {
    const signatures = new Set();
    for (let row = 0; row < GRID; row += 1) {
      for (let column = 0; column < GRID; column += 1) {
        const [top, right, bottom, left] = sides(Jigsaw.piecePath(cuts, column, row), column, row);
        signatures.add([top, right, bottom, left].map((side) => (side.flat ? "flat" : "cut")).join());
      }
    }
    assert.equal(signatures.size, GRID * GRID);
  }
});

test("each round can cut the same picture differently", () => {
  const paths = new Set(rounds(10).map((cuts) => Jigsaw.piecePath(cuts, 1, 1)));
  assert.equal(paths.size, 10);
});

const LAYOUT = { grid: GRID, margin: 8, band: 48, frame: 7, gap: 6, padding: 8, minPiece: 48 };
const SPAN = (Jigsaw.SIZE + 2 * Jigsaw.PAD) / Jigsaw.SIZE;

function trayHeight({ piece, rows }) {
  return rows * piece + (rows - 1) * LAYOUT.gap + 2 * LAYOUT.padding;
}

function trayWidth({ piece, columns }) {
  return columns * piece + (columns - 1) * LAYOUT.gap + 2 * LAYOUT.padding;
}

test("on a phone the board spans the screen less a small margin", () => {
  // A 412 px wide phone in Chrome, below a one-row header and the title.
  const fit = Jigsaw.fitLayout({ ...LAYOUT, width: 412, height: 560 });
  assert.equal(fit.board, 412 - 2 * LAYOUT.margin);
  assert.ok(fit.piece >= LAYOUT.minPiece, `tray pieces ${fit.piece}px`);
  assert.equal(fit.rows * fit.columns >= GRID * GRID, true);
  assert.ok(trayWidth(fit) <= 412 - 2 * LAYOUT.band, "the tray stays clear of the grip band");
  assert.ok(fit.board + trayHeight(fit) <= 560);
});

test("the board gives up width only to keep tray pieces big enough to grab", () => {
  const roomy = Jigsaw.fitLayout({ ...LAYOUT, width: 412, height: 560 });
  const short = Jigsaw.fitLayout({ ...LAYOUT, width: 412, height: 470 });
  assert.ok(short.board < roomy.board);
  assert.ok(short.piece >= LAYOUT.minPiece);
  // One more pixel of board would push the tray below its smallest pieces.
  const wider = Jigsaw.fitLayout({ ...LAYOUT, width: short.board + 1 + 2 * LAYOUT.margin, height: 470 });
  assert.ok(wider.board <= short.board + 1);
});

test("tray pieces are never larger than the pieces they become on the board", () => {
  const fit = Jigsaw.fitLayout({ ...LAYOUT, width: 600, height: 6000 });
  assert.equal(fit.board, 600 - 2 * LAYOUT.margin);
  assert.equal(fit.piece, Math.floor((fit.board - 2 * LAYOUT.frame) / GRID * SPAN));
});

test("every screen size gets a layout that fits", () => {
  for (let width = 320; width <= 1100; width += 37) {
    for (let height = 420; height <= 1700; height += 53) {
      const fit = Jigsaw.fitLayout({ ...LAYOUT, width, height });
      const seated = (fit.board - 2 * LAYOUT.frame) / GRID * SPAN;
      const label = `${width}x${height} ${JSON.stringify(fit)}`;
      assert.ok(fit.board <= width - 2 * LAYOUT.margin, label);
      assert.ok(fit.rows * fit.columns >= GRID * GRID, label);
      assert.ok(fit.piece <= seated, label);
      assert.ok(trayWidth(fit) <= width - 2 * LAYOUT.band, label);
      if (fit.piece >= LAYOUT.minPiece) assert.ok(fit.board + trayHeight(fit) <= height, label);
      // The board is full width whenever the tray still holds big enough pieces.
      if (fit.board < width - 2 * LAYOUT.margin) {
        const full = Jigsaw.fitLayout({ ...LAYOUT, width, height: height + 10000 });
        assert.ok(full.board > fit.board, label);
      }
    }
  }
});
