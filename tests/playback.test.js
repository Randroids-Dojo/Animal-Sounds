"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function setup({ duration = 6, apiReady = true } = {}) {
  let now = 0;
  let timerId = 0;
  const timers = new Map();
  const elements = new Map();
  const node = () => ({
    hidden: true,
    style: {},
    classList: { add() {}, remove() {} },
    addEventListener() {},
    appendChild() {},
  });
  const schedule = (callback, ms, interval = 0) => {
    const id = ++timerId;
    timers.set(id, { callback, at: now + ms, interval });
    return id;
  };
  const player = {
    time: 0,
    duration,
    state: -1,
    stopCalls: 0,
    playCalls: 0,
    loads: [],
    loops: [],
    getCurrentTime() { return this.time; },
    getDuration() { return this.duration; },
    getPlayerState() { return this.state; },
    playVideo() { this.playCalls += 1; },
    stopVideo() { this.stopCalls += 1; },
    setLoop(value) { this.loops.push(value); },
    loadVideoById(videoId) {
      this.loads.push(videoId);
      this.time = 0;
      this.state = -1;
    },
    emit(state) {
      this.state = state;
      this.options.events.onStateChange({ target: this, data: state });
    },
    ready() { this.options.events.onReady({ target: this }); },
  };
  const context = vm.createContext({
    document: {
      head: node(),
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, node());
        return elements.get(id);
      },
      querySelectorAll: () => [],
      createElement: node,
      addEventListener() {},
    },
    window: { addEventListener() {} },
    localStorage: { getItem: () => null },
    // Leave the unrelated animal-grid initialization pending. The actual
    // playback code and its API callbacks run unchanged in this context.
    fetch: () => new Promise(() => {}),
    Audio: class { pause() {} play() { return Promise.resolve(); } },
    YT: {
      Player: function (_slot, options) { player.options = options; return player; },
      PlayerState: { ENDED: 0, PLAYING: 1, BUFFERING: 3 },
    },
    setTimeout: (callback, ms) => schedule(callback, ms),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (callback, ms) => schedule(callback, ms, ms),
    clearInterval: (id) => timers.delete(id),
  });
  const run = (source) => vm.runInContext(source, context);
  run(fs.readFileSync(require.resolve("../app.js"), "utf8"));
  if (apiReady) context.window.onYouTubeIframeAPIReady();

  return {
    player,
    run,
    resolveApi: () => context.window.onYouTubeIframeAPIReady(),
    hidden: () => elements.get("overlay").hidden,
    open: (name = "Horse") => run(`play(${JSON.stringify({ name, videoId: name, image: "animal.svg" })})`),
    async start() {
      await this.open();
      player.ready();
      player.emit(1);
    },
    tick(ms) {
      const until = now + ms;
      while (true) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > until) break;
        const [id, timer] = next;
        now = timer.at;
        if (timer.interval) timer.at += timer.interval;
        else timers.delete(id);
        timer.callback();
      }
      now = until;
    },
  };
}

test("a normal end returns to the grid and stops the player", async () => {
  const app = setup();
  await app.start();
  app.player.emit(0);
  assert.equal(app.hidden(), true);
  assert.equal(app.player.stopCalls, 1);
});

test("a finished clip returns even when the ended callback is missing", async () => {
  const app = setup();
  await app.start();
  app.player.time = 6;
  app.tick(500);
  assert.equal(app.hidden(), true);
});

test("a short that loops without an ended event is stopped on its first rewind", async () => {
  const app = setup();
  await app.start();
  app.player.time = 5.5;
  app.tick(500);
  assert.equal(app.hidden(), false);
  app.player.time = 0.1;
  app.player.emit(1);
  app.tick(500);
  assert.equal(app.hidden(), true);
});

test("buffering and repeated playing events cannot extend the completion deadline", async () => {
  const app = setup();
  await app.start();
  for (let index = 0; index < 40 && !app.hidden(); index += 1) {
    app.player.emit(3);
    app.player.emit(1);
    app.tick(1000);
  }
  assert.equal(app.hidden(), true);
});

test("late metadata still supplies a completion deadline", async () => {
  const app = setup({ duration: 0 });
  await app.start();
  app.tick(1000);
  app.player.duration = 6;
  app.tick(500);
  app.tick(37000);
  assert.equal(app.hidden(), true);
});

test("unavailable metadata cannot leave playback open forever", async () => {
  const app = setup({ duration: 0 });
  await app.start();
  app.tick(4 * 60 * 1000);
  assert.equal(app.hidden(), true);
});

test("brief buffering preserves the full clip", async () => {
  const app = setup();
  await app.start();
  app.player.time = 2;
  app.tick(2000);
  app.player.emit(3);
  app.tick(10000);
  assert.equal(app.hidden(), false);
  app.player.emit(1);
  app.player.time = 5.5;
  app.tick(500);
  assert.equal(app.hidden(), false);
  app.player.emit(0);
  assert.equal(app.hidden(), true);
});

test("closing clears old playback timers before reusing the player", async () => {
  const app = setup();
  await app.start();
  app.tick(5000);
  app.run("closePlayer()");
  app.player.duration = 60;
  await app.open("Rabbit");
  app.player.emit(1);
  app.tick(32000);
  assert.equal(app.hidden(), false);
  app.player.emit(0);
  assert.equal(app.hidden(), true);
});

test("looping is disabled when creating and reusing the player", async () => {
  const app = setup();
  await app.start();
  assert.equal(app.player.options.playerVars.loop, 0);
  assert.equal(app.player.loops.at(-1), false);
  app.player.emit(0);
  await app.open("Rabbit");
  assert.deepEqual(app.player.loads, ["Rabbit"]);
  assert.equal(app.player.loops.at(-1), false);
});

test("a late ready event cannot restart a closed clip", async () => {
  const app = setup();
  await app.open();
  app.run("closePlayer()");
  app.player.ready();
  assert.equal(app.player.playCalls, 0);
});

test("only the latest selection starts after the API loads late", async () => {
  const app = setup({ apiReady: false });
  const first = app.open("Horse");
  app.run("closePlayer()");
  const second = app.open("Rabbit");
  app.resolveApi();
  await Promise.all([first, second]);
  assert.equal(app.player.options.videoId, "Rabbit");
  assert.deepEqual(app.player.loads, []);
});

test("closing marks the overlay closed before stopVideo emits another end", async () => {
  const app = setup();
  await app.start();
  app.player.stopVideo = () => {
    app.player.stopCalls += 1;
    if (app.player.stopCalls < 3) app.player.emit(0);
  };
  app.player.emit(0);
  assert.equal(app.player.stopCalls, 1);
});
