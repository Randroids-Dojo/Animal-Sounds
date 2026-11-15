"use strict";

// The goldfish tank's drawing and motion. goldfish.js holds the care rules;
// app.js routes touches here and supplies sounds and the voice.
//
// Built to stay cheap on the kiosk tablet's weak GPU:
// - The water, light, plants, pebbles and pirate ship are painted once into
//   one canvas, and again only if the tank changes size.
// - The fish is redrawn every frame, but into its own small canvas, which
//   then only moves. Its turn, tilt and growth are drawn inside that canvas,
//   so the moving layer is only ever translated, never scaled.
// - Flakes and the thought bubble are small elements moved by translation;
//   bubbles and ripples are compositor animations.
// - Cloudy water is one small canvas painted once and stretched, so it comes
//   out soft for free. Only its opacity changes.
// - Nothing runs unless the tab is showing and awake.
const FishTank = (() => {
  const INK = "#3B3560";
  const TAU = Math.PI * 2;
  const MAX_FLAKES = 15;
  const MAX_BUBBLES = 28;
  const FLAKE_COLORS = ["#E8743B", "#F2C14E", "#D9533F", "#F09A4A"];
  const PEBBLE_COLORS = ["#FFE6A7", "#C9EDD3", "#FFD7DB", "#E3DCFA", "#FFDFC2", "#E6DED2", "#C9BFB2", "#F7F3EA"];
  // Draining and refilling, in milliseconds.
  const DRAIN_MS = 1300;
  const REFILL_AT = 1500;
  const REFILL_MS = 1700;

  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); };

  function seeded(seed) {
    return () => {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function mixColor(from, to, t) {
    const a = parseInt(from.slice(1), 16);
    const b = parseInt(to.slice(1), 16);
    const channel = (shift) => Math.round(lerp((a >> shift) & 255, (b >> shift) & 255, clamp(t, 0, 1)));
    return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
  }

  // Goldfish orange at every age, washing out toward pale when sick.
  function fishPalette(look) {
    const tone = (orange, pale) => mixColor(orange, pale, look.sickness * 0.7);
    return {
      back: tone("#FF7A1F", "#B9B79C"),
      belly: tone("#FFC24D", "#DEDCC6"),
      fin: tone("#FF9E3D", "#CFCCB4"),
      ray: tone("#FFD28A", "#E7E5D2"),
    };
  }

  function createScene(ctx, geometry) {
    const { width: W, height: H, surface, pebbleTop, ship } = geometry;
    const rng = seeded(7);
    // Water, darker with depth, under a little air at the top.
    const water = ctx.createLinearGradient(0, surface, 0, H);
    water.addColorStop(0, "#CFF1F3");
    water.addColorStop(0.55, "#8FD3DB");
    water.addColorStop(1, "#5BB0C0");
    ctx.fillStyle = water;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#EEF8F8";
    ctx.fillRect(0, 0, W, surface);
    // Soft light from above.
    ctx.fillStyle = "rgba(255, 255, 255, 0.09)";
    for (const [top, spread, lean] of [[0.18, 0.1, 0.16], [0.46, 0.07, 0.2], [0.7, 0.12, 0.14]]) {
      ctx.beginPath();
      ctx.moveTo(W * top, surface);
      ctx.lineTo(W * (top + spread), surface);
      ctx.lineTo(W * (top + spread + lean), H * 0.85);
      ctx.lineTo(W * (top + lean - spread * 0.3), H * 0.85);
      ctx.closePath();
      ctx.fill();
    }
    // The water's surface.
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 6) {
      const y = surface + Math.sin(x / 26) * 1.6;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Seaweed behind the ship, away from it.
    const plantSide = ship.x > W / 2 ? 0 : 1;
    const plantX = plantSide === 0 ? [W * 0.1, W * 0.19, W * 0.3] : [W * 0.7, W * 0.81, W * 0.9];
    const depth = pebbleTop - surface;
    plantX.forEach((x, index) => {
      const height = depth * (0.24 + rng() * 0.14 + (index === 1 ? 0.12 : 0));
      drawSeaweed(ctx, x, pebbleTop + 10, height, clamp(Math.min(W, H) * 0.014, 5, 9), rng);
    });

    const pebbleSize = clamp(Math.min(W, H) * 0.02, 5, 12);
    // A bed of gravel, with the back rows drawn before the ship.
    ctx.fillStyle = "#CDBFA9";
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) ctx.lineTo(x, pebbleTop + Math.sin(x / 70) * pebbleSize * 0.6);
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
    const rows = [];
    for (let y = pebbleTop; y < H + pebbleSize; y += pebbleSize * 1.05) rows.push(y);
    const pebbleRow = (y) => {
      for (let x = -pebbleSize + rng() * pebbleSize; x < W + pebbleSize; x += pebbleSize * (1.5 + rng() * 0.5)) {
        const yy = y + Math.sin(x / 70) * pebbleSize * 0.6 + (rng() - 0.5) * pebbleSize * 0.5;
        drawPebble(ctx, x, yy, pebbleSize * (0.75 + rng() * 0.55), PEBBLE_COLORS[Math.floor(rng() * PEBBLE_COLORS.length)], rng);
      }
    };
    rows.filter((y) => y < ship.y).forEach(pebbleRow);
    drawShip(ctx, ship);
    // The front rows bury the ship's keel.
    rows.filter((y) => y >= ship.y).forEach(pebbleRow);
  }

  // A gently bent stem with leaves on alternate sides.
  function drawSeaweed(ctx, x, base, height, thickness, rng) {
    const sway = (rng() - 0.5) * thickness * 4;
    const steps = 5;
    const points = [{ x, y: base }];
    for (let step = 1; step <= steps; step += 1) {
      points.push({ x: x + Math.sin(step * 1.3 + x) * thickness * 1.4 + sway * (step / steps), y: base - (height * step) / steps });
    }
    const stem = new Path2D();
    stem.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1];
      const to = points[index];
      stem.quadraticCurveTo(from.x + (to.x - from.x) * 0.2 + thickness, (from.y + to.y) / 2, to.x, to.y);
    }
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = INK;
    ctx.lineWidth = thickness + 4;
    ctx.stroke(stem);
    ctx.strokeStyle = "#4FA96E";
    ctx.lineWidth = thickness;
    ctx.stroke(stem);
    points.slice(1).forEach((point, index) => {
      const side = index % 2 ? 1 : -1;
      const leaf = thickness * (2.6 - index * 0.25);
      ctx.save();
      ctx.translate(point.x, point.y + leaf * 0.4);
      ctx.rotate(side * 0.9 - 0.2 * side * index * 0.2);
      ctx.beginPath();
      ctx.ellipse(0, -leaf, leaf * 0.55, leaf, 0, 0, TAU);
      ctx.fillStyle = index % 2 ? "#6CC58A" : "#5DBB7E";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -leaf * 0.2);
      ctx.lineTo(0, -leaf * 1.6);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawPebble(ctx, x, y, size, color, rng) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((rng() - 0.5) * 1.2);
    ctx.beginPath();
    ctx.ellipse(0, 0, size, size * (0.62 + rng() * 0.2), 0, 0, TAU);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "rgba(59, 53, 96, 0.55)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-size * 0.3, -size * 0.25, size * 0.28, size * 0.14, -0.3, 0, TAU);
    ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
    ctx.fill();
    ctx.restore();
  }

  // A little wooden ship, tipped over and half buried. Its unit is the ship's
  // length; portholes are listed in shipPoint() for bubbles.
  const PORTHOLES = [[-0.13, -0.06], [0.05, -0.065], [0.22, -0.075]];
  function drawShip(ctx, ship) {
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.angle);
    ctx.scale(ship.size, ship.size);
    const line = 3 / ship.size;
    ctx.lineWidth = line;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = INK;

    // Broken mast, its yard hanging, and a tattered flag.
    ctx.save();
    ctx.translate(0.02, -0.18);
    ctx.rotate(0.14);
    ctx.fillStyle = "#8A5A33";
    ctx.beginPath();
    ctx.moveTo(-0.02, 0);
    ctx.lineTo(-0.02, -0.5);
    ctx.lineTo(-0.005, -0.53);
    ctx.lineTo(0.008, -0.49);
    ctx.lineTo(0.02, -0.52);
    ctx.lineTo(0.02, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.save();
    ctx.translate(0, -0.36);
    ctx.rotate(0.42);
    ctx.fillStyle = "#9A6A40";
    ctx.beginPath();
    ctx.rect(-0.17, -0.014, 0.32, 0.028);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.moveTo(-0.02, -0.49);
    ctx.lineTo(-0.24, -0.47);
    ctx.lineTo(-0.21, -0.43);
    ctx.lineTo(-0.25, -0.4);
    ctx.lineTo(-0.2, -0.37);
    ctx.lineTo(-0.23, -0.33);
    ctx.lineTo(-0.02, -0.35);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // A friendly skull and crossbones.
    ctx.strokeStyle = "#FFF6DA";
    ctx.lineWidth = line * 1.1;
    ctx.beginPath();
    ctx.moveTo(-0.17, -0.37);
    ctx.lineTo(-0.07, -0.44);
    ctx.moveTo(-0.07, -0.37);
    ctx.lineTo(-0.17, -0.44);
    ctx.stroke();
    ctx.fillStyle = "#FFF6DA";
    ctx.beginPath();
    ctx.arc(-0.12, -0.425, 0.032, 0, TAU);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(-0.132, -0.428, 0.008, 0, TAU);
    ctx.arc(-0.108, -0.428, 0.008, 0, TAU);
    ctx.fill();
    ctx.restore();

    // The hull, with a raised stern on the left and the bow on the right.
    ctx.strokeStyle = INK;
    ctx.lineWidth = line;
    const hull = new Path2D();
    hull.moveTo(-0.5, -0.31);
    hull.lineTo(-0.3, -0.31);
    hull.lineTo(-0.28, -0.19);
    hull.lineTo(0.3, -0.19);
    hull.lineTo(0.5, -0.3);
    hull.quadraticCurveTo(0.44, 0.06, 0.26, 0.13);
    hull.lineTo(-0.34, 0.13);
    hull.quadraticCurveTo(-0.5, 0.0, -0.5, -0.31);
    hull.closePath();
    ctx.fillStyle = "#A9693A";
    ctx.fill(hull);
    ctx.save();
    ctx.clip(hull);
    ctx.fillStyle = "rgba(59, 53, 96, 0.16)";
    ctx.fillRect(-0.6, 0.02, 1.2, 0.2);
    ctx.strokeStyle = "rgba(59, 53, 96, 0.35)";
    ctx.lineWidth = line * 0.7;
    ctx.beginPath();
    for (const y of [-0.24, -0.12, 0.0, 0.08]) {
      ctx.moveTo(-0.6, y);
      ctx.lineTo(0.6, y);
    }
    ctx.stroke();
    // Moss along the waterline and a hole in the side.
    ctx.fillStyle = "rgba(93, 187, 126, 0.55)";
    for (const [x, y, r] of [[-0.42, 0.06, 0.05], [-0.3, 0.1, 0.04], [0.18, 0.1, 0.05], [0.33, 0.06, 0.035]]) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    ctx.stroke(hull);
    ctx.fillStyle = "#2C5560";
    ctx.beginPath();
    ctx.moveTo(-0.39, -0.08);
    ctx.lineTo(-0.33, -0.12);
    ctx.lineTo(-0.3, -0.07);
    ctx.lineTo(-0.27, -0.09);
    ctx.lineTo(-0.28, -0.01);
    ctx.lineTo(-0.36, 0.0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Deck rail.
    ctx.strokeStyle = "#7A4A2A";
    ctx.lineWidth = line * 1.3;
    ctx.beginPath();
    ctx.moveTo(-0.5, -0.35);
    ctx.lineTo(-0.3, -0.35);
    ctx.stroke();
    ctx.strokeStyle = INK;
    ctx.lineWidth = line;
    for (const [x, y] of PORTHOLES) {
      ctx.beginPath();
      ctx.arc(x, y, 0.036, 0, TAU);
      ctx.fillStyle = "#24525E";
      ctx.fill();
      ctx.lineWidth = line * 2.2;
      ctx.strokeStyle = "#E3B24E";
      ctx.stroke();
      ctx.lineWidth = line * 0.8;
      ctx.strokeStyle = INK;
      ctx.beginPath();
      ctx.arc(x, y, 0.052, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  function shipPoint(ship, [x, y]) {
    const cos = Math.cos(ship.angle);
    const sin = Math.sin(ship.angle);
    return { x: ship.x + (x * cos - y * sin) * ship.size, y: ship.y + (x * sin + y * cos) * ship.size };
  }

  // Murky water, painted small once and stretched so it comes out soft.
  function paintCloud(canvas, rng) {
    const width = 40;
    const height = 60;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "rgba(154, 160, 104, 0.62)";
    ctx.fillRect(0, 0, width, height);
    for (let blob = 0; blob < 26; blob += 1) {
      const x = rng() * width;
      const y = rng() * height;
      const r = 4 + rng() * 9;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
      const light = rng() > 0.5;
      glow.addColorStop(0, light ? "rgba(214, 214, 170, 0.6)" : "rgba(116, 124, 78, 0.5)");
      glow.addColorStop(1, "rgba(154, 160, 104, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }

  // The fish in units of its length, facing right, centered on its body.
  function drawFish(ctx, fish, look, palette, gradient) {
    const { length: L, flip, pitch, phase, wag, mouth } = fish;
    const baby = 1 - clamp((look.size - 0.38) / 0.62, 0, 1);
    const sick = look.sickness;
    const fins = look.fins;
    const half = 0.2 + 0.035 * baby + 0.02 * look.fullness;
    const belly = 0.025 * look.fullness;
    ctx.save();
    ctx.scale(L * flip, L);
    ctx.rotate(pitch);
    // Babies are rounder.
    ctx.scale(0.9 + 0.1 * (1 - baby), 1);
    ctx.lineWidth = clamp(L * 0.014, 1.4, 3) / L;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = INK;

    // Tail: a double fan that grows longer with age, wagging from its base.
    const tail = 0.28 + 0.24 * fins;
    const spread = 0.22 + 0.14 * fins;
    const lag = Math.sin(phase - 0.9) * 0.05;
    ctx.save();
    ctx.translate(-0.4, 0);
    ctx.rotate(Math.sin(phase) * wag);
    ctx.beginPath();
    ctx.moveTo(0.03, -0.055);
    ctx.quadraticCurveTo(-tail * 0.45, -spread * 0.5, -tail, -spread + lag);
    ctx.quadraticCurveTo(-tail * 0.78, -0.03, -tail * 0.58, lag * 0.5);
    ctx.quadraticCurveTo(-tail * 0.78, 0.03, -tail, spread + lag);
    ctx.quadraticCurveTo(-tail * 0.45, spread * 0.5, 0.03, 0.055);
    ctx.closePath();
    ctx.fillStyle = palette.fin;
    ctx.globalAlpha = 0.95;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
    ctx.strokeStyle = palette.ray;
    ctx.lineWidth *= 0.8;
    ctx.beginPath();
    for (const k of [-0.7, -0.35, 0.35, 0.7]) {
      ctx.moveTo(-0.02, k * 0.05);
      ctx.lineTo(-tail * 0.82, k * spread * 0.92 + lag * 0.6);
    }
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = INK;

    // Back fin, folded down when sick; belly fins below.
    const fin = (0.12 + 0.09 * fins) * (1 - 0.65 * sick);
    const flutter = Math.sin(phase * 0.8) * 0.02;
    ctx.fillStyle = palette.fin;
    ctx.beginPath();
    ctx.moveTo(0.1, -half * 0.9);
    ctx.quadraticCurveTo(0.0, -half - fin * 1.25, -0.16 + flutter, -half - fin);
    ctx.quadraticCurveTo(-0.2, -half * 0.85, -0.27, -half * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-0.0, half * 0.85);
    ctx.quadraticCurveTo(-0.04, half + 0.13, -0.13 + flutter, half + 0.1);
    ctx.quadraticCurveTo(-0.11, half * 0.85, -0.12, half * 0.75);
    ctx.closePath();
    ctx.moveTo(-0.25, 0.12);
    ctx.quadraticCurveTo(-0.3, 0.24, -0.37 + flutter, 0.21);
    ctx.quadraticCurveTo(-0.33, 0.12, -0.33, 0.08);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Body, plumper when full.
    ctx.beginPath();
    ctx.moveTo(0.37, 0.02);
    ctx.bezierCurveTo(0.36, -half * 0.9, 0.12, -half * 1.05, -0.06, -half);
    ctx.bezierCurveTo(-0.24, -half * 0.95, -0.36, -0.1, -0.42, -0.05);
    ctx.lineTo(-0.42, 0.05);
    ctx.bezierCurveTo(-0.34, 0.12, -0.22, half * 1.05 + belly, -0.04, half + belly);
    ctx.bezierCurveTo(0.14, half * 0.95 + belly, 0.35, half * 0.6, 0.37, 0.02);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.stroke();
    // Scales and gill.
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.beginPath();
    for (const [x, y] of [[0.02, -0.04], [-0.1, 0.04], [-0.2, -0.04], [-0.06, -0.12]]) {
      ctx.moveTo(x + 0.04, y - 0.035);
      ctx.quadraticCurveTo(x - 0.02, y, x + 0.04, y + 0.035);
    }
    ctx.stroke();
    ctx.strokeStyle = "rgba(59, 53, 96, 0.55)";
    ctx.beginPath();
    ctx.moveTo(0.18, -half * 0.62);
    ctx.quadraticCurveTo(0.11, 0, 0.18, half * 0.62);
    ctx.stroke();
    ctx.strokeStyle = INK;
    // Side fin, paddling.
    ctx.save();
    ctx.translate(0.1, 0.07);
    ctx.rotate(0.5 + Math.sin(phase * 1.7) * 0.35 * (1 - 0.5 * sick));
    ctx.beginPath();
    ctx.ellipse(-0.07, 0, 0.085, 0.036, 0, 0, TAU);
    ctx.fillStyle = palette.fin;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // Rosy cheek.
    ctx.fillStyle = "rgba(255, 120, 120, 0.3)";
    ctx.beginPath();
    ctx.arc(0.27, 0.07, 0.035, 0, TAU);
    ctx.fill();

    // A big eye, looking where it is going; heavy-lidded when sick.
    const r = 0.066 + 0.03 * baby;
    const ex = 0.22;
    const ey = -0.045;
    ctx.beginPath();
    ctx.arc(ex, ey, r, 0, TAU);
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(ex + r * 0.22 + fish.lookX * r * 0.15, ey + fish.lookY * r * 0.25, r * 0.6, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.arc(ex + r * 0.05, ey - r * 0.28, r * 0.22, 0, TAU);
    ctx.fill();
    if (sick > 0.05) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(ex, ey, r, 0, TAU);
      ctx.clip();
      ctx.fillStyle = palette.back;
      ctx.fillRect(ex - r, ey - r, r * 2, r * (0.5 + 0.7 * sick));
      ctx.restore();
      ctx.beginPath();
      ctx.moveTo(ex - r * 0.95, ey - r + r * (0.5 + 0.7 * sick));
      ctx.lineTo(ex + r * 0.95, ey - r + r * (0.5 + 0.7 * sick));
      ctx.stroke();
    }
    // Mouth: a gulping "o" while eating or hungry, otherwise a small smile.
    if (mouth > 0.08) {
      ctx.fillStyle = "#7A2E3A";
      ctx.beginPath();
      ctx.ellipse(0.36, 0.04, 0.022 + 0.01 * mouth, 0.04 * mouth, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      if (sick > 0.3) {
        ctx.moveTo(0.33, 0.07);
        ctx.quadraticCurveTo(0.35, 0.05, 0.37, 0.07);
      } else {
        ctx.moveTo(0.32, 0.055);
        ctx.quadraticCurveTo(0.345, 0.08, 0.37, 0.05);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function create({ root, feedButton, waterButton, load, save, sound = {}, say = () => {}, now = () => Date.now(), random = Math.random, reducedMotion = () => false }) {
    const scene = root.querySelector(".tank-scene");
    const leftoverLayer = root.querySelector(".tank-leftovers");
    const life = root.querySelector(".tank-life");
    const fishCanvas = root.querySelector(".tank-fish");
    const cloud = root.querySelector(".tank-cloud");
    const air = root.querySelector(".tank-air");
    const thought = root.querySelector(".tank-thought");
    const thoughtIcon = thought.querySelector("img");
    const shaker = root.querySelector(".tank-shaker");
    const fishContext = fishCanvas.getContext("2d");
    paintCloud(cloud, seeded(11));

    // The tank's size follows the screen, the header and the buttons.
    new ResizeObserver(() => active && layout()).observe(root);
    let state = Goldfish.restore(load(), now());
    Goldfish.advance(state, now());
    let look = Goldfish.looks(state, now());
    let palette = null;
    let gradient = null;
    let paletteKey = "";
    let geometry = null;
    let density = 1;
    let frame = null;
    let active = false;
    let lastFrame = 0;
    let lastTick = 0;
    let lastSave = 0;
    let frames = 0;
    let clock = 0;
    let draining = null;
    let followPoint = null;
    let come = null;
    let hoverUntil = 0;
    let nextShipBubbles = 0;
    let thoughtShown = "";
    let arrivedTimer = null;
    const flakes = [];
    const fish = {
      x: 0, y: 0, vx: 0, vy: 0, face: 1, flip: 1, pitch: 0, phase: 0, wag: 0.2, mouth: 0,
      length: 0, box: { width: 0, height: 0 }, lookX: 0, lookY: 0,
      target: null, wiggleUntil: 0, shakeUntil: 0, placed: false, lingering: false,
      // Recent positions: a tap lands a moment after the finger came down,
      // by which time a swimming fish has moved on.
      trail: [],
    };

    function persist(force = false) {
      if (!force && clock - lastSave < 20) return;
      lastSave = clock;
      save(state);
    }

    function layout() {
      const width = root.clientWidth;
      const height = root.clientHeight;
      if (!width || !height) return;
      density = Math.min(window.devicePixelRatio || 1, 2);
      const surface = Math.max(14, height * 0.04);
      const pebbleTop = height - clamp(height * 0.12, 40, 120);
      const shipSize = Math.min(width * 0.44, (pebbleTop - surface) * 0.55, 330);
      const ship = { x: width - shipSize * 0.58, y: pebbleTop + shipSize * 0.05, size: shipSize, angle: -0.13 };
      const changed = !geometry || geometry.width !== width || geometry.height !== height || scene.dataset.density !== String(density);
      geometry = {
        width, height, surface, pebbleTop, ship,
        adult: clamp(Math.min(width, height) * 0.42, 120, 230),
        speed: clamp(Math.min(width, height) * 0.5, 90, 320),
      };
      sizeFish();
      if (changed) {
        scene.dataset.density = String(density);
        scene.width = Math.round(width * density);
        scene.height = Math.round(height * density);
        const ctx = scene.getContext("2d");
        ctx.setTransform(density, 0, 0, density, 0, 0);
        createScene(ctx, geometry);
        placeLeftovers();
      }
      if (!fish.placed) {
        // Where it would be: a sick fish is found low in the tank.
        fish.x = width * 0.4;
        fish.y = look.sick ? pebbleTop - fish.length * 0.5 : surface + (pebbleTop - surface) * 0.4;
        fish.placed = true;
      }
      keepFishInWater();
      air.style.height = `${height}px`;
      cloud.style.top = `${surface}px`;
      cloud.style.height = `${height - surface}px`;
      positionAir(surface);
    }

    function sizeFish() {
      const length = Math.round(geometry.adult * look.size);
      if (length === fish.length && density === fish.density) return;
      fish.length = length;
      fish.density = density;
      fish.box = { width: Math.ceil(length * 2.15), height: Math.ceil(length * 1.5) };
      fishCanvas.width = Math.ceil(fish.box.width * density);
      fishCanvas.height = Math.ceil(fish.box.height * density);
      fishCanvas.style.width = `${fish.box.width}px`;
      fishCanvas.style.height = `${fish.box.height}px`;
      fish.thought = clamp(length * 0.45, 48, 70);
      thought.style.setProperty("--thought-size", `${fish.thought}px`);
      paletteKey = "";
    }

    function waterTop() {
      if (!draining) return geometry.surface;
      return draining.level;
    }

    function bounds() {
      const L = fish.length;
      return {
        left: L * 0.5,
        right: geometry.width - L * 0.5,
        top: waterTop() + L * 0.3,
        bottom: geometry.pebbleTop - L * 0.2,
      };
    }

    function keepFishInWater() {
      const box = bounds();
      fish.x = clamp(fish.x, box.left, box.right);
      fish.y = clamp(fish.y, box.top, Math.max(box.top, box.bottom));
    }

    // Saved flakes on the pebbles land in the same places each visit.
    function placeLeftovers() {
      leftoverLayer.replaceChildren();
      for (let index = 0; index < state.leftovers; index += 1) addLeftover(index);
    }

    function addLeftover(index, x = null) {
      const rng = seeded(100 + index);
      const dot = document.createElement("span");
      dot.className = "tank-leftover";
      const size = clamp(fish.length * 0.08, 5, 10) || 6;
      const left = x ?? geometry.width * (0.06 + rng() * 0.88);
      const top = geometry.pebbleTop + (geometry.height - geometry.pebbleTop) * (0.05 + rng() * 0.4);
      Object.assign(dot.style, {
        left: `${left - size / 2}px`, top: `${top}px`, width: `${size}px`, height: `${size * 0.8}px`,
        background: FLAKE_COLORS[index % FLAKE_COLORS.length],
      });
      leftoverLayer.append(dot);
    }

    function refreshLook() {
      look = Goldfish.looks(state, now());
      if (geometry) sizeFish();
      const key = `${look.sickness.toFixed(2)}|${fish.length}|${look.fullness.toFixed(1)}`;
      if (key !== paletteKey) {
        paletteKey = key;
        palette = fishPalette(look);
        gradient = fishContext.createLinearGradient(0, -0.24, 0, 0.24);
        gradient.addColorStop(0, palette.back);
        gradient.addColorStop(0.55, palette.back);
        gradient.addColorStop(1, palette.belly);
      }
      if (!draining) cloud.style.opacity = String((look.cloud * 0.85).toFixed(3));
      const needsWater = look.needsWater || Boolean(draining);
      if (waterButton.hidden === needsWater) {
        waterButton.hidden = !needsWater;
        // Slides in when it appears. The glow, if it starts at once, takes
        // over, so the class is cleared on a timer rather than animationend.
        waterButton.classList.toggle("arriving", needsWater);
        clearTimeout(arrivedTimer);
        if (needsWater) arrivedTimer = setTimeout(() => waterButton.classList.remove("arriving"), 500);
      }
      root.dataset.sick = String(look.sick);
      root.setAttribute("aria-label", describe());
    }

    function describe() {
      const parts = [`A goldfish, ${look.ageDays} ${look.ageDays === 1 ? "day" : "days"} old`];
      if (look.sick) parts.push("it looks sick");
      else if (look.hungry) parts.push("it looks hungry");
      if (look.needsWater) parts.push("the water is cloudy");
      return `${parts.join(", ")}.`;
    }

    // A fish sick in dirty water will not eat. Once the water is fresh it
    // eats again while it gets well.
    function refusesFood() {
      return look.sick && look.needsWater;
    }

    // One thing at a time: a fish sick in dirty water asks for clean water,
    // then a hungry one for food, then cloudy water asks to be changed. Water
    // is only asked for while Change water is showing. The matching button
    // glows.
    function need() {
      if (draining) return "";
      if (refusesFood()) return "water";
      if (look.hungry && !flakes.length) return "food";
      if (look.needsWater && !look.hungry) return "water";
      return "";
    }

    function showThought() {
      const wanted = need();
      const busy = fish.wiggleUntil > clock || followPoint || come;
      const shown = busy ? "" : wanted;
      if (shown !== thoughtShown) {
        thoughtShown = shown;
        if (shown) thoughtIcon.src = shown === "food" ? "images/fish/feed.svg" : "images/fish/water.svg";
        thought.classList.toggle("showing", Boolean(shown));
      }
      feedButton.classList.toggle("wanted", wanted === "food");
      waterButton.classList.toggle("wanted", wanted === "water");
    }

    function bubble(x, y, size = 8 + random() * 8, rise = null) {
      if (reducedMotion() || life.querySelectorAll(".tank-bubble").length >= MAX_BUBBLES) return;
      const element = document.createElement("span");
      element.className = "tank-bubble";
      element.style.width = element.style.height = `${size}px`;
      element.style.left = `${x - size / 2}px`;
      element.style.top = `${y - size / 2}px`;
      life.append(element);
      const height = rise ?? Math.max(20, y - waterTop() - size);
      const sway = (random() - 0.5) * 30;
      const animation = element.animate([
        { transform: "translate3d(0, 0, 0)", opacity: 0.9 },
        { transform: `translate3d(${sway}px, ${-height * 0.5}px, 0)`, opacity: 0.9, offset: 0.5 },
        { transform: `translate3d(${-sway * 0.5}px, ${-height}px, 0)`, opacity: 0 },
      ], { duration: 900 + height * 7, easing: "ease-in" });
      animation.finished.then(() => element.remove(), () => element.remove());
    }

    function mouthPoint() {
      const L = fish.length;
      return { x: fish.x + Math.sign(fish.flip || 1) * L * 0.4, y: fish.y + L * 0.02 };
    }

    function ripple(x, y) {
      if (reducedMotion()) return;
      const ring = document.createElement("span");
      ring.className = "tank-ripple";
      ring.style.left = `${x}px`;
      ring.style.top = `${y}px`;
      life.append(ring);
      ring.animate([
        { transform: "translate(-50%, -50%) scale(0.3)", opacity: 0.9 },
        { transform: "translate(-50%, -50%) scale(1.5)", opacity: 0 },
      ], { duration: 650, easing: "ease-out" }).finished.then(() => ring.remove(), () => ring.remove());
    }

    function wander() {
      const box = bounds();
      const L = fish.length;
      let x = lerp(box.left, box.right, random());
      let y;
      if (look.sick) {
        // A sick fish mopes along the bottom.
        x = clamp(fish.x + (random() - 0.5) * L * 3, box.left, box.right);
        y = lerp(box.bottom - L * 0.5, box.bottom, random());
      } else if (look.hungry) {
        y = lerp(box.top, lerp(box.top, box.bottom, 0.3), random());
      } else {
        y = lerp(box.top, box.bottom, random());
      }
      fish.target = { x, y };
    }

    function nearestFlake() {
      let best = null;
      let bestDistance = Infinity;
      for (const flake of flakes) {
        const distance = Math.hypot(flake.x - fish.x, flake.y - fish.y);
        if (distance < bestDistance) {
          best = flake;
          bestDistance = distance;
        }
      }
      return best;
    }

    function removeFlake(flake) {
      flakes.splice(flakes.indexOf(flake), 1);
      flake.element.remove();
    }

    function update(dt) {
      const L = fish.length;
      const box = bounds();
      const sick = look.sickness;
      let speed = geometry.speed * (0.55 + 0.45 * look.size);
      let target = fish.target;
      let pace = 0.5;
      // A moving target's own speed, added so the fish keeps up with it.
      let carry = 0;
      let mouthSide = 0;
      const eating = look.wantsFood && !refusesFood() && flakes.length > 0;
      if (followPoint) {
        target = followPoint;
        pace = 1.5;
      } else if (come) {
        target = come;
        pace = 1.25;
      } else if (eating) {
        const flake = nearestFlake();
        // Line the mouth up with the sinking flake, facing it.
        mouthSide = flake.x >= fish.x ? 1 : -1;
        target = { x: flake.x - mouthSide * L * 0.38, y: flake.y - L * 0.02 };
        carry = flake.vy;
        pace = 1.2;
      } else {
        // Swim somewhere, linger a moment, then pick somewhere new.
        const arrived = target && Math.hypot(target.x - fish.x, target.y - fish.y) < L * 0.2 + 6;
        if (arrived && !fish.lingering) {
          fish.lingering = true;
          hoverUntil = clock + 0.8 + random() * 2.2;
          if (random() < 0.3 && !look.sick) {
            const mouth = mouthPoint();
            bubble(mouth.x, mouth.y, 5 + random() * 4);
          }
        }
        if (!target || (fish.lingering && clock > hoverUntil)) {
          fish.lingering = false;
          wander();
        }
        target = fish.target;
      }
      speed *= pace * (1 - 0.65 * sick);
      const tx = clamp(target.x, box.left, box.right);
      const ty = clamp(target.y, box.top, Math.max(box.top, box.bottom));
      const dx = tx - fish.x;
      const dy = ty - fish.y;
      const distance = Math.hypot(dx, dy);
      const arrive = Math.min(1, distance / (L * 0.6 + 30));
      const desiredX = distance > 0.5 ? (dx / distance) * speed * arrive : 0;
      const desiredY = (distance > 0.5 ? (dy / distance) * speed * arrive : 0) + carry;
      const grip = 1 - Math.exp(-dt * (followPoint ? 5 : 2.6));
      fish.vx += (desiredX - fish.vx) * grip;
      fish.vy += (desiredY - fish.vy) * grip;
      if (fish.wiggleUntil > clock) {
        // A happy little hop when tapped.
        fish.vy += Math.sin((fish.wiggleUntil - clock) * 18) * speed * dt * 2;
      }
      fish.x += fish.vx * dt;
      fish.y += fish.vy * dt;
      keepFishInWater();
      fish.trail.push({ at: clock, x: fish.x, y: fish.y });
      // A tap is recognized up to 0.7 s after the finger lands, plus arbitration.
      while (fish.trail.length && fish.trail[0].at < clock - 0.85) fish.trail.shift();
      if (come && distance < L * 0.25 + 8) come = null;

      // Eat a flake that reaches the mouth.
      if (eating) {
        const mouth = mouthPoint();
        for (const flake of [...flakes]) {
          if (Math.hypot(flake.x - mouth.x, flake.y - mouth.y) > Math.max(14, L * 0.2)) continue;
          if (!Goldfish.eat(state)) break;
          removeFlake(flake);
          fish.mouth = 1;
          sound.gulp?.();
          bubble(mouth.x, mouth.y, 5);
          refreshLook();
          persist(true);
          if (!look.wantsFood) {
            // Full: a little happy wiggle, then it ignores the rest.
            fish.wiggleUntil = clock + 0.6;
            sound.happy?.();
          }
          break;
        }
      }

      // Facing and tilt follow the swimming.
      const speedNow = Math.hypot(fish.vx, fish.vy);
      let face = fish.face;
      if (mouthSide && distance < L) face = mouthSide;
      else if (fish.vx > 8) face = 1;
      else if (fish.vx < -8) face = -1;
      else if (followPoint || come) face = dx >= 0 ? 1 : -1;
      fish.face = face;
      fish.flip += clamp(face - fish.flip, -dt * 7, dt * 7);
      if (Math.abs(fish.flip) < 0.08) fish.flip = 0.08 * face;
      const shaking = fish.shakeUntil > clock;
      const tilt = clamp(Math.atan2(fish.vy, Math.abs(fish.vx) + 25), -0.45, 0.45) + sick * 0.18
        + (shaking ? Math.sin(clock * 34) * 0.22 : 0);
      fish.pitch += (tilt - fish.pitch) * (1 - Math.exp(-dt * 6));
      const effort = clamp(speedNow / (geometry.speed * 0.6), 0, 1);
      const wiggling = fish.wiggleUntil > clock;
      fish.phase += dt * TAU * ((sick ? 0.7 : 1.3) + 3.2 * effort + (wiggling ? 5 : 0));
      fish.wag = (0.16 + 0.3 * effort) * (1 - 0.55 * sick) + (wiggling ? 0.25 : 0);
      fish.lookX = clamp(dx / (L + 1), -1, 1) * face;
      fish.lookY = clamp(dy / (L + 1), -1, 1);
      // A hungry fish gapes at the surface.
      const gape = look.hungry && !refusesFood() && !eating ? 0.35 + 0.35 * Math.sin(clock * 5) : 0;
      fish.mouth = Math.max(gape, fish.mouth - dt * 3);

      updateFlakes(dt);
      if (clock > nextShipBubbles) {
        nextShipBubbles = clock + 5 + random() * 5;
        shipBubbles(2 + Math.floor(random() * 3));
      }
    }

    function updateFlakes(dt) {
      const sink = (geometry.pebbleTop - geometry.surface) / 9;
      for (const flake of [...flakes]) {
        flake.age += dt;
        // Flakes float a moment, then drift down.
        flake.vy = flake.age > 0.7 ? sink * Math.min(1, (flake.age - 0.7) / 0.7) : 0;
        flake.y += flake.vy * dt;
        flake.x += Math.sin(flake.age * 2.2 + flake.wobble) * dt * 10;
        if (flake.y >= geometry.pebbleTop + 4) {
          removeFlake(flake);
          Goldfish.leftover(state);
          if (state.leftovers > leftoverLayer.childElementCount) addLeftover(state.leftovers - 1, flake.x);
          refreshLook();
          persist(true);
        }
      }
    }

    function shipBubbles(count) {
      const { ship } = geometry;
      const port = PORTHOLES[Math.floor(random() * PORTHOLES.length)];
      const point = shipPoint(ship, port);
      for (let index = 0; index < count; index += 1) {
        setTimeout(() => active && bubble(point.x + (random() - 0.5) * 6, point.y), index * 180);
      }
    }

    function render() {
      const { width, height } = fish.box;
      fishContext.setTransform(1, 0, 0, 1, 0, 0);
      fishContext.clearRect(0, 0, fishCanvas.width, fishCanvas.height);
      fishContext.setTransform(density, 0, 0, density, (width / 2) * density, (height / 2) * density);
      drawFish(fishContext, fish, look, palette, gradient);
      const bob = Math.sin(clock * 1.7) * Math.min(3, fish.length * 0.03) * (1 - look.sickness * 0.7);
      const x = fish.x - width / 2;
      const y = fish.y - height / 2 + bob;
      fishCanvas.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      // Over its head, or beside it when that would leave the water.
      const L = fish.length;
      const size = fish.thought;
      let tx = fish.x + fish.face * L * 0.15;
      let ty = fish.y - L * 0.42 + bob;
      const top = geometry.surface + size + 18;
      if (ty < top) {
        tx = fish.x + fish.face * (L * 0.45 + size * 0.6);
        if (tx < size * 0.6 || tx > geometry.width - size * 0.6) tx = fish.x - fish.face * (L * 1.05 + size * 0.55);
        ty = Math.max(top, fish.y + size * 0.5);
      }
      tx = clamp(tx, size * 0.6, geometry.width - size * 0.6);
      thought.style.transform = `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0)`;
      for (const flake of flakes) {
        flake.element.style.transform = `translate3d(${flake.x.toFixed(1)}px, ${flake.y.toFixed(1)}px, 0)`;
      }
    }

    function tick(time) {
      frame = null;
      if (!active) return;
      const dt = lastFrame ? Math.min(0.05, (time - lastFrame) / 1000) : 1 / 60;
      lastFrame = time;
      clock += dt;
      frames += 1;
      if (clock - lastTick >= 1) {
        lastTick = clock;
        Goldfish.advance(state, now());
        refreshLook();
        persist();
      }
      if (draining) runDrain();
      update(dt);
      showThought();
      render();
      frame = requestAnimationFrame(tick);
    }

    function activate() {
      if (active) return;
      active = true;
      Goldfish.advance(state, now());
      refreshLook();
      layout();
      refreshLook();
      lastFrame = 0;
      nextShipBubbles = clock + 2;
      frame = requestAnimationFrame(tick);
    }

    // Leaving the tab, dimming or a lock stops everything. Flakes still in the
    // water are eaten if the fish wants them and settle otherwise.
    function deactivate() {
      if (!active) return;
      active = false;
      cancelAnimationFrame(frame);
      frame = null;
      // Finish a water change quietly: no chime on whatever page comes next.
      if (draining) finishDrain(false);
      for (const flake of [...flakes]) {
        removeFlake(flake);
        if (!refusesFood() && Goldfish.eat(state)) continue;
        Goldfish.leftover(state);
        if (state.leftovers > leftoverLayer.childElementCount) addLeftover(state.leftovers - 1, flake.x);
      }
      followPoint = null;
      come = null;
      fish.trail = [];
      life.querySelectorAll(".tank-bubble, .tank-ripple").forEach((element) => element.remove());
      shaker.classList.remove("shaking");
      // The page may stay on screen under the dim or a break: stop every
      // looping animation too, not just the frame loop.
      thoughtShown = "";
      thought.classList.remove("showing");
      feedButton.classList.remove("wanted");
      waterButton.classList.remove("wanted");
      refreshLook();
      save(state);
    }

    function feed() {
      if (!active || draining) return;
      const L = fish.length;
      // Over the fish when it is hungry, so the food finds it.
      const x = clamp(look.wantsFood ? fish.x + fish.face * L * 0.6 : geometry.width * (0.25 + random() * 0.5),
        geometry.width * 0.12, geometry.width * 0.88);
      shaker.style.left = `${x}px`;
      shaker.style.top = `${geometry.surface}px`;
      shaker.classList.remove("shaking");
      void shaker.offsetWidth;
      shaker.classList.add("shaking");
      sound.sprinkle?.();
      const size = clamp(L * 0.075, 5, 11);
      for (let index = 0; index < 3 && flakes.length < MAX_FLAKES; index += 1) {
        const element = document.createElement("span");
        element.className = "tank-flake";
        element.style.width = `${size}px`;
        element.style.height = `${size * 0.8}px`;
        element.style.margin = `${-size / 2}px 0 0 ${-size / 2}px`;
        element.style.background = FLAKE_COLORS[Math.floor(random() * FLAKE_COLORS.length)];
        life.append(element);
        flakes.push({ element, x: x + (index - 1) * size * 2.2 + (random() - 0.5) * size, y: geometry.surface + 4, vy: 0, age: -index * 0.12, wobble: random() * TAU });
      }
      if (!look.wantsFood && !refusesFood()) {
        // Full: it shakes its head and turns away.
        fish.shakeUntil = clock + 0.7;
        fish.target = { x: clamp(fish.x - (x - fish.x), 0, geometry.width), y: fish.y + fish.length * 0.5 };
        hoverUntil = clock + 1.5;
      }
      render();
    }

    function positionAir(level) {
      air.style.transform = `translate3d(0, ${(level - geometry.height).toFixed(1)}px, 0)`;
    }

    // Drain about half the water, sweep the old food away, and refill.
    function changeWater() {
      if (!active || draining) return;
      const low = Math.max(geometry.surface + (geometry.pebbleTop - geometry.surface) * 0.5,
        geometry.ship.y - geometry.ship.size * 0.6);
      draining = { started: clock, low, level: geometry.surface, cleaned: false, filling: false };
      root.classList.add("changing-water");
      for (const flake of [...flakes]) removeFlake(flake);
      leftoverLayer.classList.add("draining");
      sound.drain?.();
      refreshLook();
    }

    function runDrain() {
      const elapsed = (clock - draining.started) * 1000;
      const { low } = draining;
      if (elapsed < DRAIN_MS) draining.level = lerp(geometry.surface, low, smooth(elapsed / DRAIN_MS));
      else if (elapsed < REFILL_AT) draining.level = low;
      else draining.level = lerp(low, geometry.surface, smooth((elapsed - REFILL_AT) / REFILL_MS));
      positionAir(draining.level);
      if (!draining.cleaned && elapsed >= DRAIN_MS) {
        draining.cleaned = true;
        Goldfish.changeWater(state);
        leftoverLayer.replaceChildren();
        leftoverLayer.classList.remove("draining");
        persist(true);
      }
      if (!draining.filling && elapsed >= REFILL_AT) {
        draining.filling = true;
        root.classList.add("pouring");
        sound.fill?.();
        cloud.style.opacity = "0";
      }
      if (draining.filling && random() < 0.5) {
        bubble(geometry.width * (0.15 + random() * 0.1), lerp(draining.level, geometry.pebbleTop, random()), 6 + random() * 10);
      }
      if (elapsed >= REFILL_AT + REFILL_MS) finishDrain();
    }

    function finishDrain(celebrate = true) {
      if (!draining.cleaned) {
        Goldfish.changeWater(state);
        leftoverLayer.replaceChildren();
        leftoverLayer.classList.remove("draining");
      }
      draining = null;
      root.classList.remove("changing-water", "pouring");
      positionAir(geometry.surface);
      if (celebrate) {
        fish.wiggleUntil = clock + 0.8;
        sound.happy?.();
      }
      refreshLook();
      save(state);
    }

    function hitFish(x, y) {
      const L = fish.length;
      const rx = Math.max(L * 0.6, 34);
      const ry = Math.max(L * 0.32, 30);
      return [{ x: fish.x, y: fish.y }, ...fish.trail]
        .some((at) => ((x - at.x) / rx) ** 2 + ((y - at.y) / ry) ** 2 <= 1);
    }

    function hitShip(x, y) {
      const { ship } = geometry;
      const cos = Math.cos(-ship.angle);
      const sin = Math.sin(-ship.angle);
      const lx = ((x - ship.x) * cos - (y - ship.y) * sin) / ship.size;
      const ly = ((x - ship.x) * sin + (y - ship.y) * cos) / ship.size;
      return lx >= -0.52 && lx <= 0.52 && ly >= -0.72 && ly <= 0.15;
    }

    function toTank(clientX, clientY) {
      const rect = root.getBoundingClientRect();
      const borderX = (rect.width - root.clientWidth) / 2;
      const borderY = (rect.height - root.clientHeight) / 2;
      return { x: clientX - rect.left - borderX, y: clientY - rect.top - borderY };
    }

    // What a tap touched: the fish, the ship, or the water.
    function tap(clientX, clientY) {
      if (!active) return "";
      const { x, y } = toTank(clientX, clientY);
      if (hitFish(x, y)) {
        fish.wiggleUntil = clock + 0.9;
        come = null;
        const mouth = mouthPoint();
        for (let index = 0; index < 4; index += 1) {
          setTimeout(() => active && bubble(mouth.x, mouth.y - index * 4, 6 + random() * 6), index * 140);
        }
        sound.bubble?.();
        say("Goldfish");
        return "fish";
      }
      if (hitShip(x, y)) {
        shipBubbles(7);
        sound.bubble?.();
        say("Pirate ship");
        return "ship";
      }
      ripple(x, y);
      sound.plip?.();
      // Curious: it comes to see.
      come = { x, y };
      return "water";
    }

    function follow(clientX, clientY) {
      if (!active) return;
      followPoint = toTank(clientX, clientY);
      come = null;
    }

    function release() {
      if (!followPoint) return;
      followPoint = null;
      fish.target = { x: fish.x + fish.vx * 0.4, y: fish.y + fish.vy * 0.4 };
      hoverUntil = clock + 0.8;
    }

    return {
      activate,
      deactivate,
      layout: () => active && layout(),
      feed,
      changeWater,
      tap,
      follow,
      release,
      get active() { return active; },
      get state() { return state; },
      set state(next) {
        state = Goldfish.restore(next, now());
        if (geometry) placeLeftovers();
        refreshLook();
        save(state);
      },
      debug: () => ({
        active,
        frames,
        fish: { x: fish.x, y: fish.y, length: fish.length, face: fish.face, mouth: fish.mouth, shaking: fish.shakeUntil > clock },
        flakes: flakes.map((flake) => ({ x: flake.x, y: flake.y })),
        leftovers: leftoverLayer.childElementCount,
        draining: Boolean(draining),
        level: geometry ? waterTop() : 0,
        palette,
        following: Boolean(followPoint),
        coming: Boolean(come),
        thought: thoughtShown,
        look: { ...look },
        geometry: geometry && { ...geometry, ship: { ...geometry.ship } },
      }),
    };
  }

  return { create, PORTHOLES, shipPoint };
})();
