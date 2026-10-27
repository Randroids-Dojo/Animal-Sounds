"use strict";

// Hold duration for the parent escape hatch (✕). Applied to the button's
// CSS transition in init() so the visual fill always matches the trigger.
const HOLD_MS = 1200;
const TAP_SLOP_PX = 12;
// Drag intent needs only a small deliberate move, not the larger tolerance
// used to distinguish a tap from scrolling the Sounds grid.
const DRAG_SLOP_PX = 4;
const TAP_MAX_MS = 700;
const TAP_ARBITRATION_MS = 90;
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
const PUZZLE_COLORS = ["#FFE6A7", "#C9EDD3", "#FFD7DB", "#E3DCFA", "#FFDFC2"];
const PUZZLE_GRID_SIZE = 3;
const PUZZLE_PIECE_COUNT = PUZZLE_GRID_SIZE ** 2;

// Loaded once at startup; each entry: { name, videoId, image, hue? }
let animals = [];

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
const animalScreen = document.getElementById("animal-screen");
const pageTabs = document.querySelectorAll("[data-page-target]");

// Reuse the player for consecutive Sounds taps, but destroy its iframe when
// leaving Sounds: a stopped YouTube page still retains scripts and buffers.
let player = null;
let playerReady = false;
let pendingVideoId = null;
let playbackRequest = 0;
let watchdog = null;

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
let currentPuzzleAnimal = null;
let puzzlePlaced = 0;
let puzzleDrag = null;
let puzzleDragFrame = null;
const puzzleDragCandidates = new Map();
const tileTapCandidates = new Map();
let pendingTileTaps = [];
let tileTapTimer = null;
let suppressTouchClicksUntil = 0;
let puzzleCompleting = false;
let puzzleSuccessTimer = null;
let audioContext = null;

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
  releaseSounds();
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

function stopPlaybackForLimit() {
  releaseSounds();
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

function loadYouTubeApi() {
  if (document.getElementById("youtube-api")) return;
  const tag = document.createElement("script");
  tag.id = "youtube-api";
  tag.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(tag);
}

async function init() {
  closeBtn.style.transitionDuration = HOLD_MS + "ms";
  const res = await fetch("animals.json");
  animals = await res.json();
  renderGrid();
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
    || document.body.dataset.page !== "animals"
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

function renderGrid() {
  grid.append(...animals.map((animal) => {
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
    label.className = "tile-name";
    label.textContent = animal.name;

    tile.append(img, label);
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
    return tile;
  }));
}

function shuffled(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapWith]] = [result[swapWith], result[index]];
  }
  return result;
}

function puzzlePosition(index) {
  const column = index % PUZZLE_GRID_SIZE;
  const row = Math.floor(index / PUZZLE_GRID_SIZE);
  const step = 100 / (PUZZLE_GRID_SIZE - 1);
  return `${column * step}% ${row * step}%`;
}

function stylePuzzlePart(part, animal, index) {
  part.style.backgroundImage = `url("${animal.image}")`;
  part.style.backgroundPosition = puzzlePosition(index);
  part.style.backgroundColor = PUZZLE_COLORS[index % PUZZLE_COLORS.length];
}

function stylePuzzleSlot(slot, index) {
  slot.style.backgroundColor = PUZZLE_COLORS[index % PUZZLE_COLORS.length];
}

function choosePuzzleAnimal() {
  const options = animals.length > 1
    ? animals.filter((animal) => animal !== currentPuzzleAnimal)
    : animals;
  return options[Math.floor(Math.random() * options.length)];
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
  if (puzzleDrag) {
    const { piece, pointerId } = puzzleDrag;
    puzzleDrag = null;
    if (piece.hasPointerCapture(pointerId)) piece.releasePointerCapture(pointerId);
    resetDraggedPiece(piece);
  }
  removeAllDragGhosts();
}

