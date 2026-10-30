import test from "node:test";
import assert from "node:assert/strict";
import { AudioDuckingEngine } from "../apps/web/lib/audio-ducking-engine.js";

function fakeTimers() {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimer(callback, delay) {
      const id = ++nextId;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimer(id) { timers.delete(id); },
    advance(milliseconds) {
      now += milliseconds;
      let due = [...timers.entries()].filter(([, timer]) => timer.at <= now).sort((a, b) => a[1].at - b[1].at);
      while (due.length) {
        for (const [id, timer] of due) {
          if (!timers.has(id)) continue;
          timers.delete(id);
          timer.callback();
        }
        due = [...timers.entries()].filter(([, timer]) => timer.at <= now).sort((a, b) => a[1].at - b[1].at);
      }
    },
    count: () => timers.size,
  };
}

function fakeParam(initialValue) {
  const events = [];
  return {
    value: initialValue,
    events,
    cancelScheduledValues(time) { events.push({ type: "cancel", time }); },
    setValueAtTime(value, time) { this.value = value; events.push({ type: "set", value, time }); },
    linearRampToValueAtTime(value, time) { this.value = value; events.push({ type: "ramp", value, time }); },
  };
}

function fakeAudioContext(timers) {
  const listeners = new Map();
  let timeOffset = 1;
  const context = {
    get currentTime() { return timeOffset + (timers?.now?.() ?? 0) / 1000; },
    set currentTime(value) { timeOffset = value - (timers?.now?.() ?? 0) / 1000; },
    state: "running",
    destination: {},
    closeCalled: false,
    createMediaElementSource() { return { connect() {}, disconnect() {} }; },
    createGain() { return { gain: fakeParam(1), connect() {}, disconnect() {} }; },
    resume() { this.state = "running"; return Promise.resolve(); },
    close() { this.closeCalled = true; this.state = "closed"; return Promise.resolve(); },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); },
    dispatch(name) { listeners.get(name)?.(); },
  };
  return context;
}

function makeAudio() {
  return {
    volume: 0.65,
    muted: false,
    paused: false,
    currentTime: 3,
    dataset: {},
    playCalls: 0,
    play() { this.playCalls += 1; this.paused = false; return Promise.resolve(); },
  };
}

function makeEngine(options = {}) {
  const audio = options.audio || makeAudio();
  const timers = options.timers || fakeTimers();
  const context = options.context || fakeAudioContext(timers);
  const config = options.config;
  const engine = new AudioDuckingEngine({
    audioElement: audio,
    createAudioContext: () => context,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    now: timers.now,
    requestFrame: (callback) => timers.setTimer(() => callback(timers.now()), 16),
    cancelFrame: timers.clearTimer,
    config,
  });
  return { engine, audio, context, timers };
}

async function activate(engine) { await engine.activateFromGesture(); }

test("instruction start schedules a 250 ms GainNode fade to 0.25 without changing user volume", async () => {
  const { engine, context } = makeEngine();
  await activate(engine);
  engine.handleInstruction("start", { instructionId: "nav-1" });
  assert.equal(engine.state, "ducking");
  assert.equal(engine.userVolume, 0.65);
  assert.equal(engine.getSnapshot().effectiveVolume, 0.65);
  assert.ok(engine.duckGainNode.gain.events.some((event) => event.type === "ramp" && event.value === 0.25 && event.time === 1.25));
  engine.destroy();
});

test("instruction end holds 150 ms and then schedules the 700 ms restore", async () => {
  const { engine, context, timers } = makeEngine();
  await activate(engine);
  engine.handleInstruction("start", { instructionId: "nav-1" });
  engine.handleInstruction("end", { instructionId: "nav-1" });
  assert.equal(engine.state, "ducking");
  timers.advance(150);
  assert.equal(engine.state, "restoring");
  assert.ok(engine.duckGainNode.gain.events.some((event) => event.type === "ramp" && event.value === 1 && Math.abs(event.time - 1.85) < 0.001));
  timers.advance(700);
  assert.equal(engine.state, "idle");
  assert.equal(engine.duckingGain, 1);
  engine.destroy();
});

