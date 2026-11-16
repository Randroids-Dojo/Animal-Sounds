"use strict";

// The Words tab: a wooden board with a picture and its name etched into it,
// and plastic letters loose on the table below, to be dragged into the
// etching. word-game.js holds the rules and the motion; app.js routes
// touches here and supplies the sounds and the voice.
//
// Cheap to draw on the kiosk tablet, like the puzzle and the tank:
// - The wood and its etched slots are painted once per word into one canvas.
// - Each letter is painted once into small canvases (lying, lifted, seated)
//   and is then only moved by translation, never scaled.
// - Nothing runs unless the tab is showing and awake, and the motion stops
//   as soon as every letter is at rest.
const WordBoard = (() => {
  const FONT_FAMILY = `"Fredoka", ui-rounded, "Arial Rounded MT Bold", sans-serif`;
  // Chunky like toy letters, with room left inside E, S and G.
  const WEIGHT = 650;
  // A carried letter is drawn this much larger, as if lifted off the table.
  const LIFT = 1.06;
  const SEAT_MS = 170;
  // How far around a letter a fingertip still picks it up.
  const GRAB_MARGIN = 14;
  // A letter let go off the table glides back on in this time.
  const PLACE_MS = 150;
  // From the last letter seating to the next word.
  const NEXT_WORD_MS = 3400;
  // How long without a letter seated before the next one is pointed out.
  const HINT_MS = 8000;
  const HINT_SHOW_MS = 2600;
  // Toy plastic: face and side.
  const COLORS = [
    ["#E9483B", "#A72C21"],
    ["#F6922B", "#B5601A"],
    ["#F5BE1F", "#B1830B"],
    ["#43AE4E", "#2A7832"],
    ["#2F86DE", "#1D5A9E"],
    ["#9257D0", "#623591"],
    ["#EE5C9E", "#AA376F"],
    ["#1EAAA0", "#13756E"],
  ];
  const TAU = Math.PI * 2;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const lerp = (a, b, t) => a + (b - a) * t;

  function seeded(seed) {
    return () => {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(values, random) {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function lighten(hex, amount) {
    const value = parseInt(hex.slice(1), 16);
    const channel = (shift) => Math.round(lerp((value >> shift) & 255, 255, amount));
    return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
  }

  function fontAt(size) {
    return `${WEIGHT} ${size}px ${FONT_FAMILY}`;
  }

  // Glyph ink boxes at a font size of 1, for word-game.js's layout.
  let measuring = null;
  const measured = new Map();
  function metricsFor(chars) {
    measuring ||= document.createElement("canvas").getContext("2d");
    measuring.font = fontAt(100);
    const result = {};
    chars.forEach((char) => {
      if (!measured.has(char)) {
        const box = measuring.measureText(char);
        measured.set(char, {
          left: box.actualBoundingBoxLeft / 100,
          right: box.actualBoundingBoxRight / 100,
          ascent: box.actualBoundingBoxAscent / 100,
          descent: box.actualBoundingBoxDescent / 100,
        });
      }
      result[char] = measured.get(char);
    });
    return result;
  }

  function prepare(context, density, scale, x, y, size) {
    context.setTransform(density * scale, 0, 0, density * scale, x * density, y * density);
    context.font = fontAt(size);
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.lineJoin = "round";
    context.lineCap = "round";
  }

  // Draws char with its ink box centered on (dx, dy), fattened by fat.
  function glyph(context, char, metric, size, dx = 0, dy = 0, fat = 0) {
    const x = dx - (metric.right - metric.left) * size / 2;
    const y = dy + (metric.ascent - metric.descent) * size / 2;
    context.fillText(char, x, y);
    if (fat > 0) {
      context.lineWidth = 2 * fat;
      context.strokeText(char, x, y);
    }
  }

  function blankCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    return canvas;
  }

  // One plastic letter, drawn once. "rest" lies on the table with its side
  // showing and a close shadow; "lifted" is a little larger with a soft
  // shadow further off; "seated" is only the face, sunk in its slot. The
  // canvas is placed so the glyph's ink center is at its parent's origin.
  function plasticCanvas(char, metric, size, color, look, density) {
    const fat = WordGame.FATTEN * size;
    const depth = WordGame.DEPTH * size;
    const scale = look === "lifted" ? LIFT : 1;
    const halfWidth = ((metric.left + metric.right) * size / 2 + fat) * scale;
    const halfHeight = ((metric.ascent + metric.descent) * size / 2 + fat) * scale;
    const shadow = {
      rest: { y: depth + 0.04 * size, blur: 0.06 * size, alpha: 0.3 },
      lifted: { y: 0.2 * size, blur: 0.16 * size, alpha: 0.22 },
    }[look];
    const side = look === "seated" ? 2 : (shadow.blur + 2) * scale;
    const below = look === "seated" ? 2 : (shadow.y + shadow.blur + 2) * scale;
    const cssWidth = 2 * (halfWidth + side);
    const cssHeight = 2 * halfHeight + side + below;
    const canvas = blankCanvas(Math.ceil(cssWidth * density), Math.ceil(cssHeight * density));
    canvas.className = `word-letter-${look}`;
    canvas.setAttribute("aria-hidden", "true");
    Object.assign(canvas.style, {
      width: `${canvas.width / density}px`,
      height: `${canvas.height / density}px`,
      left: `${-(halfWidth + side)}px`,
      top: `${-(halfHeight + side)}px`,
    });
    const x = halfWidth + side;
    const y = halfHeight + side;
    const [faceColor, sideColor] = color;
    const context = canvas.getContext("2d");
    prepare(context, density, scale, x, y, size);
    if (shadow) {
      // The side, stacked down under the face, casting the table shadow.
      context.fillStyle = sideColor;
      context.strokeStyle = sideColor;
      const steps = Math.max(2, Math.ceil(depth * density * scale));
      for (let k = steps; k >= 1; k -= 1) {
        if (k === steps) {
          context.shadowColor = `rgba(59, 53, 96, ${shadow.alpha})`;
          context.shadowBlur = shadow.blur * density * scale;
          context.shadowOffsetY = (shadow.y - depth) * density * scale;
        }
        glyph(context, char, metric, size, 0, depth * k / steps, fat);
        context.shadowColor = "transparent";
      }
    }
    // The face: a rounded-over rim and a sheen from above, on its own canvas
    // so the sheen lands only on the face.
    const face = blankCanvas(canvas.width, canvas.height);
    const faceContext = face.getContext("2d");
    prepare(faceContext, density, scale, x, y, size);
    faceContext.fillStyle = faceColor;
    faceContext.strokeStyle = faceColor;
    glyph(faceContext, char, metric, size, 0, 0, fat);
    faceContext.fillStyle = lighten(faceColor, 0.16);
    glyph(faceContext, char, metric, size, 0, -fat * 0.25);
    faceContext.globalCompositeOperation = "source-atop";
    const top = -halfHeight / scale;
    const sheen = faceContext.createLinearGradient(0, top, 0, -top);
    sheen.addColorStop(0, "rgba(255, 255, 255, 0.5)");
    sheen.addColorStop(0.3, "rgba(255, 255, 255, 0.12)");
    sheen.addColorStop(0.55, "rgba(255, 255, 255, 0)");
    sheen.addColorStop(1, "rgba(0, 0, 0, 0.1)");
    faceContext.fillStyle = sheen;
    faceContext.fillRect(-halfWidth * 2, top * 2, halfWidth * 4, -top * 4);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.drawImage(face, 0, 0);
    return canvas;
  }

  function plankPath(width, height) {
    const radius = clamp(height * 0.09, 14, 28);
    const path = new Path2D();
    path.moveTo(radius, 0);
    path.arcTo(width, 0, width, height, radius);
    path.arcTo(width, height, 0, height, radius);
    path.arcTo(0, height, 0, 0, radius);
    path.arcTo(0, 0, width, 0, radius);
    path.closePath();
    return path;
  }

  // Maple with long, wavy grain, the same plank for every word.
  function paintWood(context, width, height) {
    const random = seeded(11);
    const plank = plankPath(width, height);
    context.save();
    context.clip(plank);
    const base = context.createLinearGradient(0, 0, width, height);
    base.addColorStop(0, "#DFAA69");
    base.addColorStop(0.45, "#E9C089");
    base.addColorStop(1, "#DCA563");
    context.fillStyle = base;
    context.fillRect(0, 0, width, height);
    // Broad, soft bands first, then fine lines over them.
    for (let band = 0; band < 7; band += 1) {
      const y0 = random() * height;
      context.beginPath();
      for (let x = -20; x <= width + 20; x += 16) {
        context.lineTo(x, y0 + Math.sin(x * 0.006 + band) * height * 0.06);
      }
      context.strokeStyle = `rgba(196, 128, 62, ${0.06 + random() * 0.08})`;
      context.lineWidth = 6 + random() * 14;
      context.stroke();
    }
    const lines = Math.round(height / 3.2);
    for (let line = 0; line < lines; line += 1) {
      const y0 = random() * height;
      const wave = 1 + random() * 4;
      const length = 0.003 + random() * 0.008;
      const phase = random() * TAU;
      const ripple = random() * 1.6;
      context.beginPath();
      for (let x = -12; x <= width + 12; x += 10) {
        context.lineTo(x, y0 + Math.sin(x * length + phase) * wave + Math.sin(x * 0.045 + phase * 3) * ripple);
      }
      context.strokeStyle = `rgba(150, 90, 40, ${0.05 + random() * 0.14})`;
      context.lineWidth = 0.5 + random() * 1.6;
      context.stroke();
    }
    // A worn, lighter top edge and a darker bottom one.
    const edge = context.createLinearGradient(0, 0, 0, height);
    edge.addColorStop(0, "rgba(255, 244, 222, 0.75)");
    edge.addColorStop(0.5, "rgba(255, 244, 222, 0)");
    edge.addColorStop(0.5, "rgba(122, 70, 30, 0)");
    edge.addColorStop(1, "rgba(122, 70, 30, 0.5)");
    context.strokeStyle = edge;
    context.lineWidth = 6;
    context.stroke(plank);
    context.restore();
  }

  // A letter-shaped recess cut into the wood, deep enough for a plastic
  // letter: a dark floor, its upper walls in shadow and its lower lip
  // catching the light, all in the glyph's shape grown by the plastic's
  // thickness and a little clearance.
  function paintRecess(context, slot, metric, size, density, offsetX, offsetY) {
    const grow = (WordGame.FATTEN + WordGame.CLEARANCE) * size;
    const wall = 0.1 * size;
    const width = 2 * slot.hx + 4 * wall;
    const height = 2 * slot.hy + 4 * wall;
    const pixels = (value) => Math.ceil(value * density);
    const layer = () => {
      const canvas = blankCanvas(pixels(width), pixels(height));
      const layerContext = canvas.getContext("2d");
      prepare(layerContext, density, 1, width / 2, height / 2, size);
      return [canvas, layerContext];
    };
    const [hole, holeContext] = layer();
    holeContext.fillStyle = "#000";
    holeContext.strokeStyle = "#000";
    glyph(holeContext, slot.char, metric, size, 0, 0, grow);
    // Everything but the hole, to cast shadow and light into it.
    const [rim, rimContext] = layer();
    rimContext.setTransform(1, 0, 0, 1, 0, 0);
    rimContext.fillStyle = "#000";
    rimContext.fillRect(0, 0, rim.width, rim.height);
    rimContext.globalCompositeOperation = "destination-out";
    rimContext.drawImage(hole, 0, 0);
    const [pit, pitContext] = layer();
    pitContext.setTransform(1, 0, 0, 1, 0, 0);
    const floor = pitContext.createLinearGradient(0, 0, 0, pit.height);
    floor.addColorStop(0, "#8E5A2C");
    floor.addColorStop(1, "#A56D39");
    pitContext.fillStyle = floor;
    pitContext.fillRect(0, 0, pit.width, pit.height);
    pitContext.shadowColor = "rgba(58, 28, 8, 0.85)";
    pitContext.shadowBlur = wall * 0.7 * density;
    pitContext.shadowOffsetX = wall * 0.35 * density;
    pitContext.shadowOffsetY = wall * 0.75 * density;
    pitContext.drawImage(rim, 0, 0);
    pitContext.shadowColor = "rgba(255, 226, 180, 0.4)";
    pitContext.shadowBlur = wall * 0.3 * density;
    pitContext.shadowOffsetX = -wall * 0.15 * density;
    pitContext.shadowOffsetY = -wall * 0.3 * density;
    pitContext.drawImage(rim, 0, 0);
    pitContext.shadowColor = "transparent";
    pitContext.globalCompositeOperation = "destination-in";
    pitContext.drawImage(hole, 0, 0);
    // A darker cut edge around the hole, then the hole itself.
    const x = slot.x - offsetX;
    const y = slot.y - offsetY;
    context.save();
    context.font = fontAt(size);
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.lineJoin = "round";
    context.fillStyle = "rgba(120, 68, 28, 0.45)";
    context.strokeStyle = "rgba(120, 68, 28, 0.45)";
    glyph(context, slot.char, metric, size, x, y, grow + Math.max(1, 0.015 * size));
    context.drawImage(pit, x - width / 2, y - height / 2, pit.width / density, pit.height / density);
    context.restore();
  }

  // options: screen (the tab's section), words (from WordGame.wordsFrom),
  // band() (the grip band's width), dragSlop and touchLimits (as for puzzle
  // pieces), sound: { pickup, bump(volume), seat, miss }, celebrate(name)
  // (the chime and the name), preload(name), played() (counts as play for
  // screen time), reducedMotion().
  function create(options) {
    const { screen, words, band, dragSlop, touchLimits, sound, celebrate, preload, played, reducedMotion } = options;
    const random = options.random || Math.random;
    const boardCanvas = screen.querySelector(".words-board");
    const picture = screen.querySelector(".words-picture");
    const glow = screen.querySelector(".words-glow");
    const table = screen.querySelector(".words-table");
    const heading = screen.querySelector(".words-name");
    const deck = WordGame.createDeck(words, random);
    let upcoming = null;
    let round = null;
    let geometry = null;
    let metrics = null;
    let origin = { left: 0, top: 0, width: 0, height: 0 };
    // The screen size the board was last laid out for.
    let laidOut = { width: 0, height: 0 };
    let active = false;
    let frame = null;
    let lastFrame = 0;
    let lastBumpAt = 0;
    let finishTimer = null;
    let hintTimer = null;
    let hintEndTimer = null;
    let hinted = null;
    let fontsReady = null;
    // Fingers carrying letters, and contacts that might become carries.
    const drags = new Map();
    const candidates = new Map();

    function ready() {
      fontsReady ||= (document.fonts?.load(fontAt(100), "ABC") || Promise.resolve())
        .catch(() => {})
        .then(() => measured.clear());
      return fontsReady;
    }

    function local(clientX, clientY) {
      return { x: clientX - origin.left, y: clientY - origin.top };
    }

    function setLook(letter, look) {
      letter.look = look;
      letter.element.dataset.look = look;
      letter.art.style.rotate = look === "rest" ? `${letter.tilt}deg` : "0deg";
    }

    function writePosition(letter) {
      const { x, y } = letter.body;
      if (Math.abs(x - letter.shownX) < 0.01 && Math.abs(y - letter.shownY) < 0.01) return;
      letter.shownX = x;
      letter.shownY = y;
      letter.element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }

    function paintLetter(letter) {
      const density = Math.min(window.devicePixelRatio || 1, 2);
      const metric = metrics[letter.char];
      letter.art.replaceChildren(...["rest", "lifted", "seated"].map((look) =>
        plasticCanvas(letter.char, metric, geometry.font, letter.color, look, density)));
    }

    function paintBoard() {
      const density = Math.min(window.devicePixelRatio || 1, 2);
      const { board } = geometry;
      boardCanvas.width = Math.ceil(board.width * density);
      boardCanvas.height = Math.ceil(board.height * density);
      Object.assign(boardCanvas.style, {
        left: `${board.x}px`,
        top: `${board.y}px`,
        width: `${board.width}px`,
        height: `${board.height}px`,
        borderRadius: `${clamp(board.height * 0.09, 14, 28)}px`,
      });
      const context = boardCanvas.getContext("2d");
      context.setTransform(density, 0, 0, density, 0, 0);
      paintWood(context, board.width, board.height);
      geometry.slots.forEach((slot) => paintRecess(context, slot, metrics[slot.char], geometry.font, density, board.x, board.y));
      const { x, y, size } = geometry.picture;
      Object.assign(picture.style, { left: `${x}px`, top: `${y}px`, width: `${size}px`, height: `${size}px` });
    }

    // Lays the round out for the screen as it is now. A fresh round starts
    // with its letters in a scrambled list; otherwise seated letters follow
    // their slots and loose ones keep their places on the table, scaled.
    function arrange(fresh) {
      const rect = screen.getBoundingClientRect();
      origin = rect;
      if (!rect.width || !rect.height) return false;
      laidOut = { width: rect.width, height: rect.height };
      // A letter still gliding arrives first, with its click (and the
      // celebration, if it was the last).
      if (!fresh) {
        round.letters.forEach((letter) => {
          if (letter.slide) endSlide(letter);
        });
      }
      metrics = metricsFor(round.loose);
      const before = geometry;
      geometry = WordGame.layout({ width: rect.width, height: rect.height, band: band(), metrics, chars: round.chars, letters: round.loose });
      geometry.slots.forEach((slot, index) => { slot.filled = Boolean(round.slots[index]?.filled); });
      round.slots = geometry.slots;
      const start = fresh ? WordGame.scatter(round.loose, metrics, geometry, random, round.chars.length) : null;
      round.letters.forEach((letter) => {
        Object.assign(letter.body, WordGame.letterBody(metrics[letter.char], geometry.font));
        if (letter.slot) {
          letter.slot = round.slots[letter.slot.index];
          letter.body.x = letter.slot.x;
          letter.body.y = letter.slot.y;
        } else if (start) {
          const place = start.find((entry) => entry.index === letter.index);
          letter.body.x = place.x;
          letter.body.y = place.y;
          letter.tilt = place.tilt;
        } else if (before && letter.body.mode === "free") {
          const from = before.arena;
          const to = geometry.arena;
          letter.body.x = to.left + (letter.body.x - from.left) * (to.right - to.left) / Math.max(1, from.right - from.left);
          letter.body.y = to.top + (letter.body.y - from.top) * (to.bottom - to.top) / Math.max(1, from.bottom - from.top);
        }
        paintLetter(letter);
        setLook(letter, letter.look);
        letter.shownX = NaN;
        writePosition(letter);
      });
      paintBoard();
      wake();
      return true;
    }

    function createLetter(char, index, color) {
      const element = document.createElement("div");
      element.className = "word-letter";
      element.setAttribute("role", "img");
      element.setAttribute("aria-label", `Letter ${char}`);
      const art = document.createElement("div");
      art.className = "word-letter-art";
      element.append(art);
      return {
        char,
        index,
        color,
        element,
        art,
        look: "rest",
        tilt: 0,
        slot: null,
        slide: null,
        shownX: NaN,
        shownY: NaN,
        body: { x: 0, y: 0, hx: 1, hy: 1, r: 1, vx: 0, vy: 0, mode: "free", pause: 0 },
      };
    }

    // entry is for tests; rounds normally deal from the deck.
    function newRound(entry = upcoming || WordGame.nextWord(deck)) {
      clearTimeout(finishTimer);
      stopHint();
      cancelDrags();
      upcoming = WordGame.nextWord(deck);
      new Image().src = upcoming.image;
      preload(entry.name);
      // The word's letters, then a few that are not in it.
      const chars = [...entry.word];
      const loose = [...chars, ...WordGame.extraLetters(entry.word, random)];
      const colors = shuffle(COLORS, random);
      round = { entry, chars, loose, slots: [], letters: loose.map((char, index) => createLetter(char, index, colors[index % colors.length])), done: false };
      heading.textContent = `Spell ${entry.name}`;
      picture.src = entry.image;
      picture.style.filter = entry.hue ? `hue-rotate(${entry.hue}deg)` : "";
      table.replaceChildren(...round.letters.map((letter) => letter.element));
      geometry = null;
      if (!arrange(true)) return;
      if (!reducedMotion()) {
        round.letters.forEach((letter, index) => letter.art.animate(
          [{ transform: "scale(0.3)", opacity: 0 }, { transform: "none", opacity: 1 }],
          { duration: 280, delay: 120 + index * 70, easing: "cubic-bezier(0.3, 1.5, 0.5, 1)", fill: "backwards" },
        ));
        boardCanvas.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 240, easing: "ease-out" });
      }
      scheduleHint();
    }

    function wake() {
      if (!active || frame !== null) return;
      // A frame's time can be earlier than the touch that woke the motion,
      // so the first frame after waking takes a normal frame's step.
      lastFrame = null;
      frame = requestAnimationFrame(tick);
    }

    function heldPlace(drag) {
      const { body } = drag.letter;
      return {
        x: clamp(drag.x - drag.grabX, body.hx, origin.width - body.hx),
        y: clamp(drag.y - drag.grabY, body.hy, origin.height - body.hy),
      };
    }

    function tick(now) {
      frame = null;
      if (!active || !round || !geometry) return;
      const dt = lastFrame === null ? 1 / 60 : clamp((now - lastFrame) / 1000, 0.001, 0.05);
      lastFrame = now;
      const bodies = round.letters.map((letter) => letter.body);
      const targets = [...drags.values()].map((drag) => ({ body: drag.letter.body, ...heldPlace(drag) }));
      const events = WordGame.advance(bodies, dt, geometry.arena, targets);
      round.letters.forEach((letter) => {
        if (letter.slide) slideHome(letter, now);
      });
      knock(events, now);
      round.letters.forEach(writePosition);
      if (drags.size || round.letters.some((letter) => letter.slide) || WordGame.unsettled(bodies, geometry.arena)) {
        frame = requestAnimationFrame(tick);
      }
    }

    // Letters knocking together, louder the harder they hit.
    function knock(events, now) {
      if (!events.length || now - lastBumpAt < 55) return;
      const hardest = Math.max(...events.map((event) => event.speed));
      lastBumpAt = now;
      sound.bump(clamp(hardest / 2600, 0.025, 0.12));
    }

    // A letter gliding on its own, into its slot or back onto the table.
    function glide(letter, toX, toY, duration, then = {}) {
      const { body } = letter;
      letter.slide = { fromX: body.x, fromY: body.y, toX, toY, startedAt: performance.now(), duration: reducedMotion() ? 0 : duration, ...then };
      body.vx = 0;
      body.vy = 0;
    }

    function slideHome(letter, now) {
      const { slide, body } = letter;
      const t = slide.duration ? clamp((now - slide.startedAt) / slide.duration, 0, 1) : 1;
      const eased = 1 - (1 - t) ** 3;
      body.x = lerp(slide.fromX, slide.toX, eased);
      body.y = lerp(slide.fromY, slide.toY, eased);
      if (t >= 1) endSlide(letter);
    }

    function endSlide(letter, quiet = false) {
      if (letter.slot) {
        land(letter, quiet);
        return;
      }
      const { slide, body } = letter;
      letter.slide = null;
      body.x = slide.toX;
      body.y = slide.toY;
      body.mode = "free";
      body.pause = slide.pause || 0;
    }

    function land(letter, quiet = false) {
      letter.slide = null;
      letter.body.mode = "seated";
      letter.body.x = letter.slot.x;
      letter.body.y = letter.slot.y;
      setLook(letter, "seated");
      letter.element.classList.add("seated");
      writePosition(letter);
      if (!quiet) sound.seat();
      // Done when every recess is filled; the extra letters stay on the table.
      if (round.slots.every((slot) => slot.filled) && round.letters.every((other) => other.body.mode !== "seating")) finish(quiet);
    }

    function seat(letter, slot) {
      slot.filled = true;
      letter.slot = slot;
      const { body } = letter;
      body.mode = "seating";
      glide(letter, slot.x, slot.y, SEAT_MS);
      setLook(letter, "rest");
      letter.art.style.rotate = "0deg";
      scheduleHint();
    }

    function finish(quiet) {
      round.done = true;
      stopHint();
      candidates.clear();
      // Away from the tab, the next word waits for the return instead.
      if (active) {
        finishTimer = setTimeout(() => {
          if (active) newRound();
        }, NEXT_WORD_MS);
      }
      if (quiet) return;
      celebrate(round.entry.name);
      if (!reducedMotion()) {
        round.letters.filter((letter) => letter.slot).sort((a, b) => a.slot.index - b.slot.index).forEach((letter, index) => letter.art.animate(
          [
            { transform: "none" },
            { transform: `translateY(${-0.32 * geometry.font}px) rotate(${index % 2 ? 6 : -6}deg)`, offset: 0.4 },
            { transform: "none" },
          ],
          { duration: 460, delay: 200 + index * 120, easing: "ease-out" },
        ));
        picture.animate([
          { transform: "none" },
          { transform: "scale(1.12) rotate(-5deg)", offset: 0.3 },
          { transform: "scale(1.08) rotate(5deg)", offset: 0.6 },
          { transform: "none" },
        ], { duration: 900, delay: 300 + round.chars.length * 120, easing: "ease-in-out" });
      }
    }

    function under(letter, x, y, margin = GRAB_MARGIN) {
      const { body } = letter;
      return Math.abs(x - body.x) <= body.hx + margin && Math.abs(y - body.y) <= body.hy + margin;
    }

    function letterAt(x, y) {
      const margin = GRAB_MARGIN;
      const loose = round.letters.filter((letter) => letter.body.mode === "free" || letter.body.mode === "placing");
      // Later children are drawn on top.
      const order = [...table.children];
      const covering = loose.filter(({ body }) => Math.abs(x - body.x) <= body.hx && Math.abs(y - body.y) <= body.hy)
        .sort((a, b) => order.indexOf(b.element) - order.indexOf(a.element));
      if (covering.length) return covering[0];
      const near = loose.filter(({ body }) => Math.abs(x - body.x) <= body.hx + margin && Math.abs(y - body.y) <= body.hy + margin)
        .sort((a, b) => Math.hypot(x - a.body.x, y - a.body.y) - Math.hypot(x - b.body.x, y - b.body.y));
      return near[0] || null;
    }

    // A finger or mouse coming down. Returns whether it is on a letter.
    function pointerDown(event) {
      if (!active || !round || round.done || !geometry) return false;
      origin = screen.getBoundingClientRect();
      const point = local(event.clientX, event.clientY);
      const letter = letterAt(point.x, point.y);
      if (!letter) return false;
      event.preventDefault();
      // A finger on a sliding letter stops it, as on a real table.
      if (letter.body.mode === "free") {
        letter.body.vx = 0;
        letter.body.vy = 0;
      }
      const candidate = TouchIntent.beginCandidate(event, { letter });
      try { screen.setPointerCapture(event.pointerId); } catch (_) { /* Document listeners still follow it. */ }
      if (event.pointerType === "mouse") claim(candidate, event);
      else candidates.set(event.pointerId, candidate);
      return true;
    }

    // A contact owns a letter only once it moves like a drag, so a resting
    // palm or a still finger blocks nothing.
    function claim(candidate, event) {
      candidates.delete(event.pointerId);
      if (!active || round.done || drags.has(event.pointerId)) return;
      // The letter may have been knocked away from under a resting finger;
      // then the finger takes whatever letter it is on now, if any.
      let start = local(candidate.startX, candidate.startY);
      const now = local(event.clientX, event.clientY);
      let { letter } = candidate;
      if (!under(letter, start.x, start.y) && !under(letter, now.x, now.y)) {
        letter = letterAt(now.x, now.y);
        start = now;
      } else if (!under(letter, start.x, start.y)) start = now;
      if (!letter || (letter.body.mode !== "free" && letter.body.mode !== "placing")) return;
      candidates.forEach((other, pointerId) => {
        if (other.letter === letter) candidates.delete(pointerId);
      });
      // Caught while gliding back onto the table: it stays in the hand.
      letter.slide = null;
      drags.set(event.pointerId, {
        letter,
        grabX: start.x - letter.body.x,
        grabY: start.y - letter.body.y,
        x: start.x,
        y: start.y,
        startX: candidate.startX,
        startY: candidate.startY,
        samples: [],
        moved: event.pointerType === "touch",
        creditedAt: event.timeStamp,
      });
      const { body } = letter;
      body.mode = "held";
      body.vx = 0;
      body.vy = 0;
      body.pause = 0;
      letter.element.getAnimations?.({ subtree: true }).forEach((animation) => animation.cancel());
      setLook(letter, "lifted");
      letter.element.classList.add("held");
      table.append(letter.element);
      sound.pickup();
      if (event.pointerType === "touch") played();
      pointerMove(event);
    }

    function pointerMove(event) {
      const drag = drags.get(event.pointerId);
      if (!drag) {
        const candidate = candidates.get(event.pointerId);
        if (!candidate) return;
        TouchIntent.updateCandidate(candidate, event);
        if (candidate.maxDistance <= dragSlop) return;
        if (TouchIntent.looksLikeBroadContact(candidate, touchLimits)) {
          candidates.delete(event.pointerId);
          return;
        }
        claim(candidate, event);
        return;
      }
      const point = local(event.clientX, event.clientY);
      drag.x = point.x;
      drag.y = point.y;
      drag.samples.push({ x: point.x, y: point.y, t: event.timeStamp });
      while (drag.samples.length > 2 && event.timeStamp - drag.samples[0].t > 100) drag.samples.shift();
      if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > dragSlop) {
        drag.moved = true;
        drag.creditedAt = -Infinity;
      }
      // A long carry is play too, so it must not let the screen dim.
      if (drag.moved && event.timeStamp - drag.creditedAt >= 1000) {
        drag.creditedAt = event.timeStamp;
        played();
      }
      wake();
    }

    // The finger's speed as it let go, from its last tenth of a second. A
    // finger that stopped before lifting puts its letter down still.
    function releaseVelocity(drag, endedAt) {
      const samples = drag.samples;
      const last = samples.at(-1);
      if (!last || endedAt - last.t > 60 || samples.length < 2) return { x: 0, y: 0 };
      const first = samples[0];
      const seconds = Math.max(0.016, (last.t - first.t) / 1000);
      let x = (last.x - first.x) / seconds;
      let y = (last.y - first.y) / seconds;
      const speed = Math.hypot(x, y);
      if (speed > 1600) {
        x *= 1600 / speed;
        y *= 1600 / speed;
      }
      return { x, y };
    }

    function showMismatch(letter) {
      if (reducedMotion()) return;
      const reach = 0.07 * geometry.font;
      letter.art.animate([
        { transform: "none" },
        { transform: `translateX(${-reach}px)` },
        { transform: `translateX(${reach}px)` },
        { transform: `translateX(${-reach * 0.6}px)` },
        { transform: `translateX(${reach * 0.6}px)` },
        { transform: "none" },
      ], { duration: 360, easing: "ease-in-out" });
    }

    // Puts a carried letter down. Let go over its own empty slot, it slides
    // in with a click. Over another slot it shakes, then slides back to the
    // table, as does any letter let go over the board. On the table it
    // stays where it is let go, sliding on a little if it was thrown. Let go
    // past the table's sides or bottom, as in the grip band, it glides back
    // on rather than jumping.
    function drop(drag, released, endedAt) {
      const { letter } = drag;
      const { body } = letter;
      const place = heldPlace(drag);
      body.x = place.x;
      body.y = place.y;
      body.vx = 0;
      body.vy = 0;
      body.mode = "free";
      letter.element.classList.remove("held");
      let pause = 0;
      if (released && !round.done) {
        const slot = WordGame.seatFor(letter.char, body.x, body.y, round.slots);
        if (slot) {
          seat(letter, slot);
          wake();
          return;
        }
        if (WordGame.slotUnder(body.x, body.y, round.slots)) {
          pause = 0.3;
          sound.miss();
          showMismatch(letter);
        } else if (body.y - body.hy < geometry.arena.top) {
          pause = 0.12;
        } else {
          const thrown = releaseVelocity(drag, endedAt);
          body.vx = thrown.x;
          body.vy = thrown.y;
        }
      }
      const { arena } = geometry;
      const x = clamp(body.x, arena.left + body.hx, arena.right - body.hx);
      const y = Math.min(body.y, arena.bottom - body.hy);
      if (Math.abs(x - body.x) > 0.5 || Math.abs(y - body.y) > 0.5) {
        body.mode = "placing";
        glide(letter, x, y, PLACE_MS, { pause });
      } else body.pause = pause;
      letter.tilt = (random() * 2 - 1) * 7;
      setLook(letter, "rest");
      wake();
    }

    function pointerEnd(event) {
      candidates.delete(event.pointerId);
      const drag = drags.get(event.pointerId);
      if (!drag) return;
      drags.delete(event.pointerId);
      try {
        if (screen.hasPointerCapture(event.pointerId)) screen.releasePointerCapture(event.pointerId);
      } catch (_) { /* Already released. */ }
      const released = event.type === "pointerup";
      if (released) {
        const point = local(event.clientX, event.clientY);
        drag.x = point.x;
        drag.y = point.y;
      }
      drop(drag, released, event.timeStamp);
    }

    // Losing the screen's capture puts the letter down where it is.
    function lostCapture(event) {
      if (event.target !== screen) return;
      candidates.delete(event.pointerId);
      const drag = drags.get(event.pointerId);
      if (!drag) return;
      drags.delete(event.pointerId);
      drop(drag, false, event.timeStamp);
    }

    function cancelDrags() {
      candidates.clear();
      const held = [...drags];
      drags.clear();
      held.forEach(([pointerId, drag]) => {
        try {
          if (screen.hasPointerCapture(pointerId)) screen.releasePointerCapture(pointerId);
        } catch (_) { /* Already released. */ }
        drop(drag, false, performance.now());
      });
    }

    function stopHint() {
      clearTimeout(hintTimer);
      clearTimeout(hintEndTimer);
      hintTimer = null;
      glow.classList.remove("showing");
      hinted?.getAnimations().forEach((animation) => animation.cancel());
      hinted = null;
    }

    function scheduleHint() {
      clearTimeout(hintTimer);
      hintTimer = null;
      if (active && round && !round.done) hintTimer = setTimeout(showHint, HINT_MS);
    }

    // The first empty slot glows and a letter that fits it wiggles.
    function showHint() {
      if (!active || !round || round.done) return;
      scheduleHint();
      if (drags.size || round.letters.some((letter) => letter.slide)) return;
      const found = WordGame.hint(round.slots, round.letters.map((letter) => ({ letter, char: letter.char, mode: letter.body.mode, x: letter.body.x, y: letter.body.y })));
      if (!found) return;
      const { slot } = found;
      const reach = 0.12 * geometry.font;
      Object.assign(glow.style, {
        left: `${slot.x - slot.hx - reach}px`,
        top: `${slot.y - slot.hy - reach}px`,
        width: `${2 * (slot.hx + reach)}px`,
        height: `${2 * (slot.hy + reach)}px`,
      });
      glow.classList.add("showing");
      clearTimeout(hintEndTimer);
      hintEndTimer = setTimeout(() => glow.classList.remove("showing"), HINT_SHOW_MS);
      if (reducedMotion()) return;
      hinted = found.letter.letter.art;
      const rise = -0.08 * geometry.font;
      hinted.animate([
        { transform: "none" },
        { transform: `translateY(${rise}px) rotate(-12deg)`, offset: 0.2 },
        { transform: `translateY(${rise}px) rotate(10deg)`, offset: 0.45 },
        { transform: "rotate(-6deg)", offset: 0.7 },
        { transform: "none" },
      ], { duration: 900, iterations: 2, easing: "ease-in-out" });
    }

    function activate() {
      if (active) return;
      active = true;
      ready().then(() => {
        if (!active) return;
        if (!round || round.done) newRound();
        else {
          arrange(false);
          scheduleHint();
        }
      });
    }

    function deactivate() {
      if (!active) return;
      cancelDrags();
      active = false;
      cancelAnimationFrame(frame);
      frame = null;
      clearTimeout(finishTimer);
      stopHint();
      // A letter still gliding arrives at once, quietly.
      round?.letters.forEach((letter) => {
        if (letter.slide) endSlide(letter, true);
      });
    }

    // The screen changed size or turned.
    function resize() {
      if (!active || !round) return;
      const rect = screen.getBoundingClientRect();
      origin = rect;
      if (!geometry) {
        // The first layout found no room (a hidden or collapsed screen).
        arrange(true);
        return;
      }
      if (rect.width === laidOut.width && rect.height === laidOut.height) return;
      cancelDrags();
      arrange(false);
    }

    return {
      activate,
      deactivate,
      resize,
      pointerDown,
      pointerMove,
      pointerEnd,
      lostCapture,
      newRound,
      get active() { return active; },
      get ready() { return ready(); },
      debug: () => ({
        word: round?.entry.word,
        name: round?.entry.name,
        done: Boolean(round?.done),
        running: frame !== null,
        drags: drags.size,
        candidates: candidates.size,
        hint: glow.classList.contains("showing"),
        upcoming: upcoming?.word,
        geometry: geometry && {
          font: geometry.font,
          arrangement: geometry.arrangement,
          board: { ...geometry.board },
          picture: { ...geometry.picture },
          arena: { ...geometry.arena },
        },
        origin: { left: origin.left, top: origin.top, width: origin.width, height: origin.height },
        slots: round ? round.slots.map(({ index, char, x, y, hx, hy, filled }) => ({ index, char, x, y, hx, hy, filled })) : [],
        letters: round ? round.letters.map((letter) => ({
          index: letter.index,
          char: letter.char,
          extra: letter.index >= round.chars.length,
          look: letter.look,
          tilt: letter.tilt,
          slot: letter.slot?.index ?? null,
          ...letter.body,
        })) : [],
      }),
    };
  }

  return { create, metricsFor, COLORS };
})();
