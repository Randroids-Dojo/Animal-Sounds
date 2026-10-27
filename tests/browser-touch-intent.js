(async () => {
  const results = [];
  const originalPlay = play;
  const originalSetPointerCapture = Element.prototype.setPointerCapture;
  const originalHasPointerCapture = Element.prototype.hasPointerCapture;
  const originalReleasePointerCapture = Element.prototype.releasePointerCapture;

  function check(name, condition, details = "") {
    results.push({ name, passed: Boolean(condition), details });
  }

  function fire(target, type, options = {}) {
    const event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerType: "touch",
      pointerId: options.pointerId,
      clientX: options.clientX,
      clientY: options.clientY,
      width: options.width ?? 24,
      height: options.height ?? 18,
      button: 0,
      buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
    });
    target.dispatchEvent(event);
  }

  function center(element) {
    const rect = element.getBoundingClientRect();
    return { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  }

  function resetTiles() {
    clearTimeout(tileTapTimer);
    tileTapTimer = null;
    pendingTileTaps = [];
    tileTapCandidates.clear();
    window.__playedAnimals = [];
    overlay.hidden = true;
    timeLimit.hidden = true;
    idleDim.hidden = true;
  }

  try {
    showPage("animals");
    play = (animal) => window.__playedAnimals.push(animal.name);
    const horse = grid.querySelectorAll(".tile")[0];
    const rabbit = grid.querySelectorAll(".tile")[1];
    const horsePoint = center(horse);
    const rabbitPoint = center(rabbit);

    resetTiles();
    fire(horse, "pointerdown", { pointerId: 1, ...horsePoint, width: 90, height: 24 });
    fire(horse, "pointerup", { pointerId: 1, ...horsePoint, width: 90, height: 24 });
    await new Promise((resolve) => setTimeout(resolve, 120));
    check("broad tile contact is ignored", window.__playedAnimals.length === 0);

    resetTiles();
    fire(horse, "pointerdown", { pointerId: 2, ...horsePoint });
    tileTapCandidates.get(2).startedAt -= TAP_MAX_MS + 1;
    fire(horse, "pointerup", { pointerId: 2, ...horsePoint });
    await new Promise((resolve) => setTimeout(resolve, 120));
    check("long tile hold is ignored", window.__playedAnimals.length === 0);

    resetTiles();
    fire(horse, "pointerdown", { pointerId: 3, ...horsePoint, width: 90, height: 30 });
    fire(rabbit, "pointerdown", { pointerId: 4, ...rabbitPoint, width: 20, height: 16 });
    fire(rabbit, "pointerup", { pointerId: 4, ...rabbitPoint, width: 20, height: 16 });
    await new Promise((resolve) => setTimeout(resolve, 120));
    fire(horse, "pointerup", { pointerId: 3, ...horsePoint, width: 90, height: 30 });
    check(
      "fingertip tap wins while palm remains down",
      window.__playedAnimals.join(",") === "Rabbit",
      window.__playedAnimals.join(","),
    );

    resetTiles();
    fire(horse, "pointerdown", { pointerId: 5, ...horsePoint, width: 35, height: 26 });
    fire(rabbit, "pointerdown", { pointerId: 6, ...rabbitPoint, width: 20, height: 16 });
    fire(horse, "pointerup", { pointerId: 5, ...horsePoint, width: 35, height: 26 });
    fire(rabbit, "pointerup", { pointerId: 6, ...rabbitPoint, width: 20, height: 16 });
    await new Promise((resolve) => setTimeout(resolve, 120));
    check(
      "one smaller contact wins a simultaneous tap cluster",
      window.__playedAnimals.join(",") === "Rabbit",
      window.__playedAnimals.join(","),
    );

    resetTiles();
    horse.dispatchEvent(new PointerEvent("click", {
      bubbles: true,
      pointerType: "touch",
      pointerId: 7,
      detail: 1,
    }));
    check("synthetic touch click is suppressed", window.__playedAnimals.length === 0);
    suppressTouchClicksUntil = 0;
    horse.dispatchEvent(new PointerEvent("click", {
      bubbles: true,
      pointerType: "mouse",
      pointerId: 1,
      detail: 1,
      ...horsePoint,
    }));
    check("mouse click remains available", window.__playedAnimals.join(",") === "Horse");

    // Synthetic PointerEvents are not registered as active pointers by the
    // browser, so neutralize pointer-capture calls for this event-flow test.
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
    showPage("puzzle");
    newPuzzle();
    const pieces = puzzleTray.querySelectorAll(".puzzle-piece");
    const restingPiece = pieces[0];
    const draggedPiece = pieces[1];
    const broadPiece = pieces[2];
    const restingPoint = center(restingPiece);
    const dragPoint = center(draggedPiece);
    const broadPoint = center(broadPiece);

    const ghostCount = () => document.querySelectorAll(".puzzle-piece.dragging").length;
    const nudge = (point, distance = TAP_SLOP_PX + 8) => ({ clientX: point.clientX + distance, clientY: point.clientY });

    fire(restingPiece, "pointerdown", { pointerId: 10, ...restingPoint, width: 28, height: 20 });
    check(
      "resting puzzle contact does not claim a piece",
      puzzleDrags.size === 0 && ghostCount() === 0,
    );
    fire(draggedPiece, "pointerdown", { pointerId: 11, ...dragPoint, width: 20, height: 16 });
    fire(draggedPiece, "pointermove", { pointerId: 11, ...nudge(dragPoint), width: 20, height: 16 });
    check(
      "moving fingertip owns its piece",
      puzzleDrags.get(11)?.piece === draggedPiece && ghostCount() === 1,
      [...puzzleDrags.keys()].join(","),
    );
    fire(draggedPiece, "pointerdown", { pointerId: 13, ...dragPoint, width: 20, height: 16 });
    fire(draggedPiece, "pointermove", { pointerId: 13, ...nudge(dragPoint, TAP_SLOP_PX + 20), width: 20, height: 16 });
    check(
      "second finger cannot take a carried piece",
      puzzleDrags.get(11)?.piece === draggedPiece && !puzzleDrags.has(13) && ghostCount() === 1,
    );
    fire(draggedPiece, "pointerup", { pointerId: 13, ...dragPoint });
    fire(restingPiece, "pointermove", { pointerId: 10, ...nudge(restingPoint, TAP_SLOP_PX + 20), width: 28, height: 20 });
    check(
      "another moving finger drags its own piece",
      puzzleDrags.get(10)?.piece === restingPiece && puzzleDrags.get(11)?.piece === draggedPiece && ghostCount() === 2,
      [...puzzleDrags.keys()].join(","),
    );
    fire(draggedPiece, "pointercancel", { pointerId: 11, ...nudge(dragPoint) });
    check(
      "canceled drag rolls back without ending the other",
      !puzzleDrags.has(11) && !draggedPiece.classList.contains("drag-source")
        && puzzleDrags.get(10)?.piece === restingPiece && ghostCount() === 1,
    );
    fire(restingPiece, "pointercancel", { pointerId: 10, ...restingPoint });
    check("every canceled drag clears", puzzleDrags.size === 0 && ghostCount() === 0);

    fire(broadPiece, "pointerdown", { pointerId: 12, ...broadPoint, width: 90, height: 25 });
    fire(broadPiece, "pointermove", {
      pointerId: 12,
      clientX: broadPoint.clientX + TAP_SLOP_PX + 8,
      clientY: broadPoint.clientY,
      width: 90,
      height: 25,
    });
    check("broad puzzle contact cannot claim a piece", puzzleDrags.size === 0);
    fire(broadPiece, "pointerup", { pointerId: 12, ...broadPoint, width: 90, height: 25 });

    // Two fingers carry two pieces to their own slots at the same time.
    const slotFor = (piece) => puzzleBoard.querySelector(`.puzzle-slot[data-index="${piece.dataset.index}"]`);
    const [leftPiece, rightPiece, wrongPiece] = puzzleTray.querySelectorAll(".puzzle-piece");
    const leftStart = center(leftPiece);
    const rightStart = center(rightPiece);
    fire(leftPiece, "pointerdown", { pointerId: 20, ...leftStart });
    fire(rightPiece, "pointerdown", { pointerId: 21, ...rightStart });
    fire(leftPiece, "pointermove", { pointerId: 20, ...center(slotFor(leftPiece)) });
    fire(rightPiece, "pointermove", { pointerId: 21, ...center(slotFor(rightPiece)) });
    check("two fingers carry two pieces at once", puzzleDrags.size === 2 && ghostCount() === 2);
    fire(leftPiece, "pointerup", { pointerId: 20, ...center(slotFor(leftPiece)) });
    check(
      "first finger places its piece while the second keeps dragging",
      leftPiece.parentElement === slotFor(leftPiece) && puzzleDrags.get(21)?.piece === rightPiece && ghostCount() === 1,
    );
    fire(rightPiece, "pointerup", { pointerId: 21, ...center(slotFor(rightPiece)) });
    check("second finger places its piece", rightPiece.parentElement === slotFor(rightPiece) && ghostCount() === 0);

    // A piece left on another piece's slot stays there, shakes, and glows.
    const wrongSlot = [...puzzleBoard.querySelectorAll(".puzzle-slot:not(.filled)")]
      .find((slot) => slot.dataset.index !== wrongPiece.dataset.index);
    const wrongPoint = center(wrongSlot);
    fire(wrongPiece, "pointerdown", { pointerId: 22, ...center(wrongPiece) });
    fire(wrongPiece, "pointermove", { pointerId: 22, ...wrongPoint });
    fire(wrongPiece, "pointerup", { pointerId: 22, ...wrongPoint });
    const animations = getComputedStyle(wrongPiece).animationName;
    check(
      "wrong slot leaves the piece loose with shake and glow",
      wrongPiece.classList.contains("dropped") && wrongPiece.classList.contains("mismatch")
        && !wrongSlot.classList.contains("filled")
        && animations.includes("puzzle-mismatch-shake") && animations.includes("puzzle-mismatch-glow"),
      animations,
    );
    await new Promise((resolve) => setTimeout(resolve, 1100));
    check("mismatch feedback clears after it fades", !wrongPiece.classList.contains("mismatch"));
    fire(wrongPiece, "pointerdown", { pointerId: 23, ...wrongPoint });
    fire(wrongPiece, "pointermove", { pointerId: 23, ...nudge(wrongPoint, 30) });
    fire(wrongPiece, "pointerup", { pointerId: 23, ...nudge(wrongPoint, 30) });
    check(
      "moving a loose piece within the wrong slot shakes it again",
      wrongPiece.classList.contains("mismatch"),
    );
    const trayPoint = center(puzzleTray);
    fire(wrongPiece, "pointerdown", { pointerId: 24, ...nudge(wrongPoint, 30) });
    fire(wrongPiece, "pointermove", { pointerId: 24, ...trayPoint });
    fire(wrongPiece, "pointerup", { pointerId: 24, ...trayPoint });
    check(
      "a piece left away from the slots does not shake",
      wrongPiece.classList.contains("dropped") && !wrongPiece.classList.contains("mismatch"),
    );
  } finally {
    play = originalPlay;
    Element.prototype.setPointerCapture = originalSetPointerCapture;
    Element.prototype.hasPointerCapture = originalHasPointerCapture;
    Element.prototype.releasePointerCapture = originalReleasePointerCapture;
    cancelPuzzleDrag();
    resetTiles();
    showPage("animals");
  }

  return {
    passed: results.every((result) => result.passed),
    results,
  };
})();
