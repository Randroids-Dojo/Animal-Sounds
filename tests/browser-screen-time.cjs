"use strict";

// A fresh WebView session models FreeKiosk reopening after an app/device
// restart. Keep permanent origin storage while discarding session storage.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");

(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_EXECUTABLE_PATH ? undefined : "chrome",
    executablePath: process.env.BROWSER_EXECUTABLE_PATH,
    headless: true,
  });
  const context = await browser.newContext();
  const errors = [];
  const url = process.argv[2] || "http://127.0.0.1:8642";
  const ready = async (page) => {
    await page.locator(".tile").first().waitFor();
    await page.waitForFunction(() => puzzleDeck !== null && dailyTimeValue.value !== "");
  };
  const state = (page) => page.evaluate(() => ({ ...screenTime, locked: !timeLimit.hidden, display: dailyTimeValue.value }));
  let page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(url);
    await ready(page);
    await page.evaluate(() => {
      localStorage.setItem(SCREEN_TIME_KEY, JSON.stringify({
        ...freshScreenTime(), dailyMs: DAILY_LIMIT_MS, breakCount: 4, lockedUntil: startOfTomorrow(),
      }));
      localStorage.setItem("screen-time-test-preference", "preserve-me");
    });
    await page.reload();
    await ready(page);
    const fresh = await state(page);
    assert.equal(fresh.dailyMs, 0, "a new session ignores the old permanent timer");
    assert.equal(fresh.locked, false, "an old permanent lock does not carry over");
    assert.equal(fresh.display, "0:00:00");

    await page.evaluate(() => {
      wakeIdleScreen();
      recordInteraction(Date.now() - 65000);
      stopCounting();
      renderDailyTime();
    });
    const used = await state(page);
    assert.ok(used.dailyMs >= 65000, "active time is counted");
    await page.reload();
    await ready(page);
    const reloaded = await state(page);
    assert.equal(reloaded.dailyMs, used.dailyMs, "a page reload preserves accumulated usage");
    assert.equal(reloaded.sessionMs, used.sessionMs, "a page reload preserves the current session limit");
    assert.equal(reloaded.display, used.display, "the visible timer survives reload");

    await page.evaluate(() => {
      screenTime.sessionMs = SESSION_LIMIT_MS;
      wakeIdleScreen();
      updateScreenTime();
      renderDailyTime();
    });
    assert.equal((await state(page)).locked, true, "the session limit still creates a break");
    await page.reload();
    await ready(page);
    assert.equal((await state(page)).locked, true, "a reload preserves the break lock");
    await page.evaluate(() => {
      screenTime.dailyMs = DAILY_LIMIT_MS;
      screenTime.breakCount = 4;
      lockForBreak();
      renderDailyTime();
    });
    const locked = await state(page);
    assert.equal(locked.display, "1:00:00");
    assert.equal(locked.locked, true, "the daily limit still locks the app");

    await page.close();
    page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    await ready(page);
    const restarted = await state(page);
    assert.equal(restarted.dailyMs, 0, "reopening resets total active time");
    assert.equal(restarted.sessionMs, 0, "reopening resets session usage");
    assert.equal(restarted.breakCount, 0, "reopening resets the break count");
    assert.equal(restarted.lockedUntil, 0, "reopening clears the persisted lock");
    assert.equal(restarted.locked, false, "the reopened app is usable");
    assert.equal(restarted.display, "0:00:00", "the visible timer starts at zero");
    assert.equal(await page.evaluate(() => localStorage.getItem("screen-time-test-preference")), "preserve-me",
      "reopening preserves permanent origin data");
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, browser: browser.version(), reloadPreservesUsage: true,
      reloadPreservesLocks: true, newSessionResetsUsageAndLocks: true }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
