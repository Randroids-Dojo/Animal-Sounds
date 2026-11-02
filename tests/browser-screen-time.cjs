"use strict";

// Close and relaunch the browser with the same on-disk profile to model
// FreeKiosk/device restarts, then use real title taps to reset saved limits.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

(async () => {
  const profile = mkdtempSync(join(tmpdir(), "animal-sounds-screen-time-"));
  const options = {
    channel: process.env.BROWSER_EXECUTABLE_PATH ? undefined : "chrome",
    executablePath: process.env.BROWSER_EXECUTABLE_PATH,
    headless: true,
    viewport: { width: 800, height: 1340 },
    hasTouch: true,
  };
  let context;
  let page;
  const errors = [];
  const url = process.argv[2] || "http://127.0.0.1:8642";
  const ready = async () => {
    await page.locator(".tile").first().waitFor();
    await page.waitForFunction(() => puzzleDeck !== null && dailyTimeValue.value !== "");
  };
  const openApp = async () => {
    context = await chromium.launchPersistentContext(profile, options);
    page = context.pages()[0];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    await ready();
  };
  const restart = async () => {
    await context.close();
    await openApp();
  };
  const state = () => page.evaluate(() => ({ ...screenTime, locked: !timeLimit.hidden, display: dailyTimeValue.value }));
  const titleTaps = async (count, mouse = false) => {
    for (let i = 0; i < count; i += 1) {
      if (mouse) await page.locator("#app-title").click();
      else await page.locator("#app-title").tap();
    }
  };
  const checkReset = async (checkSaved = true) => {
    const reset = await state();
    assert.equal(reset.dailyMs, 0, "admin reset clears total usage");
    assert.equal(reset.sessionMs, 0, "admin reset clears session usage");
    assert.equal(reset.breakCount, 0, "admin reset clears the break count");
    assert.equal(reset.lockedUntil, 0, "admin reset clears the saved lock");
    assert.equal(reset.locked, false, "admin reset unlocks the app");
    assert.equal(reset.display, "0:00:00", "the visible timer resets immediately");
    if (checkSaved) {
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem(SCREEN_TIME_KEY)).dailyMs), 0,
        "the reset is saved to permanent storage");
    }
  };
  try {
    await openApp();
    const browserVersion = context.browser().version();
    await checkReset(false);

    await page.evaluate(() => {
      localStorage.setItem("screen-time-test-preference", "preserve-me");
      wakeIdleScreen();
      recordInteraction(Date.now() - 65000);
      stopCounting();
      renderDailyTime();
    });
    const used = await state();
    assert.ok(used.dailyMs >= 65000, "active time is counted");
    await page.reload();
    await ready();
    const reloaded = await state();
    assert.equal(reloaded.dailyMs, used.dailyMs, "a page reload preserves accumulated usage");
    assert.equal(reloaded.sessionMs, used.sessionMs, "a page reload preserves the current session limit");
    assert.equal(reloaded.display, used.display, "the visible timer survives reload");
    await restart();
    assert.deepEqual(await state(), reloaded, "a browser restart preserves usage and the visible timer");

    await page.evaluate(() => {
      screenTime.sessionMs = SESSION_LIMIT_MS;
      wakeIdleScreen();
      updateScreenTime();
      renderDailyTime();
    });
    const breakLock = await state();
    assert.equal(breakLock.locked, true, "the session limit still creates a break");
    await page.reload();
    await ready();
    assert.deepEqual(await state(), breakLock, "a reload preserves the break lock");
    await restart();
    assert.deepEqual(await state(), breakLock, "a browser restart preserves the break lock");

    await titleTaps(16);
    assert.equal((await state()).locked, true, "16 title taps do not unlock the app");
    await page.locator("#time-limit-title").tap();
    await titleTaps(1);
    assert.equal((await state()).locked, true, "a tap elsewhere interrupts the sequence even when the wake guard consumes it");
    await titleTaps(15);
    assert.equal((await state()).locked, true, "an interrupted sequence needs 17 new title taps");
    await titleTaps(1);
    await checkReset();
    assert.equal(await page.evaluate(() => idleDim.hidden), true, "admin reset wakes the screen");
    await restart();
    await checkReset();

    await page.evaluate(() => {
      screenTime.dailyMs = DAILY_LIMIT_MS;
      screenTime.breakCount = 4;
      lockForBreak();
      renderDailyTime();
    });
    const locked = await state();
    assert.equal(locked.display, "1:00:00");
    assert.equal(locked.locked, true, "the daily limit still locks the app");

    await restart();
    assert.deepEqual(await state(), locked, "a browser restart preserves the daily lock");
    await titleTaps(16, true);
    assert.equal((await state()).locked, true, "16 mouse clicks also leave the daily lock intact");
    await titleTaps(1, true);
    await checkReset();

    await page.evaluate(() => {
      window.played = [];
      play = (animal) => window.played.push(animal.name);
    });
    await page.locator(".tile").first().tap();
    await page.waitForFunction(() => window.played.length === 1 && countingSince !== null);
    await page.evaluate(() => { stopCounting(Date.now() + 65000); renderDailyTime(); });
    assert.ok((await state()).dailyMs >= 65000, "normal play resumes and counts time after a reset");
    await titleTaps(16);
    assert.ok((await state()).dailyMs >= 65000, "a successful reset starts the title counter over");
    await page.evaluate(() => showIdleDim());
    await titleTaps(1);
    await checkReset();

    // The dim layer consumes this outside tap, but it must still cancel the code.
    await page.evaluate(() => {
      screenTime.dailyMs = 65000;
      screenTime.sessionMs = 65000;
      saveScreenTime();
      showIdleDim();
      renderDailyTime();
    });
    await titleTaps(16);
    await page.touchscreen.tap(400, 500);
    await titleTaps(1);
    assert.equal((await state()).dailyMs, 65000, "a swallowed wake tap cancels the sequence");
    await titleTaps(16);
    await checkReset();
    await restart();
    await checkReset();

    assert.equal(await page.evaluate(() => localStorage.getItem("screen-time-test-preference")), "preserve-me",
      "admin reset preserves unrelated saved preferences");
    await page.evaluate(() => {
      screenTime = { ...freshScreenTime(), day: "2000-1-1", dailyMs: DAILY_LIMIT_MS, breakCount: 4, lockedUntil: startOfTomorrow() };
      saveScreenTime();
    });
    await restart();
    await checkReset(false);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, browser: browserVersion, reloadPreservesUsageAndLocks: true,
      browserRestartPreservesUsageAndLocks: true, seventeenthTapResetsBreakAndDailyLocks: true,
      outsideTapsInterruptCode: true, resetWorksWhileDimmed: true, resetPersistsAcrossRestart: true,
      normalPlayResumes: true, unrelatedPreferencesPreserved: true, newCalendarDayResetsUsage: true }, null, 2));
  } finally {
    await context?.close();
    rmSync(profile, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
