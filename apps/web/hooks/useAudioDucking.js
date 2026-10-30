"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioDuckingEngine } from "../lib/audio-ducking-engine.js";
import { onInstructionEvent } from "../lib/navigation/instruction-events.js";
import { roomClient } from "../lib/room-client.js";

const VOLUME_KEY = "ridelink.music.user-volume";

function readSavedVolume() {
  try {
    const saved = localStorage.getItem(VOLUME_KEY);
    if (saved === null) return 0.65;
    const value = Number(saved);
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.65;
  } catch {
    return 0.65;
  }
}

export function useAudioDucking({ audioRef }) {
  const engineRef = useRef(null);
  const [userVolume, setVolume] = useState(readSavedVolume);
  const [localMuted, setLocalMuted] = useState(false);
  const [ducking, setDucking] = useState({
    state: "idle",
    duckingGain: 1,
    effectiveVolume: userVolume,
    mode: "element",
    audioContextState: "uninitialized",
  });

  useEffect(() => {
    const engine = new AudioDuckingEngine({
      audioElement: audioRef.current,
      onState: (next) => setDucking({ ...next }),
    });
    engineRef.current = engine;
    const unsubscribers = [
      ...["start", "end", "error", "cancel"].map((type) => onInstructionEvent(type, (event) => engine.handleInstruction(type, event.detail || {}))),
      roomClient.on("room:closed", () => engine.reset()),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [audioRef]);

  useEffect(() => {
    engineRef.current?.setUserVolume(userVolume);
    try { localStorage.setItem(VOLUME_KEY, String(userVolume)); } catch { /* Keep the local preference in memory. */ }
  }, [userVolume]);

  useEffect(() => {
    engineRef.current?.setMuted(localMuted);
  }, [localMuted]);

  const setUserVolume = useCallback((value) => {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) setVolume(Math.max(0, Math.min(1, parsed)));
  }, []);
  const activateAudio = useCallback((options) => engineRef.current?.activateFromGesture(options) ?? Promise.resolve(), []);
  const stopDucking = useCallback((options) => engineRef.current?.reset(options), []);

  return {
    userVolume,
    setUserVolume,
    localMuted,
    setLocalMuted,
    duckingState: ducking.state,
    duckingGain: ducking.duckingGain,
    effectiveVolume: localMuted ? 0 : Math.max(0, Math.min(1, userVolume * ducking.duckingGain)),
    audioMode: ducking.mode,
    audioContextState: ducking.audioContextState,
    activateAudio,
    stopDucking,
  };
}