test("speech error and cancel restore immediately into the fade-in ramp", async (t) => {
  for (const eventType of ["error", "cancel"]) {
    await t.test(eventType, async () => {
      const timers = fakeTimers();
      const context = fakeAudioContext(timers);
      const { engine } = makeEngine({ context, timers });
      await activate(engine);
      engine.handleInstruction("start", { instructionId: "nav-1" });
      timers.advance(125);
      engine.handleInstruction(eventType, { instructionId: "nav-1" });
      assert.equal(engine.state, "restoring");
      assert.ok(engine.duckGainNode.gain.events.some((event) => event.type === "ramp" && event.value === 1 && Math.abs(event.time - 1.825) < 0.001));
      context.currentTime = 1.825;
      engine.destroy();
    });
  }
});

test("element fallback performs a non-blocking fade and cleans up its animation frame", () => {
  const audio = makeAudio();
  const timers = fakeTimers();
  const engine = new AudioDuckingEngine({
    audioElement: audio,
    createAudioContext: () => { throw new Error("unavailable"); },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    now: timers.now,
    requestFrame: (callback) => timers.setTimer(() => callback(timers.now()), 16),
    cancelFrame: timers.clearTimer,
  });
  engine.handleInstruction("start", { instructionId: "nav-fallback" });
  timers.advance(16);
  assert.ok(audio.volume < 0.65 && audio.volume > 0.1625);
  timers.advance(125);
  assert.ok(audio.volume < 0.5 && audio.volume > 0.2);
  timers.advance(125);
  assert.equal(engine.state, "ducked");
  assert.ok(Math.abs(audio.volume - 0.1625) < 0.001);
  engine.handleInstruction("cancel", { instructionId: "nav-fallback" });
  timers.advance(700);
  assert.equal(engine.state, "idle");
  assert.equal(audio.volume, 0.65);
  engine.destroy();
  assert.equal(timers.count(), 0);
});

test("changing user volume during ducking uses the latest preference for the effective gain", async () => {
    const timers = fakeTimers();
    const context = fakeAudioContext(timers);
    const { engine } = makeEngine({ context, timers });
  await activate(engine);
  engine.handleInstruction("start", { instructionId: "nav-1" });
  engine.setUserVolume(0.4);
  timers.advance(250);
  assert.equal(engine.userVolume, 0.4);
  assert.equal(engine.duckGainNode.gain.value, 0.25);
  assert.equal(engine.userGainNode.gain.value, 0.4);
  assert.equal(engine.effectiveVolume, 0.1);
  engine.handleInstruction("end", { instructionId: "nav-1" });
  timers.advance(150);
  timers.advance(700);
  assert.equal(engine.userVolume, 0.4);
  assert.equal(engine.effectiveVolume, 0.4);
  engine.destroy();
});

test("mute remains silent during ducking and restores to the user's current unmuted level", async () => {
  const { engine } = makeEngine();
  await activate(engine);
  engine.setMuted(true);
  engine.handleInstruction("start", { instructionId: "nav-1" });
  assert.equal(engine.effectiveVolume, 0);
  assert.equal(engine.userGainNode.gain.value, 0);
  engine.handleInstruction("end", { instructionId: "nav-1" });
  engine.setUserVolume(0.32);
  engine.setMuted(false);
  assert.equal(engine.effectiveVolume, 0.32);
  engine.destroy();
});

