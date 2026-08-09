"use strict";

// Small, dependency-free helpers for distinguishing a likely fingertip from
// broad, stationary contacts. PointerEvent contact geometry is optional, so
// movement and duration remain the primary signals and geometry only adds a
// conservative palm/belly filter when the browser reports it.
(function exposeTouchIntent(globalScope) {
  function finitePositive(value, fallback = 1) {
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function contactGeometry(event) {
    const width = finitePositive(event.width);
    const height = finitePositive(event.height);
    return {
      width,
      height,
      major: Math.max(width, height),
      area: width * height,
      reported: width > 1 || height > 1,
    };
  }

  function beginCandidate(event, details = {}) {
    const geometry = contactGeometry(event);
    return {
      ...details,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      startedAt: event.timeStamp,
      maxDistance: 0,
      maxContactMajor: geometry.major,
      maxContactArea: geometry.area,
      hasContactGeometry: geometry.reported,
    };
  }

  function updateCandidate(candidate, event) {
    const geometry = contactGeometry(event);
    candidate.lastX = event.clientX;
    candidate.lastY = event.clientY;
    candidate.maxDistance = Math.max(
      candidate.maxDistance,
      Math.hypot(event.clientX - candidate.startX, event.clientY - candidate.startY),
    );
    candidate.maxContactMajor = Math.max(candidate.maxContactMajor, geometry.major);
    candidate.maxContactArea = Math.max(candidate.maxContactArea, geometry.area);
    candidate.hasContactGeometry ||= geometry.reported;
    return candidate;
  }

  function looksLikeBroadContact(candidate, limits) {
    if (!candidate.hasContactGeometry) return false;
    return candidate.maxContactMajor > limits.maxMajor
      || candidate.maxContactArea > limits.maxArea;
  }

  function isPlausibleTap(candidate, endedAt, limits) {
    const duration = Math.max(0, endedAt - candidate.startedAt);
    return duration <= limits.maxDuration
      && candidate.maxDistance <= limits.maxDistance
      && !looksLikeBroadContact(candidate, limits);
  }

  function compareTapCandidates(left, right) {
    // Contact size is the closest browser-level proxy for fingertip versus
    // palm. Only compare it when both contacts reported real geometry.
    if (left.hasContactGeometry && right.hasContactGeometry) {
      const majorDifference = left.maxContactMajor - right.maxContactMajor;
      if (majorDifference) return majorDifference;
      const areaDifference = left.maxContactArea - right.maxContactArea;
      if (areaDifference) return areaDifference;
    }

    const movementDifference = left.maxDistance - right.maxDistance;
    if (movementDifference) return movementDifference;

    // When the physical signals tie, the first completed tap wins. The app
    // still commits only one candidate and discards every other contact.
    return left.endedAt - right.endedAt;
  }

  const api = {
    beginCandidate,
    compareTapCandidates,
    contactGeometry,
    isPlausibleTap,
    looksLikeBroadContact,
    updateCandidate,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalScope.TouchIntent = api;
})(typeof globalThis === "undefined" ? window : globalThis);
