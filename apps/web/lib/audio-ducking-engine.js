const DEFAULTS = Object.freeze({ duckingTargetGain: 0.25, fadeOutDurationMs: 250, fadeInDurationMs: 700, releaseHoldMs: 150 });

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, Number(value) || 0));

function fallbackFrame(callback) {
  return setTimeout(() => callback(Date.now()), 16);
}

/** Local-only music gain controller. It never receives or changes WebRTC audio. */
export class AudioDuckingEngine {
  constructor({
    audioElement,
    createAudioContext = () => new (globalThis.AudioContext || globalThis.webkitAudioContext)(),
    requestFrame = globalThis.requestAnimationFrame?.bind(globalThis) || fallbackFrame,
    cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis) || clearTimeout,
    setTimer = (...args) => globalThis.setTimeout(...args),
    clearTimer = (...args) => globalThis.clearTimeout(...args),
    now = () => globalThis.performance?.now?.() ?? Date.now(),
    onState = () => {},
    config = {},
  }) {
    this.audioElement = audioElement;
    this.createAudioContext = createAudioContext;
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.now = now;
    this.onState = onState;
    this.config = { ...DEFAULTS, ...config };
    this.userVolume = 0.65;
    this.muted = false;
    this.duckingGain = 1;
    this.state = "idle";
    this.mode = "element";
    this.audioContext = null;
    this.sourceNode = null;
    this.userGainNode = null;
    this.duckGainNode = null;
    this.outputAnalyser = null;
    this.activeInstructionId = null;
    this.transition = null;
    this.frameId = null;
    this.releaseTimer = null;
    this.transitionTimer = null;
    this.destroyed = false;
    this.handleContextStateChange = () => {
      this.#scheduleGraphTransition();
      this.#publish();
    };
    this.#renderOutput();
  }

  get effectiveVolume() {
    return this.muted ? 0 : clamp(this.userVolume * this.duckingGain, 0, 1);
  }

  getSnapshot() {
    return {
      state: this.state,
      mode: this.mode,
      duckingGain: this.duckingGain,
      userVolume: this.userVolume,
      effectiveVolume: this.effectiveVolume,
      muted: this.muted,
      audioContextState: this.audioContext?.state || "uninitialized",
      activeInstructionId: this.activeInstructionId,
    };
  }

  setUserVolume(value) {
    this.userVolume = clamp(value, 0, 1);
    if (this.userGainNode && this.audioContext) {
      const parameter = this.userGainNode.gain;
      parameter.cancelScheduledValues?.(this.audioContext.currentTime);
      parameter.setValueAtTime?.(this.muted ? 0 : this.userVolume, this.audioContext.currentTime);
      if (!parameter.setValueAtTime) parameter.value = this.muted ? 0 : this.userVolume;
    }
    this.#renderOutput();
    this.#publish();
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.userGainNode && this.audioContext) {
      const parameter = this.userGainNode.gain;
      parameter.cancelScheduledValues?.(this.audioContext.currentTime);
      parameter.setValueAtTime?.(this.muted ? 0 : this.userVolume, this.audioContext.currentTime);
      if (!parameter.setValueAtTime) parameter.value = this.muted ? 0 : this.userVolume;
    }
    this.#renderOutput();
    this.#publish();
  }

  /** Must be called from a user gesture. Both resume() and play() are invoked before yielding. */
  activateFromGesture({ play = false } = {}) {
    if (this.destroyed) return Promise.reject(new Error("Audio mixer is closed."));
    this.#ensureGraph();
    let resumePromise = Promise.resolve();
    let playPromise = Promise.resolve();
    try {
      if (this.audioContext?.state === "suspended") resumePromise = this.audioContext.resume();
      if (play && this.audioElement) playPromise = this.audioElement.play();
    } catch (error) {
      return Promise.reject(error);
    }
    this.audioContext?.addEventListener?.("statechange", this.handleContextStateChange);
    this.#publish();
    return Promise.all([resumePromise, playPromise]).then(() => this.getSnapshot());
  }

  handleInstruction(type, detail = {}) {
    if (this.destroyed) return;
    const instructionId = typeof detail.instructionId === "string" ? detail.instructionId : null;
    if (type === "start") {
      if (!instructionId || this.activeInstructionId === instructionId) return;
      this.#clearReleaseTimer();
      this.activeInstructionId = instructionId;
      this.#transitionTo(this.config.duckingTargetGain, this.config.fadeOutDurationMs, "ducking", "ducked");
      return;
    }
    if (!["end", "error", "cancel"].includes(type)) return;
    if (instructionId && instructionId !== this.activeInstructionId) return;
    if (!this.activeInstructionId && instructionId) return;
    this.activeInstructionId = null;
    this.#clearReleaseTimer();
    if (type === "end" && this.config.releaseHoldMs > 0) {
      const generation = this.transition?.generation ?? 0;
      this.releaseTimer = this.setTimer(() => {
        this.releaseTimer = null;
        if (this.destroyed || this.activeInstructionId || generation !== (this.transition?.generation ?? 0)) return;
        this.#transitionTo(1, this.config.fadeInDurationMs, "restoring", "idle");
      }, this.config.releaseHoldMs);
      return;
    }
    this.#transitionTo(1, this.config.fadeInDurationMs, "restoring", "idle");
  }

  /** Force restoration for navigation stop or room close. */
  reset({ immediate = false } = {}) {
    if (this.destroyed) return;
    this.#clearReleaseTimer();
    this.activeInstructionId = null;
    this.#transitionTo(1, immediate ? 0 : this.config.fadeInDurationMs, immediate ? "idle" : "restoring", "idle");
  }

  destroy() {
    if (this.destroyed) return;
    this.#clearReleaseTimer();
    if (this.frameId !== null) this.cancelFrame(this.frameId);
    this.frameId = null;
    if (this.transitionTimer !== null) this.clearTimer(this.transitionTimer);
    this.transitionTimer = null;
    this.activeInstructionId = null;
    this.transition = null;
    this.duckingGain = 1;
    this.state = "idle";
    if (this.audioElement) {
      this.audioElement.volume = this.userVolume;
      this.audioElement.muted = this.muted || this.userVolume === 0;
      try { delete this.audioElement.__ridelinkAudioDucking; } catch { /* Diagnostic hook is optional. */ }
    }
    this.audioContext?.removeEventListener?.("statechange", this.handleContextStateChange);
    try { this.sourceNode?.disconnect(); } catch { /* Already disconnected. */ }
    try { this.userGainNode?.disconnect(); } catch { /* Already disconnected. */ }
    try { this.duckGainNode?.disconnect(); } catch { /* Already disconnected. */ }
    try { this.outputAnalyser?.disconnect(); } catch { /* Already disconnected. */ }
    if (this.audioContext && this.audioContext.state !== "closed") void this.audioContext.close().catch(() => {});
    this.destroyed = true;
    this.#publish();
  }

  #ensureGraph() {
    if (this.mode === "webaudio" || !this.audioElement || typeof this.createAudioContext !== "function") return;
    let context;
    try {
      const previousTransition = this.transition;
      const previousGain = this.#currentGain();
      const remainingTransitionMs = previousTransition
        ? Math.max(0, previousTransition.durationMs - (this.#clockNow() - previousTransition.startedAt))
        : 0;
      context = this.createAudioContext();
      if (!context?.createMediaElementSource || !context?.createGain) throw new Error("Web Audio graph unavailable.");
      const source = context.createMediaElementSource(this.audioElement);
      const userGain = context.createGain();
      const duckGain = context.createGain();
      const analyser = typeof context.createAnalyser === "function" ? context.createAnalyser() : null;
      source.connect(userGain);
      userGain.connect(duckGain);
      if (analyser) {
        analyser.fftSize = 2048;
        duckGain.connect(analyser);
        analyser.connect(context.destination);
      } else {
        duckGain.connect(context.destination);
      }
      userGain.gain.value = this.muted ? 0 : this.userVolume;
      duckGain.gain.value = previousGain;
      this.audioContext = context;
      this.sourceNode = source;
      this.userGainNode = userGain;
      this.duckGainNode = duckGain;
      this.outputAnalyser = analyser;
      this.mode = "webaudio";
      this.duckingGain = previousGain;
      if (previousTransition && remainingTransitionMs > 0) {
        this.transition = { ...previousTransition, from: previousGain, startedAt: context.currentTime * 1000, durationMs: remainingTransitionMs };
      }
      context.addEventListener?.("statechange", this.handleContextStateChange);
      // In the graph, these GainNodes own local volume and navigation ducking.
      this.audioElement.volume = 1;
      this.audioElement.muted = false;
      const engine = this;
      Object.defineProperty(this.audioElement, "__ridelinkAudioDucking", {
        configurable: true,
        value: {
          get userGainNode() { return userGain; },
          get duckGainNode() { return duckGain; },
          get audioContext() { return context; },
          get muted() { return engine.muted; },
          get userVolume() { return engine.userVolume; },
          get duckingGain() { return engine.duckingGain; },
          get effectiveVolume() { return this.userGainNode.gain.value * this.duckGainNode.gain.value; },
          measureOutputRms() {
            if (!analyser) return null;
            const samples = new Float32Array(analyser.fftSize);
            analyser.getFloatTimeDomainData(samples);
            let sum = 0;
            for (const sample of samples) sum += sample * sample;
            return Math.sqrt(sum / samples.length);
          },
        },
      });
      this.#scheduleGraphTransition();
    } catch {
      // A graph setup failure may already have associated a source with the element.
      // Keep the media audible and use the element volume fallback rather than silence.
      if (context && context.state !== "closed") void context.close().catch(() => {});
      this.mode = "element";
      this.#renderOutput();
    }
    this.#publish();
  }

  #transitionTo(target, durationMs, activeState, settledState) {
    const from = this.#currentGain();
    const generation = (this.transition?.generation ?? 0) + 1;
    if (this.transitionTimer !== null) this.clearTimer(this.transitionTimer);
    this.transitionTimer = null;
    if (this.frameId !== null) this.cancelFrame(this.frameId);
    this.frameId = null;
    const duration = Math.max(0, Number(durationMs) || 0);
    if (this.audioContext && this.duckGainNode) {
      const parameter = this.duckGainNode.gain;
      const now = this.audioContext.currentTime;
      parameter.cancelScheduledValues?.(now);
      parameter.setValueAtTime?.(from, now);
      if (duration > 0) parameter.linearRampToValueAtTime(target, now + duration / 1000);
      else parameter.setValueAtTime?.(target, now);
      if (!parameter.setValueAtTime) parameter.value = target;
    }
    if (duration === 0 || Math.abs(target - from) < 0.0001) {
      this.duckingGain = target;
      this.transition = null;
      this.state = settledState;
      this.#renderOutput();
      this.#publish();
      return;
    }
    this.transition = { from, target, startedAt: this.#clockNow(), durationMs: duration, generation, settledState };
    this.state = activeState;
    this.#renderOutput();
    this.#publish();
    if (this.mode === "element") this.#scheduleFallbackFrame(generation);
    else this.#scheduleGraphTransition();
  }

  #scheduleFallbackFrame(generation) {
    this.frameId = this.requestFrame(() => {
      this.frameId = null;
      if (this.destroyed || this.transition?.generation !== generation) return;
      const transition = this.transition;
      this.duckingGain = this.#currentGain();
      this.#renderOutput();
      if (this.transition && this.transition.generation === generation) this.#scheduleFallbackFrame(generation);
      else { this.state = transition.settledState; this.#publish(); }
    });
  }

  #scheduleGraphTransition() {
    const transition = this.transition;
    if (this.destroyed || this.mode !== "webaudio" || !transition || !this.audioContext) return;
    if (this.transitionTimer !== null) this.clearTimer(this.transitionTimer);
    this.transitionTimer = null;
    if (this.audioContext.state !== "running") return;
    const elapsed = Math.max(0, this.audioContext.currentTime * 1000 - transition.startedAt);
    const remaining = transition.durationMs - elapsed;
    if (remaining <= 0) {
      this.#finishTransition(transition.generation);
      return;
    }
    this.transitionTimer = this.setTimer(() => {
      this.transitionTimer = null;
      this.#scheduleGraphTransition();
    }, remaining);
  }

  #finishTransition(generation) {
    if (this.destroyed || this.transition?.generation !== generation) return;
    const { target, settledState } = this.transition;
    this.duckingGain = target;
    this.transition = null;
    this.state = settledState;
    this.#renderOutput();
    this.#publish();
  }

  #currentGain() {
    const transition = this.transition;
    if (!transition) return this.duckingGain;
    const progress = clamp((this.#clockNow() - transition.startedAt) / transition.durationMs, 0, 1);
    const gain = transition.from + (transition.target - transition.from) * progress;
    if (progress >= 1) {
      this.duckingGain = transition.target;
      this.transition = null;
      return this.duckingGain;
    }
    return gain;
  }

  #clockNow() {
    return this.audioContext ? this.audioContext.currentTime * 1000 : this.now();
  }

  #renderOutput() {
    if (!this.audioElement) return;
    if (this.mode === "webaudio") {
      this.audioElement.volume = 1;
      this.audioElement.muted = false;
    } else {
      this.audioElement.volume = this.effectiveVolume;
      this.audioElement.muted = this.muted || this.userVolume === 0;
    }
    const snapshot = this.getSnapshot();
    if (this.audioElement.dataset) {
      this.audioElement.dataset.effectiveVolume = String(snapshot.effectiveVolume);
      this.audioElement.dataset.duckingGain = String(snapshot.duckingGain);
      this.audioElement.dataset.duckingState = snapshot.state;
    }
  }

  #publish() {
    if (!this.destroyed) this.onState(this.getSnapshot());
  }

  #clearReleaseTimer() {
    if (this.releaseTimer !== null) this.clearTimer(this.releaseTimer);
    this.releaseTimer = null;
  }
}
