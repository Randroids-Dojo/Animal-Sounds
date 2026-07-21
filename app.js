"use strict";

// Hold duration for the parent escape hatch (✕). Applied to the button's
// CSS transition in init() so the visual fill always matches the trigger.
const HOLD_MS = 1200;
const TAP_SLOP_PX = 12;
const SESSION_LIMIT_MS = 15 * 60 * 1000;
const DAILY_LIMIT_MS = 60 * 60 * 1000;
const FIRST_BREAK_MS = 30 * 60 * 1000;
const MAX_BREAK_MS = 60 * 60 * 1000;
const IDLE_DIM_MS = 60 * 1000;
const SCREEN_TIME_KEY = "animal-sounds-screen-time-v1";

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
const puzzleName = document.getElementById("puzzle-name");
const puzzleSuccess = document.getElementById("puzzle-success");

// One YT.Player for the app's lifetime: created lazily on the first tap,
// then reused via loadVideoById — recreating it per tap costs seconds on
// the tablet. "A video is open" is tracked by overlay.hidden alone.
let player = null;
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
let puzzleSuccessTimer = null;
let pageSwipe = null;
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
  if (currentClip) currentClip.pause();
  try { speechSynthesis.cancel(); } catch (_) {}
  closePlayer();
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
  dailyTimeValue.value = `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  dailyTimeValue.textContent = dailyTimeValue.value;
}

function showLimit(now = Date.now()) {
  const dailyLock = screenTime.dailyMs >= DAILY_LIMIT_MS;
  timeLimitTitle.textContent = dailyLock ? "All done for today!" : "Time for a break!";
  timeLimitMessage.textContent = dailyLock
    ? "You have had a full hour of animal sounds. Come back tomorrow."
    : `Come back in ${formatRemaining(screenTime.lockedUntil - now)}.`;
  timeLimit.hidden = false;
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
  const tag = document.createElement("script");
  tag.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(tag);
}

async function init() {
  loadYouTubeApi();
  closeBtn.style.transitionDuration = HOLD_MS + "ms";
  const res = await fetch("animals.json");
  animals = await res.json();
  renderGrid();
  newPuzzle();
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

function renderGrid() {
  grid.append(...animals.map((animal) => {
    const tile = document.createElement("button");
    tile.className = "tile";
    tile.type = "button";

    const img = document.createElement("img");
    img.src = animal.image;
    img.alt = "";
    img.style.filter = hueFilter(animal);

    const label = document.createElement("span");
    label.className = "tile-name";
    label.textContent = animal.name;

    tile.append(img, label);
    // Touch browsers can withhold the synthetic click while another contact
    // (a hand or clothing) is still on the screen. Resolve a stationary touch
    // from this tile's own pointer, but never cancel it: canceling pointerdown
    // prevents the browser from turning a drag on a tile into a page scroll.
    const touches = new Map();
    tile.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "touch") return;
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY, moved: false });
      tile.setPointerCapture(event.pointerId);
    });
    tile.addEventListener("pointermove", (event) => {
      const touch = touches.get(event.pointerId);
      if (!touch) return;
      if (Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > TAP_SLOP_PX) {
        touch.moved = true;
      }
    });
    tile.addEventListener("pointerup", (event) => {
      const touch = touches.get(event.pointerId);
      touches.delete(event.pointerId);
      if (tile.hasPointerCapture(event.pointerId)) tile.releasePointerCapture(event.pointerId);
      if (touch && !touch.moved) {
        recordInteraction();
        play(animal);
      }
    });
    tile.addEventListener("pointercancel", (event) => {
      touches.delete(event.pointerId);
    });
    tile.addEventListener("click", () => play(animal));
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
  const column = index % 3;
  const row = Math.floor(index / 3);
  return `${column * 50}% ${row * 50}%`;
}

function stylePuzzlePart(part, animal, index) {
  part.style.backgroundImage = `url("${animal.image}")`;
  part.style.backgroundPosition = puzzlePosition(index);
}

function choosePuzzleAnimal() {
  const options = animals.length > 1
    ? animals.filter((animal) => animal !== currentPuzzleAnimal)
    : animals;
  return options[Math.floor(Math.random() * options.length)];
}

function resetDraggedPiece(piece) {
  piece.classList.remove("dragging");
  piece.style.position = "";
  piece.style.left = "";
  piece.style.top = "";
  piece.style.width = "";
  piece.style.height = "";
}

function completePuzzle() {
  playSuccessChime();
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
  resetDraggedPiece(piece);
  slot.append(piece);
  slot.classList.add("filled");
  piece.setAttribute("aria-label", "Piece in the right place");
  puzzlePlaced += 1;
  if (puzzlePlaced === 9) completePuzzle();
}

function movePuzzlePiece(event) {
  if (!puzzleDrag || event.pointerId !== puzzleDrag.pointerId) return;
  const { piece, offsetX, offsetY, startX, startY } = puzzleDrag;
  if (!puzzleDrag.moved && Math.hypot(event.clientX - startX, event.clientY - startY) > TAP_SLOP_PX) {
    puzzleDrag.moved = true;
    recordInteraction();
  }
  piece.style.left = `${event.clientX - offsetX}px`;
  piece.style.top = `${event.clientY - offsetY}px`;
}

function endPuzzleDrag(event) {
  if (!puzzleDrag || event.pointerId !== puzzleDrag.pointerId) return;
  const { piece } = puzzleDrag;
  if (piece.hasPointerCapture(event.pointerId)) piece.releasePointerCapture(event.pointerId);
  const target = document.elementFromPoint(event.clientX, event.clientY);
  const slot = target?.closest(".puzzle-slot");
  if (slot && Number(slot.dataset.index) === Number(piece.dataset.index)) {
    placePuzzlePiece(piece, slot);
  } else {
    resetDraggedPiece(piece);
  }
  puzzleDrag = null;
}

function beginPuzzleDrag(event) {
  if (event.pointerType !== "touch" && event.pointerType !== "mouse") return;
  const piece = event.currentTarget;
  event.preventDefault();
  const rect = piece.getBoundingClientRect();
  puzzleDrag = {
    piece,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    moved: false,
  };
  piece.setPointerCapture(event.pointerId);
  piece.classList.add("dragging");
  piece.style.width = `${rect.width}px`;
  piece.style.height = `${rect.height}px`;
  movePuzzlePiece(event);
}

function createPuzzlePiece(animal, index) {
  const piece = document.createElement("button");
  piece.type = "button";
  piece.className = "puzzle-piece";
  piece.dataset.index = index;
  piece.setAttribute("aria-label", "Puzzle piece");
  stylePuzzlePart(piece, animal, index);
  piece.addEventListener("pointerdown", beginPuzzleDrag);
  piece.addEventListener("pointermove", movePuzzlePiece);
  piece.addEventListener("pointerup", endPuzzleDrag);
  piece.addEventListener("pointercancel", endPuzzleDrag);
  return piece;
}

function newPuzzle() {
  currentPuzzleAnimal = choosePuzzleAnimal();
  puzzlePlaced = 0;
  puzzleBoard.replaceChildren();
  puzzleTray.replaceChildren();
  puzzleName.textContent = `Build a ${currentPuzzleAnimal.name}!`;
  for (let index = 0; index < 9; index += 1) {
    const slot = document.createElement("div");
    slot.className = "puzzle-slot";
    slot.dataset.index = index;
    stylePuzzlePart(slot, currentPuzzleAnimal, index);
    puzzleBoard.append(slot);
  }
  for (const index of shuffled([...Array(9).keys()])) {
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

// Recordings of Randy saying each animal's name, e.g. audio/guinea-pig.mp3,
// cached so repeat taps replay instantly.
const voiceClips = new Map();
let currentClip = null;

function speak(name) {
  const slug = name.toLowerCase().replace(/\s+/g, "-");
  let clip = voiceClips.get(slug);
  if (!clip) {
    clip = new Audio(`audio/${slug}.mp3`);
    voiceClips.set(slug, clip);
  }
  if (currentClip) currentClip.pause();
  currentClip = clip;
  clip.currentTime = 0;
  clip.play()?.catch(() => speakFallback(name));
}

function speakFallback(name) {
  try {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(name);
    utterance.rate = 0.9;
    speechSynthesis.speak(utterance);
  } catch (_) {
    // Speech is a nice-to-have; some WebViews lack it.
  }
}

async function play(animal) {
  if (!overlay.hidden) return;

  loadingImg.src = animal.image;
  loadingImg.style.filter = hueFilter(animal);
  loadingName.textContent = animal.name;
  loading.hidden = false;
  overlay.hidden = false;

  speak(animal.name);

  // If the video never reaches PLAYING (embed blocked, network down,
  // endless ad weirdness), bail back to the grid.
  armWatchdog(20000);

  await apiReady;
  if (overlay.hidden) return; // closed while the API was still loading

  if (player) {
    player.loadVideoById(animal.videoId);
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
      onReady: (e) => e.target.playVideo(),
      onStateChange: (e) => {
        if (e.data === YT.PlayerState.PLAYING) {
          if (overlay.hidden) {
            // Closed before the first player finished initializing.
            try { e.target.stopVideo(); } catch (_) {}
            return;
          }
          clearTimeout(watchdog);
          loading.hidden = true;
        } else if (e.data === YT.PlayerState.BUFFERING) {
          armWatchdog(30000); // making progress — allow a slow network more time
        } else if (e.data === YT.PlayerState.ENDED) {
          if (!overlay.hidden) closePlayer();
        }
      },
      onError: () => closePlayer(),
    },
  });
}

function armWatchdog(ms) {
  clearTimeout(watchdog);
  watchdog = setTimeout(closePlayer, ms);
}

function closePlayer() {
  clearTimeout(watchdog);
  if (player) {
    try { player.stopVideo(); } catch (_) { /* not ready yet */ }
  }
  overlay.hidden = true;
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
document.addEventListener("pointerdown", (event) => {
  if (event.pointerType !== "touch" || event.target.closest("button, .puzzle-piece")) return;
  pageSwipe = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
});
document.addEventListener("pointerup", (event) => {
  if (!pageSwipe || event.pointerId !== pageSwipe.pointerId) return;
  const deltaX = event.clientX - pageSwipe.x;
  const deltaY = event.clientY - pageSwipe.y;
  pageSwipe = null;
  if (Math.abs(deltaX) < 70 || Math.abs(deltaX) < Math.abs(deltaY) * 1.4) return;
  if (deltaX < 0) document.body.dataset.page = "puzzle";
  if (deltaX > 0) document.body.dataset.page = "animals";
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopCounting();
  else if (timeLimit.hidden) showIdleDim();
});

init();
