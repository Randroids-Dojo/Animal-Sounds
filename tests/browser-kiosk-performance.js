// Run in a freshly loaded local app. Uses synthetic contacts and a fake media
// player for deterministic lifecycle checks; real touch/paint timing is separate.
(async () => {
  const results = [];
  const check = (name, passed, details = "") => results.push({ name, passed: Boolean(passed), details });
  const nextFrame = () => new Promise(requestAnimationFrame);
  const original = {
    capture: Element.prototype.setPointerCapture,
    hasCapture: Element.prototype.hasPointerCapture,
    releaseCapture: Element.prototype.releasePointerCapture,
    recordInteraction,
    loadYouTubeApi,
    playSuccessChime,
    Audio: window.Audio,
    YT: window.YT,
    speech: Object.getOwnPropertyDescriptor(window, "speechSynthesis"),
    Utterance: window.SpeechSynthesisUtterance,
  };
  function center(element) {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
  function fire(piece, type, point, pointerId = 200) {
    piece.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerType: "touch", pointerId,
      button: 0, buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
      clientX: point.x, clientY: point.y, width: 20, height: 16,
    }));
  }
  function start(piece, dx = 8) {
    const point = center(piece);
    fire(piece, "pointerdown", point);
    fire(piece, "pointermove", { x: point.x + dx, y: point.y });
    return point;
  }
  const createdPlayers = [];
  const createdClips = [];
  let speechReads = 0;
  let speechCancels = 0;
  try {
    Object.defineProperty(window, "speechSynthesis", { configurable: true, get() {
      speechReads += 1;
      return { speak() {}, cancel() { speechCancels += 1; } };
    } });
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    check("startup does not load YouTube or build the hidden puzzle",
      !document.querySelector("#youtube-api") && !currentPuzzleAnimal && !puzzleTray.children.length);
    recordInteraction = () => {};
    playSuccessChime = () => {};
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
    idleDim.hidden = true;
    timeLimit.hidden = true;
    showPage("puzzle");
    check("inactive Sounds screen has no layout",
      animalScreen.hidden && grid.getBoundingClientRect().width === 0);
    let piece = puzzleTray.querySelector(".puzzle-piece");
    const point = start(piece);
    check("8px movement immediately claims a piece", puzzleDrag?.piece === piece);
    const ghost = puzzleDrag.ghost;
    const firstTransform = ghost.style.transform;
    for (let dx = 9; dx <= 100; dx += 1) {
      fire(piece, "pointermove", { x: point.x + dx, y: point.y });
    }
    check("move burst waits for one compositor update without layout writes",
      puzzleDragFrame !== null && ghost.style.transform === firstTransform
      && ghost.style.left === "" && ghost.style.top === "");
    await nextFrame();
    const transform = new DOMMatrixReadOnly(ghost.style.transform);
    check("next frame uses the newest pointer position",
      Math.abs(transform.m41 - puzzleDrag.x) < 0.01 && Math.abs(transform.m42 - puzzleDrag.y) < 0.01);
    const matchingSlot = puzzleBoard.querySelector(`[data-index="${piece.dataset.index}"]`);
    fire(piece, "pointercancel", center(matchingSlot));
    check("cancel over correct slot never places a piece or leaves work queued",
      !piece.disabled && !puzzleDrag && puzzleDragFrame === null && !ghost.isConnected);
    start(piece);
    piece.dispatchEvent(new PointerEvent("lostpointercapture", { bubbles: true, pointerId: 200 }));
    check("lost capture cancels drag", !puzzleDrag && puzzleDragFrame === null);
    start(piece);
    fire(piece, "pointerup", center(matchingSlot));
    check("correct release places piece", piece.disabled && matchingSlot.contains(piece));
    const loosePiece = puzzleTray.querySelector(".puzzle-piece");
    const loosePoint = start(loosePiece);
    fire(loosePiece, "pointerup", { x: loosePoint.x + 25, y: loosePoint.y + 10 });
    const loosePosition = loosePiece.style.cssText;
    check("incorrect release leaves piece movable on the surface", loosePiece.classList.contains("dropped") && !loosePiece.disabled);
    for (let index = 0; index < 30; index += 1) {
      showPage("animals");
      showPage("puzzle");
    }
    check("repeated tab switches preserve placed and loose pieces without duplicates",
      puzzlePlaced === 1 && matchingSlot.contains(piece) && loosePiece.style.cssText === loosePosition
      && puzzleScreen.querySelectorAll(".puzzle-piece").length === 9 && !puzzleDrag);
    const completedAnimal = currentPuzzleAnimal;
    for (const remaining of puzzleScreen.querySelectorAll(".puzzle-piece:not(:disabled)")) {
      start(remaining);
      const slot = puzzleBoard.querySelector(`[data-index="${remaining.dataset.index}"]`);
      fire(remaining, "pointerup", center(slot));
    }
    check("all nine releases complete the puzzle", puzzlePlaced === 9 && puzzleCompleting && !puzzleSuccess.hidden);
    await new Promise((resolve) => setTimeout(resolve, 4300));
    check("celebration advances to a fresh playable round",
      !puzzleCompleting && puzzlePlaced === 0 && puzzleSuccess.hidden && currentPuzzleAnimal !== completedAnimal
      && puzzleTray.querySelectorAll(".puzzle-piece").length === 9);

    window.Audio = class FakeAudio {
      constructor(src) { this.src = src; this.currentTime = 0; createdClips.push(this); }
      pause() {}
      play() { return Promise.resolve(); }
      removeAttribute() { this.src = ""; }
      load() {}
    };
    window.YT = {
      PlayerState: { PLAYING: 1, BUFFERING: 3, ENDED: 0 },
      Player: class FakePlayer {
        constructor(id, options) {
          this.events = options.events;
          this.loaded = [];
          this.iframe = document.createElement("iframe");
          this.iframe.id = id;
          document.getElementById(id).replaceWith(this.iframe);
          createdPlayers.push(this);
        }
        ready() { this.events.onReady({ target: this }); }
        loadVideoById(id) { this.loaded.push(id); }
        stopVideo() {}
        destroy() { this.destroyed = true; this.iframe.remove(); }
      },
    };
    loadYouTubeApi = () => {};
    showPage("animals");
    const staleRequest = play(animals[0]);
    closePlayer();
    const currentRequest = play(animals[1]);
    window.onYouTubeIframeAPIReady();
    await Promise.all([staleRequest, currentRequest]);
    check("closing during API startup cannot reopen a stale animal",
      createdPlayers.length === 1 && player === createdPlayers[0]);
    closePlayer();
    await play(animals[2]);
    player.ready();
    check("new tap before player ready loads the latest animal",
      player.loaded.length === 1 && player.loaded[0] === animals[2].videoId);
    closePlayer();
    await play(animals[3]);
    check("consecutive Sounds taps reuse the ready player",
      createdPlayers.length === 1 && player.loaded.at(-1) === animals[3].videoId);
    animals.slice(0, 10).forEach((animal) => speak(animal.name));
    check("voice cache is bounded and evicted clips release their sources",
      voiceClips.size === VOICE_CACHE_LIMIT && createdClips.some((clip) => !clip.src));
    check("recorded names and puzzle switches do not initialize the speech service", speechReads === 0);
    speakFallback("Horse");
    showPage("puzzle");
    check("active speech fallback is canceled when leaving Sounds", currentUtterance === null && speechCancels === 1);
    check("switching to Puzzle destroys video iframe and releases all voice clips",
      player === null && createdPlayers[0].destroyed && !document.querySelector(".player-frame iframe")
      && !voiceClips.size && currentClip === null && document.getElementById("yt-slot").tagName === "DIV");
    const originalArmWatchdog = armWatchdog;
    let lateWatchdogs = 0;
    try {
      armWatchdog = () => { lateWatchdogs += 1; };
      createdPlayers[0].events.onStateChange({ target: createdPlayers[0], data: 3 });
    } finally {
      armWatchdog = originalArmWatchdog;
    }
    check("late events from destroyed player cannot restart watchdog", lateWatchdogs === 0);
    showPage("animals");
    await play(animals[0]);
    check("Sounds can recreate a player after memory release", createdPlayers.length === 2 && player === createdPlayers[1]);
    closePlayer();
    player.ready();
    await play(animals[1]);
    check("player becoming ready while closed remains reusable",
      createdPlayers.length === 2 && player.loaded.at(-1) === animals[1].videoId);
    showIdleDim();
    check("idle dim releases player and cached audio", idleDim.hidden === false && player === null && !voiceClips.size);
  } finally {
    releaseSounds();
    cancelPuzzleDrag();
    Element.prototype.setPointerCapture = original.capture;
    Element.prototype.hasPointerCapture = original.hasCapture;
    Element.prototype.releasePointerCapture = original.releaseCapture;
    recordInteraction = original.recordInteraction;
    loadYouTubeApi = original.loadYouTubeApi;
    playSuccessChime = original.playSuccessChime;
    window.Audio = original.Audio;
    window.YT = original.YT;
    window.SpeechSynthesisUtterance = original.Utterance;
    if (original.speech) Object.defineProperty(window, "speechSynthesis", original.speech);
    else delete window.speechSynthesis;
    showPage("animals");
    showIdleDim();
  }
  return { passed: results.every((result) => result.passed), results };
})();