function completePuzzle() {
  if (puzzleCompleting) return;
  puzzleCompleting = true;
  cancelPuzzleDrag();
  playSuccessChime();
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

function placePuzzlePiece(piece, slot) {
  if (puzzleCompleting || piece.disabled || slot.classList.contains("filled")) return;
  resetDraggedPiece(piece);
  piece.classList.remove("dropped");
  ["left", "top", "width", "height"].forEach((property) => piece.style.removeProperty(property));
  slot.append(piece);
  slot.classList.add("filled");
  piece.disabled = true;
  piece.classList.add("placed");
  piece.setAttribute("aria-label", "Piece in the right place");
  puzzlePlaced = puzzleBoard.querySelectorAll(".puzzle-slot.filled").length;
  if (puzzlePlaced === PUZZLE_PIECE_COUNT) completePuzzle();
}

function leavePuzzlePiece(piece, event, offsetX, offsetY) {
  const screenRect = puzzleScreen.getBoundingClientRect();
  const pieceRect = piece.getBoundingClientRect();
  const left = Math.min(Math.max(0, event.clientX - offsetX - screenRect.left), screenRect.width - pieceRect.width);
  const top = Math.min(Math.max(0, event.clientY - offsetY - screenRect.top), screenRect.height - pieceRect.height);
  resetDraggedPiece(piece);
  piece.classList.add("dropped");
  piece.style.left = `${left}px`;
  piece.style.top = `${top}px`;
  piece.style.width = `${pieceRect.width}px`;
  piece.style.height = `${pieceRect.height}px`;
  puzzleScreen.append(piece);
}

function movePuzzlePiece(event) {
  if (!puzzleDrag) {
    const candidate = puzzleDragCandidates.get(event.pointerId);
    if (!candidate) return;
    TouchIntent.updateCandidate(candidate, event);
    if (candidate.maxDistance <= DRAG_SLOP_PX) return;
    if (TouchIntent.looksLikeBroadContact(candidate, touchLimits)) {
      puzzleDragCandidates.delete(event.pointerId);
      return;
    }
    claimPuzzleDrag(candidate, event);
  }
  if (!puzzleDrag || event.pointerId !== puzzleDrag.pointerId) return;
  const { startX, startY } = puzzleDrag;
  if (!puzzleDrag.moved && Math.hypot(event.clientX - startX, event.clientY - startY) > DRAG_SLOP_PX) {
    puzzleDrag.moved = true;
    recordInteraction();
  }
  puzzleDrag.x = event.clientX - puzzleDrag.offsetX;
  puzzleDrag.y = event.clientY - puzzleDrag.offsetY;
  // Pointer streams can outpace the display. Keep only the newest position
  // and update the compositor once per frame, without invalidating layout.
  if (puzzleDragFrame === null) puzzleDragFrame = requestAnimationFrame(paintPuzzleDrag);
}

function paintPuzzleDrag() {
  puzzleDragFrame = null;
  if (!puzzleDrag) return;
  const { ghost, x, y } = puzzleDrag;
  ghost.style.transform = `translate3d(${x}px, ${y}px, 0) scale(1.08) rotate(3deg)`;
}

function endPuzzleDrag(event) {
  puzzleDragCandidates.delete(event.pointerId);
  if (!puzzleDrag || event.pointerId !== puzzleDrag.pointerId) return;
  const { piece, ghost, offsetX, offsetY } = puzzleDrag;
  puzzleDrag = null;
  cancelAnimationFrame(puzzleDragFrame);
  puzzleDragFrame = null;
  if (piece.hasPointerCapture(event.pointerId)) piece.releasePointerCapture(event.pointerId);
  const target = document.elementFromPoint(event.clientX, event.clientY);
  const slot = target?.closest(".puzzle-slot");
  removeDragGhost(ghost);
  if (event.type === "pointerup" && slot && Number(slot.dataset.index) === Number(piece.dataset.index)) {
    placePuzzlePiece(piece, slot);
  } else if (event.type === "pointerup") {
    leavePuzzlePiece(piece, event, offsetX, offsetY);
  } else {
    resetDraggedPiece(piece);
  }
}

function claimPuzzleDrag(candidate, event) {
  const { piece } = candidate;
  if (puzzleDrag || piece.disabled || puzzleCompleting) return;
  puzzleDragCandidates.clear();
  removeAllDragGhosts();
  const rect = candidate.rect;
  const ghost = piece.cloneNode(false);
  ghost.className = "puzzle-piece dragging";
  ghost.setAttribute("aria-hidden", "true");
  ghost.style.cssText = piece.style.cssText;
  ghost.style.removeProperty("left");
  ghost.style.removeProperty("top");
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  puzzleDrag = {
    piece,
    ghost,
    pointerId: event.pointerId,
    startX: candidate.startX,
    startY: candidate.startY,
    offsetX: candidate.startX - rect.left,
    offsetY: candidate.startY - rect.top,
    moved: event.pointerType === "touch",
    x: event.clientX - (candidate.startX - rect.left),
    y: event.clientY - (candidate.startY - rect.top),
  };
  // Position before insertion, so the first frame never flashes at (0, 0).
  paintPuzzleDrag();
  document.body.append(ghost);
  piece.setPointerCapture(event.pointerId);
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
  if (puzzleDrag) return;

  const candidate = TouchIntent.beginCandidate(event, {
    piece,
    rect: piece.getBoundingClientRect(),
  });
  if (event.pointerType === "mouse") claimPuzzleDrag(candidate, event);
  else puzzleDragCandidates.set(event.pointerId, candidate);
}

function createPuzzlePiece(animal, index) {
  const piece = document.createElement("button");
  piece.type = "button";
  piece.className = "puzzle-piece";
  piece.dataset.index = index;
  piece.setAttribute("aria-label", "Puzzle piece");
  stylePuzzlePart(piece, animal, index);
  piece.addEventListener("pointerdown", beginPuzzleDrag);
  return piece;
}

function newPuzzle() {
  cancelPuzzleDrag();
  clearTimeout(puzzleSuccessTimer);
  puzzleCompleting = false;
  puzzleScreen.classList.remove("puzzle-complete");
  puzzleSuccess.classList.remove("playing");
  puzzleSuccess.hidden = true;
  currentPuzzleAnimal = choosePuzzleAnimal();
  puzzlePlaced = 0;
  puzzleScreen.querySelectorAll(".puzzle-piece.dropped").forEach((piece) => piece.remove());
  puzzleBoard.replaceChildren();
  puzzleTray.replaceChildren();
  puzzleName.textContent = `Build a ${currentPuzzleAnimal.name}!`;
  for (let index = 0; index < PUZZLE_PIECE_COUNT; index += 1) {
    const slot = document.createElement("div");
    slot.className = "puzzle-slot";
    slot.dataset.index = index;
    stylePuzzleSlot(slot, index);
    puzzleBoard.append(slot);
  }
  for (const index of shuffled([...Array(PUZZLE_PIECE_COUNT).keys()])) {
    puzzleTray.append(createPuzzlePiece(currentPuzzleAnimal, index));
  }
}

function playSuccessChime() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  audioContext ||= new AudioContext();
  audioContext.resume?.();
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
  if (page !== "animals" && page !== "puzzle") return;
  cancelTileTaps();
  cancelPuzzleDrag();
  document.body.dataset.page = page;
  animalScreen.hidden = page !== "animals";
  puzzleScreen.hidden = page !== "puzzle";
  if (page === "puzzle") {
    releaseSounds();
    if (animals.length && (!currentPuzzleAnimal || puzzleCompleting)) newPuzzle();
  } else {
    clearTimeout(puzzleSuccessTimer);
    puzzleScreen.classList.remove("puzzle-complete");
    puzzleSuccess.classList.remove("playing");
    puzzleSuccess.hidden = true;
    audioContext?.suspend();
  }
  pageTabs.forEach((tab) => {
    tab.setAttribute("aria-pressed", String(tab.dataset.pageTarget === page));
  });
}

