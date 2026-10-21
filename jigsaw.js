"use strict";

// Jigsaw cuts for the animal puzzle. The picture is a grid of SIZE-unit cells.
// Every inner cut gets one knob, randomly pointing into either neighbor, and
// both neighbors trace the same curve so assembled pieces interlock exactly.
// The outer border stays flat. Pieces never rotate, so the flat sides alone
// make every piece's shape unique to its spot.
const Jigsaw = (() => {
  const SIZE = 100;
  // Room around a cell for knobs, so every piece shares one square box whose
  // center is its cell's center.
  const PAD = 28;
  const KNOB = 0.1;
  const JITTER = 0.02;

  function jitter(random) {
    return (random() * 2 - 1) * JITTER;
  }

  function cut(random) {
    return { flip: random() < 0.5 ? -1 : 1, b: jitter(random), c: jitter(random), d: jitter(random) };
  }

  // horizontal[row][column] is the cut below that row; vertical[row][column]
  // is the cut right of that column. Positive flips push the knob down or right.
  function createCuts(columns, rows, random = Math.random) {
    const horizontal = Array.from({ length: rows - 1 }, () => Array.from({ length: columns }, () => cut(random)));
    const vertical = Array.from({ length: rows }, () => Array.from({ length: columns - 1 }, () => cut(random)));
    return { columns, rows, horizontal, vertical };
  }

  // The nine Bezier points of one knobbed cut, as (along, across) fractions of
  // the cell side; across is toward the knob. Based on Draradech's generator.
  function knobPoints({ b, c, d }) {
    const t = KNOB;
    return [
      [0.2, 0],
      [0.5 + b + d, -t + c],
      [0.5 - t + b, t + c],
      [0.5 - 2.4 * t + b - d, 3 * t + c],
      [0.5 + 2.4 * t + b - d, 3 * t + c],
      [0.5 + t + b, t + c],
      [0.5 + b + d, -t + c],
      [0.8, 0],
      [1, 0],
    ];
  }

  // Absolute points for a cut that runs left to right (or top to bottom).
  function cutPoints(edge, x, y, horizontal) {
    return knobPoints(edge).map(([along, across]) => {
      const offset = across * edge.flip * SIZE;
      return horizontal ? [x + along * SIZE, y + offset] : [x + offset, y + along * SIZE];
    });
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function curves(points) {
    let path = "";
    for (let i = 0; i < points.length; i += 3) {
      path += ` C ${points.slice(i, i + 3).map(([x, y]) => `${round(x)} ${round(y)}`).join(" ")}`;
    }
    return path;
  }

  // start and end follow the cut's own direction. Pieces trace clockwise, so
  // bottom and left sides run the cut backward with its points reversed.
  function side(edge, start, end, horizontal, reversed) {
    const [x, y] = reversed ? start : end;
    if (!edge) return ` L ${x} ${y}`;
    const points = cutPoints(edge, start[0], start[1], horizontal);
    return curves(reversed ? [...points.slice(0, -1).reverse(), start] : points);
  }

  function piecePath(cuts, column, row) {
    const x = column * SIZE;
    const y = row * SIZE;
    const corners = [[x, y], [x + SIZE, y], [x + SIZE, y + SIZE], [x, y + SIZE]];
    const top = row > 0 ? cuts.horizontal[row - 1][column] : null;
    const right = column < cuts.columns - 1 ? cuts.vertical[row][column] : null;
    const bottom = row < cuts.rows - 1 ? cuts.horizontal[row][column] : null;
    const left = column > 0 ? cuts.vertical[row][column - 1] : null;
    return `M ${x} ${y}`
      + side(top, corners[0], corners[1], true, false)
      + side(right, corners[1], corners[2], false, false)
      + side(bottom, corners[3], corners[2], true, true)
      + side(left, corners[0], corners[3], false, true)
      + " Z";
  }

  // The piece's square box in picture units, for an SVG viewBox.
  function pieceBox(column, row) {
    return { x: column * SIZE - PAD, y: row * SIZE - PAD, size: SIZE + 2 * PAD };
  }

  // Sizes the board and the tray of loose pieces, in px, for the area below
  // the puzzle heading. The board spans the width less a small margin. It
  // shrinks only when the tray below it could not otherwise hold every piece
  // at minPiece or larger. Tray pieces are never larger than seated ones, and
  // the tray stays clear of the grip band so every piece can be picked up.
  function fitLayout({ width, height, grid, margin, band, frame, gap, padding, minPiece }) {
    const count = grid * grid;
    const span = (SIZE + 2 * PAD) / SIZE;
    const trayWidth = width - 2 * band;
    let fit = null;
    for (let board = Math.floor(width - 2 * margin); board >= 2 * frame + grid; board -= 1) {
      const seated = (board - 2 * frame) / grid * span;
      fit = null;
      for (let columns = 1; columns <= count; columns += 1) {
        const rows = Math.ceil(count / columns);
        const piece = Math.floor(Math.min(seated,
          (trayWidth - 2 * padding - (columns - 1) * gap) / columns,
          (height - board - 2 * padding - (rows - 1) * gap) / rows));
        if (!fit || piece > fit.piece) fit = { board, piece, columns, rows };
      }
      if (fit.piece >= Math.min(minPiece, seated)) break;
    }
    return fit;
  }

  return { SIZE, PAD, createCuts, piecePath, pieceBox, fitLayout };
})();
if (typeof module !== "undefined") module.exports = Jigsaw;