test("an overlapping newer instruction owns ducking; stale end and cancel events are ignored", async () => {
  const timers = fakeTimers();
  const context = fakeAudioContext(timers);
  const { engine } = makeEngine({ context, timers });
  await activate(engine);
  engine.handleInstruction("start", { instructionId: "old" });
  engine.handleInstruction("start", { instructionId: "new" });
  engine.handleInstruction("end", { instructionId: "old" });
  engine.handleInstruction("cancel", { instructionId: "old" });
  assert.equal(engine.getSnapshot().activeInstructionId, "new");
  assert.equal(engine.state, "ducking");
  engine.handleInstruction("end", { instructionId: "new" });
  timers.advance(150);
  assert.equal(engine.state, "restoring");
  engine.destroy();
});

test("duplicate events do not restart a completed fade or release timer", async () => {
  const timers = fakeTimers();
  const context = fakeAudioContext(timers);
  const { engine } = makeEngine({ context, timers });
  await activate(engine);
  engine.handleInstruction("start", { instructionId: "same" });
  engine.handleInstruction("start", { instructionId: "same" });
  assert.equal(engine.duckGainNode.gain.events.filter((event) => event.type === "ramp" && event.value === 0.25).length, 1);
  const timerCountBeforeEnd = timers.count();
  engine.handleInstruction("end", { instructionId: "same" });
  const timerCountAfterFirstEnd = timers.count();
  engine.handleInstruction("end", { instructionId: "same" });
  assert.equal(timers.count(), timerCountAfterFirstEnd);
  assert.ok(timerCountBeforeEnd < timerCountAfterFirstEnd);
  timers.advance(150);
  assert.equal(engine.state, "restoring");
  context.currentTime = 1.7;
  engine.destroy();
});

test("navigation stop resets to normal and room teardown closes the local audio graph", async () => {
  const timers = fakeTimers();
  const context = fakeAudioContext(timers);
  const { engine, audio } = makeEngine({ context, timers });
  await activate(engine);
  engine.handleInstruction("start", { instructionId: "nav-1" });
  engine.reset({ immediate: true });
  assert.equal(engine.state, "idle");
  assert.equal(engine.duckingGain, 1);
  engine.destroy();
  assert.equal(context.closeCalled, true);
  assert.equal(audio.volume, 0.65);
  assert.equal(audio.__ridelinkAudioDucking, undefined);
});

test("two riders have separate local gain graphs; shared playback position and remote audio stay untouched", async () => {
  const audioA = makeAudio();
  const audioB = makeAudio();
  const remoteVoice = { volume: 0.8, currentTime: 9 };
  const riderTimersA = fakeTimers();
  const riderTimersB = fakeTimers();
  const riderA = makeEngine({ audio: audioA, context: fakeAudioContext(riderTimersA), timers: riderTimersA });
  const riderB = makeEngine({ audio: audioB, context: fakeAudioContext(riderTimersB), timers: riderTimersB });
  await Promise.all([activate(riderA.engine), activate(riderB.engine)]);
  riderA.engine.handleInstruction("start", { instructionId: "nav-a" });
  riderTimersA.advance(250);
  riderTimersB.advance(250);
  assert.equal(riderA.engine.effectiveVolume, 0.1625);
  assert.equal(riderB.engine.effectiveVolume, 0.65);
  assert.equal(audioA.currentTime, 3);
  assert.equal(audioB.currentTime, 3);
  assert.deepEqual(remoteVoice, { volume: 0.8, currentTime: 9 });
  riderA.engine.destroy();
  riderB.engine.destroy();
});

test("graph suspension resumes its scheduled fade only after an explicit audio gesture", async () => {
  const timers = fakeTimers();
  const context = fakeAudioContext(timers);
  const { engine } = makeEngine({ context, timers });
  await activate(engine);
  engine.handleInstruction("start", { instructionId: "nav-1" });
  context.state = "suspended";
  context.currentTime = 1.1;
  context.dispatch("statechange");
  assert.equal(timers.count(), 0);
  context.currentTime = 1.1;
  context.state = "running";
  context.dispatch("statechange");
  assert.equal(timers.count(), 1);
  timers.advance(250);
  assert.equal(engine.state, "ducked");
  engine.destroy();
});