// Recordings of Randy saying each animal's name, e.g. audio/guinea-pig.mp3,
// kept in a small LRU cache so a long kiosk session cannot retain every clip.
const VOICE_CACHE_LIMIT = 4;
const voiceClips = new Map();
let currentClip = null;
let currentUtterance = null;

function stopFallbackSpeech() {
  // Do not initialize Android's speech service on startup or on puzzle taps
  // when all names have been played from recordings.
  if (!currentUtterance) return;
  currentUtterance = null;
  try { speechSynthesis.cancel(); } catch (_) {}
}

function releaseClip(clip) {
  clip.pause();
  clip.removeAttribute("src");
  clip.load();
}

function releaseSounds() {
  closePlayer();
  const oldPlayer = player;
  player = null;
  playerReady = false;
  pendingVideoId = null;
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

function speak(name) {
  stopFallbackSpeech();
  const slug = name.toLowerCase().replace(/\s+/g, "-");
  let clip = voiceClips.get(slug);
  if (!clip) {
    clip = new Audio(`audio/${slug}.mp3`);
  }
  if (currentClip) currentClip.pause();
  voiceClips.delete(slug);
  voiceClips.set(slug, clip);
  if (voiceClips.size > VOICE_CACHE_LIMIT) {
    const [oldestSlug, oldestClip] = voiceClips.entries().next().value;
    voiceClips.delete(oldestSlug);
    releaseClip(oldestClip);
  }
  currentClip = clip;
  clip.currentTime = 0;
  clip.play()?.catch(() => {
    if (currentClip === clip && !overlay.hidden) speakFallback(name);
  });
}

function speakFallback(name) {
  try {
    stopFallbackSpeech();
    const utterance = new SpeechSynthesisUtterance(name);
    utterance.rate = 0.9;
    currentUtterance = utterance;
    utterance.onend = utterance.onerror = () => {
      if (currentUtterance === utterance) currentUtterance = null;
    };
    speechSynthesis.speak(utterance);
  } catch (_) {
    currentUtterance = null;
    // Speech is a nice-to-have; some WebViews lack it.
  }
}

async function play(animal) {
  if (!overlay.hidden || document.body.dataset.page !== "animals" || !timeLimit.hidden || !idleDim.hidden) return;
  const request = ++playbackRequest;
  pendingVideoId = animal.videoId;

  loadingImg.src = animal.image;
  loadingImg.style.filter = hueFilter(animal);
  loadingName.textContent = animal.name;
  loading.hidden = false;
  overlay.hidden = false;

  speak(animal.name);

  // If the video never reaches PLAYING (embed blocked, network down,
  // endless ad weirdness), bail back to the grid.
  armWatchdog(20000);

  loadYouTubeApi();
  await apiReady;
  if (request !== playbackRequest || overlay.hidden) return;

  if (player) {
    if (playerReady) player.loadVideoById(pendingVideoId);
    return;
  }

  player = new YT.Player("yt-slot", {
    videoId: animal.videoId,
    playerVars: {
      autoplay: 1,
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
        if (overlay.hidden) {
          try { e.target.stopVideo(); } catch (_) {}
          return;
        }
        e.target.loadVideoById(pendingVideoId);
      },
      onStateChange: (e) => {
        if (player !== e.target) return;
        if (e.data === YT.PlayerState.PLAYING) {
          if (overlay.hidden) {
            // Closed before the first player finished initializing.
            try { e.target.stopVideo(); } catch (_) {}
            return;
          }
          clearTimeout(watchdog);
          loading.hidden = true;
        } else if (e.data === YT.PlayerState.BUFFERING) {
          if (!overlay.hidden) armWatchdog(30000); // allow a slow network more time
        } else if (e.data === YT.PlayerState.ENDED) {
          if (!overlay.hidden) closePlayer();
        }
      },
      onError: (e) => { if (player === e.target) closePlayer(); },
    },
  });
}

function armWatchdog(ms) {
  clearTimeout(watchdog);
  watchdog = setTimeout(closePlayer, ms);
}

function closePlayer() {
  playbackRequest += 1;
  clearTimeout(watchdog);
  if (player && !overlay.hidden) {
    try { player.stopVideo(); } catch (_) { /* not ready yet */ }
  }
  overlay.hidden = true;
  loading.hidden = true;
  if (currentClip) currentClip.pause();
  stopFallbackSpeech();
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
idleDim.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  wakeIdleScreen();
});
document.addEventListener("contextmenu", (e) => e.preventDefault());
// Observe contacts at document level so native scrolling can cancel tile
// candidates, and so the one puzzle finger that demonstrates drag intent
// keeps ownership while all other contacts are ignored.
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
  if (puzzleDrag?.pointerId === event.pointerId) cancelPuzzleDrag();
}, { capture: true });
window.addEventListener("resize", cancelPuzzleDrag);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopCounting();
    cancelTileTaps();
    cancelPuzzleDrag();
    releaseSounds();
    audioContext?.suspend();
  }
  else if (timeLimit.hidden) showIdleDim();
});

init();
