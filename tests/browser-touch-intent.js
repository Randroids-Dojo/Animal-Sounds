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

    fire(restingPiece, "pointerdown", { pointerId: 10, ...restingPoint, width: 28, height: 20 });
    check(
      "resting puzzle contact does not claim a piece",
      puzzleDrag === null && !document.querySelector(".puzzle-piece.dragging"),
    );
    fire(draggedPiece, "pointerdown", { pointerId: 11, ...dragPoint, width: 20, height: 16 });
    fire(draggedPiece, "pointermove", {
      pointerId: 11,
      clientX: dragPoint.clientX + TAP_SLOP_PX + 8,
      clientY: dragPoint.clientY,
      width: 20,
      height: 16,
    });
    check(
      "moving fingertip exclusively owns puzzle drag",
      puzzleDrag?.pointerId === 11 && Boolean(document.querySelector(".puzzle-piece.dragging")),
      String(puzzleDrag?.pointerId),
    );
    fire(restingPiece, "pointermove", {
      pointerId: 10,
      clientX: restingPoint.clientX + TAP_SLOP_PX + 20,
      clientY: restingPoint.clientY,
      width: 28,
      height: 20,
    });
    check("extra moving contact cannot steal drag", puzzleDrag?.pointerId === 11);
    fire(draggedPiece, "pointercancel", {
      pointerId: 11,
      clientX: dragPoint.clientX + TAP_SLOP_PX + 8,
      clientY: dragPoint.clientY,
    });
    fire(restingPiece, "pointerup", { pointerId: 10, ...restingPoint });
    check("canceled owner rolls back and clears drag", puzzleDrag === null);

    fire(broadPiece, "pointerdown", { pointerId: 12, ...broadPoint, width: 90, height: 25 });
    fire(broadPiece, "pointermove", {
      pointerId: 12,
      clientX: broadPoint.clientX + TAP_SLOP_PX + 8,
      clientY: broadPoint.clientY,
      width: 90,
      height: 25,
    });
    check("broad puzzle contact cannot claim a piece", puzzleDrag === null);
    fire(broadPiece, "pointerup", { pointerId: 12, ...broadPoint, width: 90, height: 25 });
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
