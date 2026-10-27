"use strict";

// Hold duration for the parent escape hatch (✕). Applied to the button's
// CSS transition in init() so the visual fill always matches the trigger.
const HOLD_MS = 1200;
const TAP_SLOP_PX = 12;
const DRAG_SLOP_PX = 4;
const TAP_MAX_MS = 700;
const TAP_ARBITRATION_MS = 90;
const PLAYBACK_CHECK_MS = 250;
const PLAYBACK_BUFFER_MS = 30000;
const MAX_PLAYBACK_MS = 4 * 60 * 1000;
// CSS-pixel contact geometry is optional. These deliberately conservative
// limits reject only contacts much broader than a toddler fingertip.
const BROAD_CONTACT_MAJOR_PX = 70;
const BROAD_CONTACT_AREA_PX2 = 2800;
const SESSION_LIMIT_MS = 15 * 60 * 1000;
const DAILY_LIMIT_MS = 60 * 60 * 1000;
const FIRST_BREAK_MS = 3 * 60 * 60 * 1000;
const MAX_BREAK_MS = 3 * 60 * 60 * 1000;
const IDLE_DIM_MS = 45 * 1000;
const SCREEN_TIME_KEY = "animal-sounds-screen-time-v1";
const PUZZLE_GRID_SIZE = 3;
const PUZZLE_PIECE_COUNT = PUZZLE_GRID_SIZE ** 2;
const PUZZLE_SNAP_MS = 170;
// The completion chime has faded by then, and "You did it!" is showing.
const PUZZLE_NAME_DELAY_MS = 700;
// Picking up and putting down a loose piece, which lies smaller in the tray.
const PUZZLE_RESIZE_MS = 140;
// Space between the board and the screen's sides.
const PUZZLE_MARGIN = 8;
// The smallest loose piece the board gives up width for; a toddler's fingertip.
const PUZZLE_MIN_TRAY_PIECE = 48;
const SVG_NS = "http://www.w3.org/2000/svg";

// Loaded once at startup; each entry: { name, videoId, image, hue? }
let animals = [];
let dinosaurs = [];
let foods = [];
let robots = [];

const grid = document.getElementById("grid");
const overlay = document.getElementById("overlay");
const shield = document.getElementById("shield");
const loading = document.getElementById("loading");
const loadingImg = document.getElementById("loading-img");
const loadingName = document.getElementById("loading-name");
const closeBtn = document.getElementById("close-btn");
const timeLimit = document.getElementById("time-limit");
const timeLimitTitle = document.getElementById("time-limit-title");
const timeLimitMessage = document.getElementById("time-limit-message");
const idleDim = document.getElementById("idle-dim");
const dailyTimeValue = document.getElementById("daily-time-value");
const puzzleBoard = document.getElementById("puzzle-board");
const puzzleTray = document.getElementById("puzzle-tray");
const puzzleScreen = document.getElementById("puzzle-screen");
const puzzleName = document.getElementById("puzzle-name");
const puzzleSuccess = document.getElementById("puzzle-success");
const puzzleCuts = document.getElementById("puzzle-cuts");
const puzzleHueRotate = document.getElementById("puzzle-hue-rotate");
const pages = document.getElementById("pages");
const pageTabs = document.querySelectorAll("[data-page-target]");
const PAGE_SCREENS = { animals: "animal-screen", puzzle: "puzzle-screen", dinosaurs: "dinosaur-screen", foods: "food-screen", alphabet: "alphabet-screen", lessons: "lessons-screen" };
let playViewport = { width: 0, height: 0, rotation: 0 };

// Reuse the player for consecutive Sounds taps; release its iframe and
// buffers when leaving Sounds. Each selection keeps its own playback guards.
let player = null;
let playerReady = false;
let watchdog = null;
let activePlayback = null;

