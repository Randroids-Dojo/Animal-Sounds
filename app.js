"use strict";

// Hold duration for the parent escape hatch (✕). Applied to the button's
// CSS transition in init() so the visual fill always matches the trigger.
const HOLD_MS = 1200;

// Loaded once at startup; each entry: { name, videoId, image, hue? }
let animals = [];

const grid = document.getElementById("grid");
const overlay = document.getElementById("overlay");
const shield = document.getElementById("shield");
const loading = document.getElementById("loading");
const loadingImg = document.getElementById("loading-img");
const loadingName = document.getElementById("loading-name");
const closeBtn = document.getElementById("close-btn");

// One YT.Player for the app's lifetime: created lazily on the first tap,
// then reused via loadVideoById — recreating it per tap costs seconds on
// the tablet. "A video is open" is tracked by overlay.hidden alone.
let player = null;
let watchdog = null;

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
    // (a hand or clothing) is still on the screen. Start touch playback from
    // the tile's own pointer instead; click remains the keyboard/mouse path.
    tile.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "touch") return;
      event.preventDefault();
      play(animal);
    });
    tile.addEventListener("click", () => play(animal));
    return tile;
  }));
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
document.addEventListener("contextmenu", (e) => e.preventDefault());

init();
