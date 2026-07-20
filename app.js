"use strict";

// Loaded once at startup; each entry: { name, videoId, image, hue? }
let animals = [];

const grid = document.getElementById("grid");
const overlay = document.getElementById("overlay");
const shield = document.getElementById("shield");
const loading = document.getElementById("loading");
const loadingImg = document.getElementById("loading-img");
const loadingName = document.getElementById("loading-name");
const closeBtn = document.getElementById("close-btn");

let player = null;
let playing = false;
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
  const res = await fetch("animals.json");
  animals = await res.json();
  renderGrid();
}

function renderGrid() {
  for (const animal of animals) {
    const tile = document.createElement("button");
    tile.className = "tile";
    tile.type = "button";

    const img = document.createElement("img");
    img.src = animal.image;
    img.alt = "";
    if (animal.hue) img.style.filter = `hue-rotate(${animal.hue}deg)`;

    const label = document.createElement("span");
    label.className = "tile-name";
    label.textContent = animal.name;

    tile.append(img, label);
    tile.addEventListener("click", () => play(animal));
    grid.appendChild(tile);
  }
}

function speak(name) {
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
  if (playing) return;
  playing = true;

  loadingImg.src = animal.image;
  loadingImg.style.filter = animal.hue ? `hue-rotate(${animal.hue}deg)` : "";
  loadingName.textContent = animal.name;
  loading.hidden = false;
  overlay.hidden = false;

  speak(animal.name);

  // If the video never reaches PLAYING (embed blocked, network down,
  // endless ad weirdness), bail back to the grid.
  armWatchdog(20000);

  await apiReady;
  if (!playing) return; // closed while API was still loading

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
          clearTimeout(watchdog);
          loading.hidden = true;
        } else if (e.data === YT.PlayerState.BUFFERING) {
          armWatchdog(30000); // making progress — allow a slow network more time
        } else if (e.data === YT.PlayerState.ENDED) {
          closePlayer();
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
    try { player.destroy(); } catch (_) { /* already gone */ }
    player = null;
  }
  // YT.Player consumes the slot element; recreate it for next time.
  let slot = document.getElementById("yt-slot");
  if (slot) slot.remove();
  slot = document.createElement("div");
  slot.id = "yt-slot";
  document.querySelector(".player-frame").appendChild(slot);

  loading.hidden = true;
  overlay.hidden = true;
  playing = false;
}

// Parent escape hatch: the ✕ only works when held for 1.2 seconds,
// so stray toddler taps do nothing.
let holdTimer = null;

function startHold(e) {
  e.preventDefault();
  closeBtn.classList.add("holding");
  holdTimer = setTimeout(() => {
    closeBtn.classList.remove("holding");
    closePlayer();
  }, 1200);
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