function localDay(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function freshScreenTime() {
  return { day: localDay(), dailyMs: 0, sessionMs: 0, breakCount: 0, lockedUntil: 0 };
}

function loadScreenTime() {
  try {
    const saved = JSON.parse(localStorage.getItem(SCREEN_TIME_KEY));
    if (saved?.day === localDay() && Number.isFinite(saved.dailyMs) && Number.isFinite(saved.sessionMs)) {
      return {
        day: saved.day,
        dailyMs: Math.max(0, saved.dailyMs),
        sessionMs: Math.max(0, saved.sessionMs),
        breakCount: Math.max(0, Math.floor(saved.breakCount || 0)),
        lockedUntil: Math.max(0, saved.lockedUntil || 0),
      };
    }
  } catch (_) {
    // A private-mode or malformed-storage failure should not break the app.
  }
  return freshScreenTime();
}

let screenTime = loadScreenTime();
let countingSince = null;
let lastInteractionAt = Date.now();
let puzzleDeck = null;
// This round's picture, and the next one, whose image loads in the meantime.
let currentPuzzle = null;
let upcomingPuzzle = null;
let puzzlePlaced = 0;
// Active drags keyed by pointer ID, so each finger can carry its own piece.
const puzzleDrags = new Map();
let puzzleDragFrame = null;
const puzzleDragCandidates = new Map();
const tileTapCandidates = new Map();
let pendingTileTaps = [];
let tileTapTimer = null;
let suppressTouchClicksUntil = 0;
let puzzleCompleting = false;
let puzzleSuccessTimer = null;
let audioContext = null;
const downPointers = new Set();
const wakePointers = new Set();
let wakingGesture = false;
let suppressWakeClick = false;

function saveScreenTime() {
  try {
    localStorage.setItem(SCREEN_TIME_KEY, JSON.stringify(screenTime));
  } catch (_) {
    // The limits still work for this open session when storage is unavailable.
  }
}

function startOfTomorrow() {
  const tomorrow = new Date();
  tomorrow.setHours(24, 0, 0, 0);
  return tomorrow.getTime();
}

function stopCounting(now = Date.now()) {
  if (countingSince === null) return;
  const elapsed = Math.max(0, now - countingSince);
  screenTime.dailyMs += elapsed;
  screenTime.sessionMs += elapsed;
  countingSince = null;
  saveScreenTime();
}

function startCounting(now = Date.now()) {
  if (!document.hidden && timeLimit.hidden && idleDim.hidden && countingSince === null) countingSince = now;
}

function showIdleDim(now = Date.now()) {
  stopCounting(now);
  cancelTileTaps();
  cancelPuzzleDrag();
  stopLesson();
  releaseMedia();
  audioContext?.suspend();
  idleDim.hidden = false;
}

function recordInteraction(now = Date.now()) {
  if (!timeLimit.hidden) return;
  lastInteractionAt = now;
  if (!idleDim.hidden) idleDim.hidden = true;
  startCounting(now);
}

function wakeIdleScreen(now = Date.now()) {
  lastInteractionAt = now;
  idleDim.hidden = true;
}

function consumeWakeEvent(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function safeEdge() {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--safe-edge")) || 0;
}

// Physical viewport coordinates. The grip band is equally wide on every side,
// so the counter-rotated puzzle surface shares the same band.
function inSafeArea(x, y) {
  const edge = safeEdge();
  return x < edge || y < edge || x >= window.innerWidth - edge || y >= window.innerHeight - edge;
}

function guardWakePointer(event) {
  const down = event.type === "pointerdown";
  // The band itself swallows touches on the pages. Above the dim layer it
  // must also keep a resting grip from waking the screen.
  if (down && inSafeArea(event.clientX, event.clientY)) return;
  const ended = event.type === "pointerup" || event.type === "pointercancel";
  if (down) {
    downPointers.add(event.pointerId);
    if (!wakingGesture) {
      // A fresh gesture is immediately usable, including a reused mouse ID.
      wakePointers.delete(event.pointerId);
      suppressWakeClick = false;
    }
  }
  if (!idleDim.hidden && event.type !== "pointercancel" && downPointers.has(event.pointerId)) {
    wakingGesture = true;
    wakePointers.clear();
    downPointers.forEach((pointerId) => wakePointers.add(pointerId));
    wakeIdleScreen();
  }
  if (wakingGesture && down) wakePointers.add(event.pointerId);
  if (wakingGesture) {
    suppressWakeClick = true;
    consumeWakeEvent(event);
    if (down) {
      // Keep releases aimed at a stable element after the dim layer hides,
      // even if a mouse or finger moves outside its original target.
      try { document.documentElement.setPointerCapture(event.pointerId); } catch (_) {}
    }
  }
  if (ended) {
    downPointers.delete(event.pointerId);
    if (!downPointers.size) wakingGesture = false;
  }
}

function guardWakeClick(event) {
  // Keyboard and assistive clicks report detail 0 and no real position.
  if (event.detail !== 0 && inSafeArea(event.clientX, event.clientY)) {
    consumeWakeEvent(event);
    return;
  }
  const dimmed = !idleDim.hidden;
  if (dimmed) wakeIdleScreen();
  if (dimmed || wakingGesture || wakePointers.has(event.pointerId)
    || (suppressWakeClick && event.detail !== 0)) {
    // WebViews can retarget a delayed compatibility click to a button behind
    // the removed layer. Keep its pointer ID blocked after all fingers lift.
    // Clicks without a pointer (keyboard/assistive tech) can wake the screen
    // too, and their next activation remains available.
    consumeWakeEvent(event);
  }
}

function releaseWakeGesture() {
  downPointers.clear();
  wakingGesture = false;
}

function stopPlaybackForLimit() {
  stopLesson();
  releaseMedia();
  audioContext?.suspend();
}

function formatRemaining(ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function renderDailyTime(now = Date.now()) {
  const activeMs = screenTime.dailyMs + (countingSince === null ? 0 : Math.max(0, now - countingSince));
  const totalSeconds = Math.floor(activeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const value = `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  if (dailyTimeValue.value !== value) dailyTimeValue.value = value;
}

function showLimit(now = Date.now()) {
  const dailyLock = screenTime.dailyMs >= DAILY_LIMIT_MS;
  timeLimitTitle.textContent = dailyLock ? "All done for today!" : "Time for a break!";
  timeLimitMessage.textContent = dailyLock
    ? "You have had a full hour of animal sounds. Come back tomorrow."
    : `Come back in ${formatRemaining(screenTime.lockedUntil - now)}.`;
  timeLimit.hidden = false;
  cancelTileTaps();
  cancelPuzzleDrag();
  stopPlaybackForLimit();
}

function lockForBreak(now = Date.now()) {
  stopCounting(now);
  if (screenTime.dailyMs >= DAILY_LIMIT_MS) {
    screenTime.dailyMs = DAILY_LIMIT_MS;
    screenTime.lockedUntil = startOfTomorrow();
  } else {
    screenTime.sessionMs = 0;
    screenTime.breakCount += 1;
    const duration = Math.min(FIRST_BREAK_MS * (2 ** (screenTime.breakCount - 1)), MAX_BREAK_MS);
    screenTime.lockedUntil = now + duration;
  }
  saveScreenTime();
  showLimit(now);
}

function updateScreenTime(now = Date.now()) {
  if (screenTime.day !== localDay()) {
    screenTime = freshScreenTime();
    countingSince = null;
    timeLimit.hidden = true;
    saveScreenTime();
  }

  if (screenTime.lockedUntil > now) {
    showLimit(now);
    return;
  }

  if (!timeLimit.hidden) {
    if (now >= screenTime.lockedUntil) {
      screenTime.lockedUntil = 0;
      timeLimit.hidden = true;
      saveScreenTime();
      showIdleDim(now);
    } else {
      showLimit(now);
    }
    return;
  }

  if (idleDim.hidden && now - lastInteractionAt >= IDLE_DIM_MS) {
    showIdleDim(now);
    return;
  }
  if (!idleDim.hidden) return;

  if (countingSince !== null) stopCounting(now);
  if (screenTime.dailyMs >= DAILY_LIMIT_MS || screenTime.sessionMs >= SESSION_LIMIT_MS) {
    lockForBreak(now);
  } else {
    startCounting(now);
  }
}

// The IFrame API script calls this global when ready.
const apiReady = new Promise((resolve) => {
  window.onYouTubeIframeAPIReady = resolve;
});

let youtubeApiLoaded = false;
function loadYouTubeApi() {
  if (youtubeApiLoaded) return;
  youtubeApiLoaded = true;
  const tag = document.createElement("script");
  tag.id = "youtube-api";
  tag.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(tag);
}

async function init() {
  closeBtn.style.transitionDuration = HOLD_MS + "ms";
  const [res, dinosaurResponse, foodResponse, robotResponse, alphabetResponse] = await Promise.all(
    ["animals.json", "dinosaurs.json", "foods.json", "robots.json", "alphabet.json"].map((path) => fetch(path)),
  );
  animals = await res.json();
  renderGrid();
  dinosaurs = await dinosaurResponse.json();
  renderGrid(dinosaurs, document.getElementById("dinosaur-grid"));
  foods = await foodResponse.json();
  renderGrid(foods, document.getElementById("food-grid"));
  robots = await robotResponse.json();
  renderAlphabet(await alphabetResponse.json());
  renderLessons();
  // The header's height, which the puzzle layout uses, settles with the font.
  document.fonts?.ready.then(positionPages);
  // A piece's box is its cell plus room for knobs on every side.
  puzzleScreen.style.setProperty("--piece-span", String((Jigsaw.SIZE + 2 * Jigsaw.PAD) / Jigsaw.SIZE));
  // Some animals have two videos; each still makes one puzzle.
  const puzzleAnimals = animals.filter((animal, index) => animals.findIndex((other) => other.name === animal.name) === index);
  puzzleDeck = PuzzleDeck.create({ animal: puzzleAnimals, dinosaur: dinosaurs, food: foods, robot: robots });
  showPage(document.body.dataset.page);
  showIdleDim();
  updateScreenTime();
  renderDailyTime();
  setInterval(() => {
    updateScreenTime();
    renderDailyTime();
  }, 1000);
}

function hueFilter(animal) {
  return animal.hue ? `hue-rotate(${animal.hue}deg)` : "";
}

const touchLimits = {
  maxDuration: TAP_MAX_MS,
  maxDistance: TAP_SLOP_PX,
  maxMajor: BROAD_CONTACT_MAJOR_PX,
  maxArea: BROAD_CONTACT_AREA_PX2,
};

function pointIsInside(element, x, y) {
  const rect = element.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function beginTileTap(event, tile, animal) {
  if (event.pointerType !== "touch") return;
  tileTapCandidates.set(event.pointerId, TouchIntent.beginCandidate(event, { tile, animal }));
}

function updateTileTap(event) {
  const candidate = tileTapCandidates.get(event.pointerId);
  if (candidate) TouchIntent.updateCandidate(candidate, event);
}

function cancelTileTaps() {
  clearTimeout(tileTapTimer);
  tileTapTimer = null;
  pendingTileTaps = [];
  tileTapCandidates.clear();
}

function commitBestTileTap() {
  tileTapTimer = null;
  const candidates = pendingTileTaps;
  pendingTileTaps = [];
  if (
    !candidates.length
    || !overlay.hidden
    || !timeLimit.hidden
    || !["animals", "dinosaurs", "foods", "alphabet", "lessons"].includes(document.body.dataset.page)
  ) return;

  const winner = candidates.sort(TouchIntent.compareTapCandidates)[0];
  // A completed intentional tap owns this interaction. Contacts already down
  // (resting palm, belly, or extra fingers) are discarded and cannot trigger
  // later when they lift; a fresh pointerdown is required for the next tap.
  tileTapCandidates.clear();
  recordInteraction();
  play(winner.animal);
}

function endTileTap(event) {
  const candidate = tileTapCandidates.get(event.pointerId);
  if (!candidate) return;
  tileTapCandidates.delete(event.pointerId);
  TouchIntent.updateCandidate(candidate, event);
  suppressTouchClicksUntil = Date.now() + 800;
  if (event.type !== "pointerup") return;
  if (!pointIsInside(candidate.tile, event.clientX, event.clientY)) return;
  if (!TouchIntent.isPlausibleTap(candidate, event.timeStamp, touchLimits)) return;

  // Keep native page scrolling intact by never canceling pointerdown/move.
  // This stationary pointerup is handled here, so its compatibility click is
  // suppressed by the click guard below.
  event.preventDefault();
  candidate.endedAt = event.timeStamp;
  pendingTileTaps.push(candidate);
  tileTapTimer ||= setTimeout(commitBestTileTap, TAP_ARBITRATION_MS);
}

function renderGrid(entries = animals, container = grid) {
  container.append(...entries.map((animal) => {
    const tile = document.createElement("button");
    tile.className = "tile";
    tile.type = "button";

    const img = document.createElement("img");
    img.loading = "lazy";
    img.decoding = "async";
    img.src = animal.image;
    img.alt = "";
    img.style.filter = hueFilter(animal);

    const label = document.createElement("span");
    label.className = animal.name.length > 16 ? "tile-name long-name" : "tile-name";
    label.textContent = animal.name;

    tile.append(img, label);
    bindTileInput(tile, animal);
    return tile;
  }));
}

function bindTileInput(tile, animal) {
  tile.addEventListener("pointerdown", (event) => beginTileTap(event, tile, animal));
  tile.addEventListener("click", (event) => {
    // Touch is resolved from its own pointer ID because browsers may omit a
    // synthetic click while another contact remains down. Preserve mouse,
    // keyboard, and assistive-technology activation.
    if (event.pointerType === "touch") return;
    if (event.detail !== 0 && Date.now() < suppressTouchClicksUntil) return;
    recordInteraction();
    play(animal);
  });
}

function renderAlphabet(groups) {
  const container = document.getElementById("alphabet-grid");
  container.append(...groups.map((group) => {
    const card = AlphabetCards.create(group);
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "tile alphabet-tile";
    const image = document.createElement("img");
    image.loading = "lazy";
    image.decoding = "async";
    image.alt = "";
    const label = document.createElement("span");
    label.className = "tile-name";
    tile.append(image, label);
    const update = () => {
      const item = card.items[card.index];
      image.src = item.image;
      label.textContent = `${card.letter}${card.letter.toLowerCase()} ${item.name}`;
      tile.setAttribute("aria-label", `${card.letter} is for ${item.name}`);
    };
    update();
    bindTileInput(tile, { kind: "alphabet", card, tile, update });
    return tile;
  }));
}

function playAlphabet(entry) {
  const { card, tile, update } = entry;
  const item = card.items[card.index];
  speak(`${card.spokenLetter} is for ${item.spokenName || item.name}`, {
    audioPath: item.audio,
    onEnd: () => {
      AlphabetCards.advance(card);
      update();
    },
    onStop: () => tile.classList.remove("speaking"),
  });
  tile.classList.add("speaking");
}

function shuffled(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapWith]] = [result[swapWith], result[index]];
  }
  return result;
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

// The whole puzzle picture in jigsaw units: its kind's backdrop, then the
// square picture. Dinosaurs use cutouts made by
// scripts/build-puzzle-dinosaurs.py instead of their tile artwork.
function puzzlePicture(item) {
  const size = Jigsaw.SIZE * PUZZLE_GRID_SIZE;
  const image = svgElement("image", { href: item.puzzleImage || item.image, width: size, height: size });
  if (item.hue) image.setAttribute("filter", "url(#puzzle-hue)");
  const picture = svgElement("g");
  picture.append(svgElement("use", { href: `#puzzle-scene-${item.kind || "animal"}` }), image);
  return picture;
}

// "Build a Horse!", "Build an Owl!", "Build some Rice!"
function puzzleTitle(item) {
  const article = item.article || (/^[aeiou]/i.test(item.name) ? "an" : "a");
  return `Build ${article} ${item.name}!`;
}

// Each piece shows only its own cut of the picture, so placed neighbors
// continue the image across their shared knobs.
function puzzlePieceArt(item, index, shape) {
  const { x, y, size } = Jigsaw.pieceBox(index % PUZZLE_GRID_SIZE, Math.floor(index / PUZZLE_GRID_SIZE));
  const art = svgElement("svg", { viewBox: `${x} ${y} ${size} ${size}`, "aria-hidden": "true" });
  const picture = puzzlePicture(item);
  picture.setAttribute("mask", `url(#puzzle-cut-${index})`);
  art.append(
    svgElement("path", { class: "piece-hit", d: shape }),
    picture,
    svgElement("path", { class: "piece-edge", d: shape }),
  );
  return art;
}

// The board shows a faint copy of the picture with every piece's outline.
function renderPuzzleBoard(item, shapes) {
  const size = Jigsaw.SIZE * PUZZLE_GRID_SIZE;
  const guide = svgElement("svg", { class: "puzzle-guide", viewBox: `0 0 ${size} ${size}`, "aria-hidden": "true" });
  const hint = puzzlePicture(item);
  hint.setAttribute("class", "puzzle-hint");
  guide.append(hint, ...shapes.map((shape, index) => svgElement("path", { class: "slot-edge", "data-index": index, d: shape })));
  const slots = shapes.map((_, index) => {
    const slot = document.createElement("div");
    slot.className = "puzzle-slot";
    slot.dataset.index = index;
    return slot;
  });
  puzzleBoard.replaceChildren(guide, ...slots);
}

function resetDraggedPiece(piece) {
  piece.classList.remove("drag-source");
  piece.removeAttribute("aria-grabbed");
}

function removeDragGhost(ghost) {
  ghost.remove();
}

function removeAllDragGhosts() {
  document.querySelectorAll(".puzzle-piece.dragging").forEach((ghost) => ghost.remove());
}

function cancelPuzzleDrag() {
  puzzleDragCandidates.clear();
  cancelAnimationFrame(puzzleDragFrame);
  puzzleDragFrame = null;
  const drags = [...puzzleDrags];
  puzzleDrags.clear();
  drags.forEach(([pointerId, drag]) => rollBackPuzzleDrag(drag, pointerId));
  removeAllDragGhosts();
}

function rollBackPuzzleDrag({ piece, ghost }, pointerId) {
  if (piece.hasPointerCapture(pointerId)) piece.releasePointerCapture(pointerId);
  removeDragGhost(ghost);
  resetDraggedPiece(piece);
}

// A wrong slot leaves the piece where it was released, with a short shake
// and a red glow that fades. Restarting the class replays it on every miss.
function showPuzzleMismatch(piece) {
  piece.classList.remove("mismatch");
  void piece.offsetWidth;
  piece.classList.add("mismatch");
}

function completePuzzle() {
  if (puzzleCompleting) return;
  puzzleCompleting = true;
  cancelPuzzleDrag();
  playSuccessChime();
  speakAfter(PUZZLE_NAME_DELAY_MS, currentPuzzle.name);
  puzzleScreen.classList.add("puzzle-complete");
  puzzleSuccess.hidden = false;
  puzzleSuccess.classList.remove("playing");
  requestAnimationFrame(() => puzzleSuccess.classList.add("playing"));
  clearTimeout(puzzleSuccessTimer);
  puzzleSuccessTimer = setTimeout(() => {
    puzzleSuccess.classList.remove("playing");
    puzzleSuccess.hidden = true;
    newPuzzle();
  }, 4200);
}

// from is where the dragged piece's box was released, in play coordinates.
// The piece slides the rest of the way into its spot with a click.
function placePuzzlePiece(piece, slot, from) {
  if (puzzleCompleting || piece.disabled || slot.classList.contains("filled")) return;
  resetDraggedPiece(piece);
  piece.classList.remove("dropped", "mismatch");
  ["left", "top", "width", "height"].forEach((property) => piece.style.removeProperty(property));
  slot.append(piece);
  slot.classList.add("filled");
  puzzleBoard.querySelector(`.slot-edge[data-index="${piece.dataset.index}"]`)?.classList.add("filled");
  piece.disabled = true;
  piece.classList.add("placed");
  piece.setAttribute("aria-label", "Piece in the right place");
  if (from && !reducedMotion()) {
    const to = puzzleRect(piece);
    piece.animate([
      { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(1.06)` },
      { transform: "none" },
    ], { duration: PUZZLE_SNAP_MS, easing: "cubic-bezier(0.2, 0.9, 0.3, 1.15)" });
  }
  playSnapSound();
  puzzlePlaced = puzzleBoard.querySelectorAll(".puzzle-slot.filled").length;
  if (puzzlePlaced === PUZZLE_PIECE_COUNT) completePuzzle();
}

function reducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || false;
}

// A seated piece's box, which is also the size a piece is carried at.
function seatedPieceSize() {
  const cell = puzzleRect(puzzleBoard.querySelector(".puzzle-slot")).width;
  return cell * (Jigsaw.SIZE + 2 * Jigsaw.PAD) / Jigsaw.SIZE;
}

// A loose piece goes back to its resting size with the same point of it under
// the finger, and shrinks there unless it is about to shake on a wrong spot.
function leavePuzzlePiece(piece, event, drag, animate) {
  const { offsetX, offsetY, size, rest } = drag;
  const screenRect = puzzleRect(puzzleScreen);
  const point = puzzlePoint(event.clientX, event.clientY);
  const grabX = offsetX * rest / size;
  const grabY = offsetY * rest / size;
  // Keep loose pieces fully clear of the grip band so they stay grabbable.
  const edge = safeEdge();
  const minLeft = Math.max(0, edge - screenRect.left);
  const minTop = Math.max(0, edge - screenRect.top);
  const maxLeft = Math.min(screenRect.width, playViewport.width - edge - screenRect.left) - rest;
  const maxTop = Math.min(screenRect.height, playViewport.height - edge - screenRect.top) - rest;
  const left = Math.min(Math.max(minLeft, point.x - grabX - screenRect.left), maxLeft);
  const top = Math.min(Math.max(minTop, point.y - grabY - screenRect.top), maxTop);
  resetDraggedPiece(piece);
  piece.classList.add("dropped");
  piece.style.left = `${left}px`;
  piece.style.top = `${top}px`;
  piece.style.width = `${rest}px`;
  piece.style.height = `${rest}px`;
  puzzleScreen.append(piece);
  if (animate && rest !== size && !reducedMotion()) {
    const transformOrigin = `${grabX}px ${grabY}px`;
    piece.animate([
      { transformOrigin, transform: `scale(${size / rest})` },
      { transformOrigin, transform: "none" },
    ], { duration: PUZZLE_RESIZE_MS, easing: "ease-out" });
  }
}

function movePuzzlePiece(event) {
  const drag = puzzleDrags.get(event.pointerId);
  if (!drag) {
    const candidate = puzzleDragCandidates.get(event.pointerId);
    if (!candidate) return;
    TouchIntent.updateCandidate(candidate, event);
    if (candidate.maxDistance <= DRAG_SLOP_PX) return;
    if (TouchIntent.looksLikeBroadContact(candidate, touchLimits)) {
      puzzleDragCandidates.delete(event.pointerId);
      return;
    }
    claimPuzzleDrag(candidate, event);
    return;
  }
  const { offsetX, offsetY, startX, startY } = drag;
  if (!drag.moved && Math.hypot(event.clientX - startX, event.clientY - startY) > DRAG_SLOP_PX) {
    drag.moved = true;
    recordInteraction();
  }
  const point = puzzlePoint(event.clientX, event.clientY);
  drag.x = point.x - offsetX;
  drag.y = point.y - offsetY;
  if (puzzleDragFrame === null) puzzleDragFrame = requestAnimationFrame(paintPuzzleDrags);
}

function positionDragGhost(drag) {
  drag.ghost.style.transform = `translate3d(${drag.x}px, ${drag.y}px, 0) scale(1.06)`;
}

// All fingers share one frame callback and use their newest coordinates.
function paintPuzzleDrags() {
  puzzleDragFrame = null;
  puzzleDrags.forEach(positionDragGhost);
}

// A piece lands where its own center is (in play coordinates), not where the
// finger is, so a piece carried by a knob still fits the spot it is shown over.
function puzzleSlotAt(x, y) {
  return [...puzzleBoard.querySelectorAll(".puzzle-slot")].find((slot) => {
    const rect = puzzleRect(slot);
    return x >= rect.left && x < rect.left + rect.width && y >= rect.top && y < rect.top + rect.height;
  }) || null;
}

function endPuzzleDrag(event) {
  puzzleDragCandidates.delete(event.pointerId);
  const drag = puzzleDrags.get(event.pointerId);
  if (!drag) return;
  puzzleDrags.delete(event.pointerId);
  if (!puzzleDrags.size) {
    cancelAnimationFrame(puzzleDragFrame);
    puzzleDragFrame = null;
  }
  const { piece, ghost, offsetX, offsetY, size } = drag;
  if (piece.hasPointerCapture(event.pointerId)) piece.releasePointerCapture(event.pointerId);
  const point = puzzlePoint(event.clientX, event.clientY);
  const released = { left: point.x - offsetX, top: point.y - offsetY };
  const slot = puzzleSlotAt(released.left + size / 2, released.top + size / 2);
  removeDragGhost(ghost);
  if (event.type === "pointerup" && slot && Number(slot.dataset.index) === Number(piece.dataset.index)) {
    placePuzzlePiece(piece, slot, released);
  } else if (event.type === "pointerup") {
    leavePuzzlePiece(piece, event, drag, !slot);
    if (slot) showPuzzleMismatch(piece);
  } else {
    resetDraggedPiece(piece);
  }
}

function claimPuzzleDrag(candidate, event) {
  const { piece } = candidate;
  puzzleDragCandidates.delete(event.pointerId);
  if (puzzleDrags.has(event.pointerId) || piece.classList.contains("drag-source")
    || piece.disabled || puzzleCompleting) return;
  // Other contacts resting on this piece give it up; contacts on other
  // pieces stay free to start their own drags.
  puzzleDragCandidates.forEach((other, pointerId) => {
    if (other.piece === piece) puzzleDragCandidates.delete(pointerId);
  });
  // The piece is carried at its real size, growing around the finger so the
  // same point of it stays under the fingertip.
  const rect = candidate.rect;
  const size = seatedPieceSize();
  const grow = size / rect.width;
  const start = puzzlePoint(candidate.startX, candidate.startY);
  const offsetX = (start.x - rect.left) * grow;
  const offsetY = (start.y - rect.top) * grow;
  const ghost = piece.cloneNode(true);
  ghost.className = "puzzle-piece dragging";
  ghost.setAttribute("aria-hidden", "true");
  ghost.style.cssText = piece.style.cssText;
  ghost.style.removeProperty("left");
  ghost.style.removeProperty("top");
  ghost.style.width = `${size}px`;
  ghost.style.height = `${size}px`;
  ghost.style.transformOrigin = `${offsetX}px ${offsetY}px`;
  const point = puzzlePoint(event.clientX, event.clientY);
  const drag = {
    piece,
    ghost,
    startX: candidate.startX,
    startY: candidate.startY,
    offsetX,
    offsetY,
    size,
    rest: rect.width,
    moved: event.pointerType === "touch",
    x: point.x - offsetX,
    y: point.y - offsetY,
  };
  puzzleDrags.set(event.pointerId, drag);
  positionDragGhost(drag);
  document.body.append(ghost);
  // Animate the art's growth so it never overrides the ghost's translation.
  if (grow !== 1 && !reducedMotion()) {
    const art = ghost.firstElementChild;
    art.style.transformOrigin = `${offsetX}px ${offsetY}px`;
    art.animate([{ transform: `scale(${1 / (grow * 1.06)})` }, { transform: "none" }],
      { duration: PUZZLE_RESIZE_MS, easing: "ease-out" });
  }
  piece.setPointerCapture(event.pointerId);
  piece.classList.remove("mismatch");
  piece.classList.add("drag-source");
  piece.setAttribute("aria-grabbed", "true");
  if (event.pointerType === "touch") recordInteraction();
  movePuzzlePiece(event);
}

function beginPuzzleDrag(event) {
  if (event.pointerType !== "touch" && event.pointerType !== "mouse") return;
  if (event.button !== 0 || document.body.dataset.page !== "puzzle" || !idleDim.hidden || !timeLimit.hidden) return;
  const piece = event.currentTarget;
  if (piece.disabled || puzzleCompleting) return;
  event.preventDefault();
  // Another finger already carries this piece and keeps it.
  if (piece.classList.contains("drag-source")) return;

  const candidate = TouchIntent.beginCandidate(event, {
    piece,
    rect: puzzleRect(piece),
  });
  if (event.pointerType === "mouse") claimPuzzleDrag(candidate, event);
  else puzzleDragCandidates.set(event.pointerId, candidate);
}

function createPuzzlePiece(item, index, shape) {
  const piece = document.createElement("button");
  piece.type = "button";
  piece.className = "puzzle-piece";
  piece.dataset.index = index;
  piece.setAttribute("aria-label", "Puzzle piece");
  piece.append(puzzlePieceArt(item, index, shape));
  piece.addEventListener("pointerdown", beginPuzzleDrag);
  piece.addEventListener("animationend", (event) => {
    if (event.animationName === "puzzle-mismatch-glow") piece.classList.remove("mismatch");
  });
  return piece;
}

// picture is for tests; rounds normally deal from the deck.
function newPuzzle(picture = upcomingPuzzle || PuzzleDeck.next(puzzleDeck)) {
  cancelPuzzleDrag();
  clearTimeout(puzzleSuccessTimer);
  puzzleCompleting = false;
  puzzleScreen.classList.remove("puzzle-complete");
  puzzleSuccess.classList.remove("playing");
  puzzleSuccess.hidden = true;
  currentPuzzle = picture;
  // Load the next picture and this one's name while the child plays.
  upcomingPuzzle = PuzzleDeck.next(puzzleDeck);
  new Image().src = upcomingPuzzle.puzzleImage || upcomingPuzzle.image;
  voiceClip(voicePath(currentPuzzle.name)).preload = "auto";
  puzzlePlaced = 0;
  puzzleScreen.querySelectorAll(".puzzle-piece.dropped").forEach((piece) => piece.remove());
  puzzleName.textContent = puzzleTitle(currentPuzzle);
  // Fresh cuts every round, so the same picture comes apart differently.
  const cuts = Jigsaw.createCuts(PUZZLE_GRID_SIZE, PUZZLE_GRID_SIZE);
  const shapes = [...Array(PUZZLE_PIECE_COUNT).keys()].map((index) =>
    Jigsaw.piecePath(cuts, index % PUZZLE_GRID_SIZE, Math.floor(index / PUZZLE_GRID_SIZE)));
  // Masks rather than clip paths: the stroke lets each piece reach just past
  // its cut, under its neighbor, so pixel snapping can never open a gap.
  puzzleCuts.replaceChildren(...shapes.map((shape, index) => {
    const { x, y, size } = Jigsaw.pieceBox(index % PUZZLE_GRID_SIZE, Math.floor(index / PUZZLE_GRID_SIZE));
    const mask = svgElement("mask", { id: `puzzle-cut-${index}`, maskUnits: "userSpaceOnUse", x, y, width: size, height: size });
    mask.append(svgElement("path", { class: "cut-mask", d: shape }));
    return mask;
  }));
  puzzleHueRotate.setAttribute("values", String(currentPuzzle.hue || 0));
  renderPuzzleBoard(currentPuzzle, shapes);
  puzzleTray.replaceChildren(...shuffled([...shapes.keys()])
    .map((index) => createPuzzlePiece(currentPuzzle, index, shapes[index])));
  if (document.body.dataset.page === "puzzle") positionPages();
}

function puzzleAudio() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  audioContext ||= new AudioContext();
  audioContext.resume?.();
  return audioContext;
}

// A short, quiet wooden click as a piece seats itself.
function playSnapSound() {
  if (!puzzleAudio()) return;
  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(900, now);
  oscillator.frequency.exponentialRampToValueAtTime(420, now + 0.06);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.12, now + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.1);
}

function playSuccessChime() {
  if (!puzzleAudio()) return;
  const now = audioContext.currentTime;
  [523.25, 659.25, 783.99].forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const start = now + index * 0.13;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.16, start + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.58);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.6);
  });
}

function showPage(page) {
  if (!PAGE_SCREENS[page]) return;
  const changed = document.body.dataset.page !== page;
  cancelTileTaps();
  if (page !== "puzzle") cancelPuzzleDrag();
  document.body.dataset.page = page;
  document.querySelectorAll(".app-screen").forEach((screen) => {
    screen.hidden = screen.id !== PAGE_SCREENS[page];
    screen.inert = screen.hidden;
  });
  if (changed) {
    stopLesson();
    releaseMedia();
    window.scrollTo(0, 0);
    // Installed browsers may support a native lock. FreeKiosk's WebView does
    // not, so the portrait play surface below also works without this API.
    try {
      if (page === "puzzle") window.screen?.orientation?.lock?.("portrait")?.catch(() => {});
      else window.screen?.orientation?.unlock?.();
    } catch (_) { /* The portrait surface remains available. */ }
  }
  if (page === "puzzle" && puzzleDeck && (!currentPuzzle || puzzleCompleting)) newPuzzle();
  if (page !== "puzzle") {
    clearTimeout(puzzleSuccessTimer);
    puzzleScreen.classList.remove("puzzle-complete");
    puzzleSuccess.classList.remove("playing");
    puzzleSuccess.hidden = true;
    audioContext?.suspend();
  }
  positionPages();
  pageTabs.forEach((tab) => {
    tab.setAttribute("aria-pressed", String(tab.dataset.pageTarget === page));
  });
}

function positionPages() {
  const puzzle = document.body.dataset.page === "puzzle";
  const landscape = window.innerWidth > window.innerHeight;
  const orientation = window.screen?.orientation;
  const reverse = orientation?.type === "landscape-secondary"
    || (!orientation?.type && window.orientation === -90);
  const rotation = puzzle && landscape ? (reverse ? -90 : 90) : 0;
  const width = rotation ? window.innerHeight : window.innerWidth;
  const height = rotation ? window.innerWidth : window.innerHeight;
  if (rotation !== playViewport.rotation || width !== playViewport.width || height !== playViewport.height) {
    cancelPuzzleDrag();
  }
  playViewport = { width, height, rotation };
  document.body.dataset.portraitRotation = String(rotation);
  document.body.style.setProperty("--play-width", `${width}px`);
  document.body.style.setProperty("--play-height", `${height}px`);
  if (puzzle && currentPuzzle) layoutPuzzle(document.querySelector(".topbar").offsetHeight);
}

// The board spans the portrait play surface less a small margin, and the tray
// of loose pieces takes the height that is left above the bottom grip band.
// Spacing comes from the stylesheet, so this follows any change there.
function layoutPuzzle(headerHeight) {
  const frame = parseFloat(getComputedStyle(puzzleBoard).borderLeftWidth) || 0;
  const tray = getComputedStyle(puzzleTray);
  const boardTop = headerHeight + puzzleBoard.offsetTop;
  const between = puzzleTray.offsetTop - puzzleBoard.offsetTop - puzzleBoard.offsetHeight;
  const fit = Jigsaw.fitLayout({
    width: playViewport.width,
    height: playViewport.height - safeEdge() - boardTop - between,
    grid: PUZZLE_GRID_SIZE,
    margin: PUZZLE_MARGIN,
    band: safeEdge(),
    frame,
    gap: parseFloat(tray.columnGap) || 0,
    padding: parseFloat(tray.paddingLeft) || 0,
    minPiece: PUZZLE_MIN_TRAY_PIECE,
  });
  // Seated pieces reach about 1.5 px past their cuts, under their neighbors.
  const cell = (fit.board - 2 * frame) / PUZZLE_GRID_SIZE;
  puzzleScreen.style.setProperty("--cut-bleed", String(3 * Jigsaw.SIZE / cell));
  puzzleScreen.style.setProperty("--board-size", `${fit.board}px`);
  puzzleScreen.style.setProperty("--tray-piece", `${fit.piece}px`);
  puzzleScreen.style.setProperty("--tray-columns", String(fit.columns));
}

// Pointer events and hit testing use the physical viewport. Drag ghosts and
// loose pieces use the portrait body's coordinates, including in WebViews
// that cannot prevent Android from rotating the window itself.
function puzzlePoint(x, y) {
  if (playViewport.rotation === 90) return { x: y, y: window.innerWidth - x };
  if (playViewport.rotation === -90) return { x: window.innerHeight - y, y: x };
  return { x, y };
}

function puzzleRect(element) {
  const rect = element.getBoundingClientRect();
  const start = puzzlePoint(rect.left, rect.top);
  const end = puzzlePoint(rect.right, rect.bottom);
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

// Recordings of Randy saying each animal's name, e.g. audio/guinea-pig.mp3,
// cached in a small LRU so long kiosk sessions cannot retain every recording.
const VOICE_CACHE_LIMIT = 4;
const voiceClips = new Map();
let currentClip = null;
let speechRequest = 0;
let speechCleanup = null;
let speechTimer = null;
let currentUtterance = null;

function stopFallbackSpeech() {
  // Avoid starting Android's speech service when recordings suffice.
  if (!currentUtterance) return;
  currentUtterance = null;
  try { speechSynthesis.cancel(); } catch (_) {}
}

function releaseClip(clip) {
  clip.pause();
  clip.onended = null;
  clip.removeAttribute("src");
  clip.load();
}

function releaseMedia() {
  stopSpeech();
  closePlayer();
  const oldPlayer = player;
  player = null;
  playerReady = false;
  try { oldPlayer?.destroy(); } catch (_) {}
  if (document.getElementById("yt-slot")?.tagName !== "DIV") {
    const slot = document.createElement("div");
    slot.id = "yt-slot";
    document.querySelector(".player-frame").replaceChildren(slot);
  }
  currentClip = null;
  voiceClips.forEach(releaseClip);
  voiceClips.clear();
}

function stopSpeech() {
  clearTimeout(speechTimer);
  speechRequest += 1;
  if (currentClip) {
    currentClip.pause();
    currentClip.onended = null;
  }
  speechCleanup?.();
  speechCleanup = null;
  stopFallbackSpeech();
}

function voicePath(name) {
  return `audio/${name.toLowerCase().replace(/\s+/g, "-")}.mp3`;
}

function voiceClip(source) {
  let clip = voiceClips.get(source);
  if (!clip) {
    clip = new Audio(source);
  }
  voiceClips.delete(source);
  voiceClips.set(source, clip);
  if (voiceClips.size > VOICE_CACHE_LIMIT) {
    const [oldestSource, oldestClip] = voiceClips.entries().next().value;
    voiceClips.delete(oldestSource);
    releaseClip(oldestClip);
  }
  return clip;
}

function speak(name, { audioPath, onEnd, onStop } = {}) {
  stopSpeech();
  const request = speechRequest;
  speechCleanup = onStop || null;
  let finished = false;
  const finish = () => {
    if (request !== speechRequest || finished) return;
    finished = true;
    speechCleanup?.();
    speechCleanup = null;
    onEnd?.();
  };
  const fail = () => {
    if (request !== speechRequest || finished) return;
    finished = true;
    speechCleanup?.();
    speechCleanup = null;
  };
  const clip = voiceClip(audioPath || voicePath(name));
  currentClip = clip;
  clip.currentTime = 0;
  clip.onended = finish;
  clip.play()?.catch(() => {
    if (request === speechRequest) speakFallback(name, finish, fail);
  });
}

// Waits for a celebration sound first. Anything that stops speech before then,
// such as leaving the page or a screen-time lock, cancels the name too.
function speakAfter(delay, name) {
  stopSpeech();
  speechTimer = setTimeout(() => speak(name), delay);
}

function speakFallback(name, onEnd, onError) {
  try {
    stopFallbackSpeech();
    const utterance = new SpeechSynthesisUtterance(name);
    utterance.lang = "en-US";
    utterance.rate = 0.9;
    currentUtterance = utterance;
    const finish = (callback) => {
      if (currentUtterance !== utterance) return;
      currentUtterance = null;
      callback?.();
    };
    utterance.onend = () => finish(onEnd);
    utterance.onerror = () => finish(onError);
    speechSynthesis.speak(utterance);
  } catch (_) {
    currentUtterance = null;
    onError?.();
    // Keep the current card when neither recording nor speech is available.
  }
}

let activeLesson = null;
let lessonAnimation = null;

function renderLessons() {
  const container = document.getElementById("lesson-grid");
  container.append(...LessonScenes.lessons.map(lesson => {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "tile";
    const scene = document.createElement("span");
    scene.className = "lesson-art";
    scene.setAttribute("aria-hidden", "true");
    scene.innerHTML = LessonScenes.markup(lesson.id);
    const label = document.createElement("span");
    label.className = "tile-name";
    label.textContent = lesson.name;
    tile.append(scene, label);
    bindTileInput(tile, { ...lesson, scene });
    return tile;
  }));
}

function stopLesson() {
  if (lessonAnimation !== null) cancelAnimationFrame(lessonAnimation);
  lessonAnimation = null;
  if (activeLesson) {
    stopSpeech();
    activeLesson.scene.innerHTML = LessonScenes.markup(activeLesson.id);
  }
  activeLesson = null;
}

function playLesson(lesson) {
  stopLesson();
  activeLesson = lesson;
  speak(lesson.name, { audioPath: lesson.audio });
  const lessonClip = currentClip;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || false;
  const started = performance.now();
  const update = (now) => {
    if (activeLesson !== lesson) return;
    const elapsed = lessonClip === currentClip && lessonClip.readyState >= 2 && !lessonClip.error && (!lessonClip.paused || lessonClip.ended)
      ? (lessonClip.ended ? lesson.duration : lessonClip.currentTime) : (now - started) / 1000;
    const state = LessonScenes.frame(lesson.id, Math.min(lesson.duration, elapsed), reduced);
    LessonScenes.paint(lesson.scene, lesson.id, state);
    lessonAnimation = state.done ? null : requestAnimationFrame(update);
  };
  update(started);
}

async function play(animal) {
  if (!overlay.hidden || !timeLimit.hidden) return;
  if (animal.kind === "lesson") {
    playLesson(animal);
    return;
  }
  if (animal.kind === "alphabet") {
    playAlphabet(animal);
    return;
  }
  if (animal.kind === "dinosaur" || animal.kind === "food") {
    speak(animal.name);
    return;
  }

  const playback = { videoId: animal.videoId, started: false, lastTime: 0, duration: 0 };
  activePlayback = playback;
  loadingImg.src = animal.image;
  loadingImg.style.filter = hueFilter(animal);
  loadingName.textContent = animal.name;
  loading.hidden = false;
  overlay.hidden = false;

  speak(animal.name);

  // If the video never reaches PLAYING (embed blocked, network down,
  // endless ad weirdness), bail back to the grid.
  armWatchdog(20000);
  // These guards survive repeated PLAYING/BUFFERING events. Shorts must
  // return to the grid even when YouTube loops without sending ENDED.
  playback.limit = setTimeout(closePlayer, MAX_PLAYBACK_MS);
  playback.check = setInterval(checkPlayback, PLAYBACK_CHECK_MS);

  loadYouTubeApi();
  await apiReady;
  if (activePlayback !== playback) return; // closed or replaced while loading

  if (player) {
    if (playerReady) {
      player.setLoop(false);
      player.loadVideoById(animal.videoId);
    }
    return;
  }

  player = new YT.Player("yt-slot", {
    videoId: animal.videoId,
    playerVars: {
      autoplay: 1,
      loop: 0,
      playsinline: 1,
      controls: 0,
      disablekb: 1,
      fs: 0,
      rel: 0,
      iv_load_policy: 3,
    },
    events: {
      onReady: (e) => {
        if (player !== e.target) {
          try { e.target.stopVideo(); } catch (_) {}
          return;
        }
        playerReady = true;
        e.target.setLoop(false);
        if (!activePlayback) {
          e.target.stopVideo();
        } else if (activePlayback === playback) {
          e.target.playVideo();
        } else {
          e.target.loadVideoById(activePlayback.videoId);
        }
      },
      onStateChange: (e) => {
        if (player !== e.target) return;
        if (!activePlayback) {
          if (e.data === YT.PlayerState.PLAYING) {
            try { e.target.stopVideo(); } catch (_) {}
          }
          return;
        }
        if (e.data === YT.PlayerState.PLAYING) {
          activePlayback.started = true;
          clearTimeout(watchdog);
          loading.hidden = true;
          checkPlayback();
        } else if (e.data === YT.PlayerState.BUFFERING) {
          armWatchdog(PLAYBACK_BUFFER_MS);
        } else if (e.data === YT.PlayerState.ENDED) {
          if (activePlayback.started) closePlayer();
        }
      },
      onError: (e) => { if (player === e.target) closePlayer(); },
    },
  });
}

function checkPlayback() {
  const playback = activePlayback;
  if (!playback?.started || !playerReady) return;

  let state, currentTime, duration;
  try {
    state = player.getPlayerState();
    currentTime = player.getCurrentTime();
    duration = player.getDuration();
  } catch (_) {
    // The fixed maximum still closes playback if the iframe stops responding.
    return;
  }

  if (state === YT.PlayerState.ENDED) {
    closePlayer();
    return;
  }
  if (state !== YT.PlayerState.PLAYING) return;

  // Metadata can arrive after PLAYING. Set this deadline once per selection;
  // restarting the short must never grant it another full playback window.
  if (!playback.duration && Number.isFinite(duration) && duration > 0) {
    playback.duration = duration;
    playback.deadline = setTimeout(closePlayer, duration * 1000 + PLAYBACK_BUFFER_MS);
  }
  if (!Number.isFinite(currentTime) || currentTime < 0) return;
  if (
    (playback.duration > 0 && currentTime >= playback.duration)
    // The shield prevents seeking. A substantial backwards jump is a replay,
    // while small timestamp corrections during buffering are harmless.
    || currentTime + 1 < playback.lastTime
  ) {
    closePlayer();
    return;
  }
  playback.lastTime = currentTime;
}

function armWatchdog(ms) {
  clearTimeout(watchdog);
  watchdog = setTimeout(closePlayer, ms);
}

function closePlayer() {
  // Stop events can arrive synchronously. Invalidate this selection first so
  // they cannot re-enter closePlayer or revive a canceled API request.
  overlay.hidden = true;
  const playback = activePlayback;
  activePlayback = null;
  loading.hidden = true;
  clearTimeout(watchdog);
  clearTimeout(playback?.limit);
  clearTimeout(playback?.deadline);
  clearInterval(playback?.check);
  if (player) {
    try { player.stopVideo(); } catch (_) { /* not ready yet */ }
  }
  stopSpeech();
}

// Parent escape hatch: the ✕ only works when held for HOLD_MS,
// so stray toddler taps do nothing.
let holdTimer = null;

function startHold(e) {
  e.preventDefault();
  closeBtn.classList.add("holding");
  holdTimer = setTimeout(() => {
    closeBtn.classList.remove("holding");
    closePlayer();
  }, HOLD_MS);
}

function cancelHold() {
  closeBtn.classList.remove("holding");
  clearTimeout(holdTimer);
}

closeBtn.addEventListener("pointerdown", startHold);
closeBtn.addEventListener("pointerup", cancelHold);
closeBtn.addEventListener("pointerleave", cancelHold);
closeBtn.addEventListener("pointercancel", cancelHold);

// Swallow taps on the video and any long-press context menus.
shield.addEventListener("pointerdown", (e) => e.preventDefault());
// This capture guard must run before the normal tile and puzzle handlers.
// Waking removes the visual dim immediately, but consumes the entire gesture.
["pointerdown", "pointermove", "pointerup", "pointercancel"].forEach((type) => {
  document.addEventListener(type, guardWakePointer, { capture: true, passive: false });
});
document.addEventListener("click", guardWakeClick, { capture: true });
window.addEventListener("blur", releaseWakeGesture);
document.addEventListener("contextmenu", (e) => e.preventDefault());
// Fingers sliding along the grip band alone must not scroll the page. The
// band keeps the page's touch-action, because touch-action: none there would
// also stop another finger from scrolling while a hand holds the tablet.
const safeBands = [...document.querySelectorAll("#safe-area > div")];
safeBands.forEach((band) => {
  band.addEventListener("touchmove", (event) => {
    if ([...event.touches].every((touch) => safeBands.includes(touch.target))) event.preventDefault();
  }, { passive: false });
});
// Observe contacts at document level so native scrolling can cancel tile
// candidates, and so each puzzle finger that demonstrates drag intent keeps
// its own piece while resting contacts are ignored.
document.addEventListener("pointermove", (event) => {
  updateTileTap(event);
  movePuzzlePiece(event);
}, { capture: true });
document.addEventListener("pointerup", (event) => {
  endTileTap(event);
  endPuzzleDrag(event);
}, { capture: true });
document.addEventListener("pointercancel", (event) => {
  endTileTap(event);
  endPuzzleDrag(event);
}, { capture: true });
pageTabs.forEach((tab) => {
  tab.addEventListener("click", () => showPage(tab.dataset.pageTarget));
});
document.addEventListener("lostpointercapture", (event) => {
  const drag = puzzleDrags.get(event.pointerId);
  // SVG hit paths have implicit touch capture. Moving capture from that path
  // to its button is expected; only losing the button's capture cancels it.
  if (!drag || event.target !== drag.piece) return;
  puzzleDragCandidates.delete(event.pointerId);
  puzzleDrags.delete(event.pointerId);
  rollBackPuzzleDrag(drag, event.pointerId);
  if (!puzzleDrags.size) {
    cancelAnimationFrame(puzzleDragFrame);
    puzzleDragFrame = null;
  }
}, { capture: true });
window.addEventListener("resize", positionPages);
window.screen?.orientation?.addEventListener("change", positionPages);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    releaseWakeGesture();
    stopLesson();
    cancelTileTaps();
    cancelPuzzleDrag();
    releaseMedia();
    audioContext?.suspend();
    stopCounting();
  } else if (timeLimit.hidden) showIdleDim();
});

init();
