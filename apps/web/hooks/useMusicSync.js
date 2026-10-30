"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { roomClient } from "../lib/room-client.js";

const DRIFT_THRESHOLD_SECONDS = 0.75;
const CORRECTION_COOLDOWN_MS = 2500;

function statePosition(state, serverClockOffset) {
  if (!state?.isPlaying) return state?.positionSeconds ?? 0;
  const estimatedServerNow = Date.now() + serverClockOffset;
  const elapsed = Math.max(0, estimatedServerNow - state.updatedAt) / 1000;
  const duration = state.playlist.find((track) => track.trackId === state.trackId)?.durationSeconds ?? Infinity;
  return Math.min(duration, state.positionSeconds + elapsed);
}

export function useMusicSync({ room, signalingStatus, audioRef, audioDucking }) {
  const activateAudio = audioDucking.activateAudio;
  const [musicState, setMusicState] = useState(room?.musicState ?? null);
  const [syncStatus, setSyncStatus] = useState("synchronizing");
  const [error, setError] = useState("");
  const [positionSeconds, setPositionSeconds] = useState(room?.musicState?.positionSeconds ?? 0);
  const stateRef = useRef(musicState);
  const serverClockOffsetRef = useRef(0);
  const lastCorrectionAtRef = useRef(0);
  const currentSourceRef = useRef("");
  const endedRevisionRef = useRef(null);

  const acceptState = useCallback((nextState) => {
    if (!nextState || (stateRef.current && nextState.revision < stateRef.current.revision)) return;
    if (!stateRef.current || nextState.revision > stateRef.current.revision || nextState.trackId !== stateRef.current.trackId) {
      lastCorrectionAtRef.current = 0;
    }
    stateRef.current = nextState;
    setMusicState(nextState);
    setPositionSeconds(statePosition(nextState, serverClockOffsetRef.current));
    setSyncStatus("synchronizing");
    setError("");
  }, []);

  const refreshState = useCallback(async () => {
    const requestStartedAt = Date.now();
    try {
      const result = await roomClient.command("music:get-state");
      const receivedAt = Date.now();
      const state = result.state;
      serverClockOffsetRef.current = state.updatedAt - (requestStartedAt + receivedAt) / 2;
      acceptState(state);
    } catch (reason) {
      setSyncStatus("offline");
      setError(reason.message || "State musik belum dapat disinkronkan.");
    }
  }, [acceptState]);

  useEffect(() => {
    if (room?.musicState) acceptState(room.musicState);
  }, [acceptState, room?.musicState]);

  useEffect(() => {
    const audio = audioRef.current;
    const unsubscribeState = roomClient.on("music:state", (payload) => acceptState(payload.state));
    const unsubscribeError = roomClient.on("music:error", (payload) => {
      setError(payload.message || "Perintah musik ditolak.");
      if (payload.code === "MUSIC_CONFLICT") void refreshState();
    });
    const unsubscribeClosed = roomClient.on("room:closed", () => {
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      currentSourceRef.current = "";
      stateRef.current = null;
      setMusicState(null);
      setPositionSeconds(0);
      setSyncStatus("offline");
    });
    return () => {
      unsubscribeState();
      unsubscribeError();
      unsubscribeClosed();
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      currentSourceRef.current = "";
    };
  }, [acceptState, audioRef, refreshState]);

  const roomCode = room?.roomCode;
  useEffect(() => {
    if (!roomCode || signalingStatus !== "connected") return undefined;
    const timer = setTimeout(() => { void refreshState(); }, 0);
    return () => clearTimeout(timer);
  }, [roomCode, signalingStatus, refreshState]);

  const currentTrack = musicState?.playlist.find((track) => track.trackId === musicState.trackId) ?? null;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    if (!currentTrack.sourceUrl?.startsWith("/audio/")) return;
    const sourceUrl = new URL(currentTrack.sourceUrl, window.location.origin);
    if (sourceUrl.origin !== window.location.origin) return;
    const source = sourceUrl.href;
    if (currentSourceRef.current === source) return;
    currentSourceRef.current = source;
    audio.src = source;
    audio.load();
  }, [audioRef, currentTrack]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack || !musicState) return;
    const syncPosition = () => {
      if (audio.readyState < 1) return;
      const expected = statePosition(stateRef.current, serverClockOffsetRef.current);
      const drift = expected - audio.currentTime;
      const now = Date.now();
      if (Math.abs(drift) >= DRIFT_THRESHOLD_SECONDS && now - lastCorrectionAtRef.current >= CORRECTION_COOLDOWN_MS) {
        try {
          audio.currentTime = expected;
          lastCorrectionAtRef.current = now;
        } catch {
          setSyncStatus("buffering");
        }
      }
      setPositionSeconds(audio.currentTime || expected);
    };
    const syncAfterLoad = () => {
      lastCorrectionAtRef.current = 0;
      syncPosition();
    };
    audio.addEventListener("loadedmetadata", syncAfterLoad);
    const timer = setInterval(syncPosition, 1000);
    syncPosition();

    if (musicState.isPlaying) {
      void audio.play().then(() => setSyncStatus(audio.readyState < 3 ? "buffering" : "synced")).catch(() => {
        setSyncStatus("autoplay-blocked");
      });
    } else {
      audio.pause();
      if (audio.readyState >= 1) {
        const expected = statePosition(musicState, serverClockOffsetRef.current);
        if (Math.abs(audio.currentTime - expected) >= DRIFT_THRESHOLD_SECONDS) audio.currentTime = expected;
      }
    }
    return () => {
      audio.removeEventListener("loadedmetadata", syncAfterLoad);
      clearInterval(timer);
    };
  }, [audioRef, currentTrack, musicState]);

  const sendCommand = useCallback(async (event, extra = {}) => {
    const current = stateRef.current;
    if (!current) return;
    setError("");
    try {
      const result = await roomClient.command(event, { expectedRevision: current.revision, ...extra });
      acceptState(result.state);
    } catch (reason) {
      setError(reason.message || "Perintah musik gagal.");
      if (reason.code === "MUSIC_CONFLICT") void refreshState();
    }
  }, [acceptState, refreshState]);

  const play = useCallback(() => {
    void activateAudio({ play: true }).catch(() => setSyncStatus("autoplay-blocked"));
    void sendCommand("music:play");
  }, [activateAudio, sendCommand]);
  const pause = useCallback(() => { void sendCommand("music:pause"); }, [sendCommand]);
  const next = useCallback(() => { void sendCommand("music:next"); }, [sendCommand]);
  const previous = useCallback(() => { void sendCommand("music:previous"); }, [sendCommand]);
  const selectTrack = useCallback((trackId) => { void sendCommand("music:select", { trackId }); }, [sendCommand]);
  const seek = useCallback((seconds) => {
    const value = Number(seconds);
    if (Number.isFinite(value)) void sendCommand("music:seek", { positionSeconds: value });
  }, [sendCommand]);
  const enablePlayback = useCallback(async () => {
    try {
      await activateAudio({ play: true });
      setSyncStatus("synced");
    } catch {
      setSyncStatus("autoplay-blocked");
    }
  }, [activateAudio]);

  const onEnded = useCallback(() => {
    const current = stateRef.current;
    if (current?.isPlaying && endedRevisionRef.current !== current.revision) {
      endedRevisionRef.current = current.revision;
      void sendCommand("music:next");
    }
  }, [sendCommand]);

  return {
    musicState,
    currentTrack,
    positionSeconds,
    syncStatus,
    error,
    userVolume: audioDucking.userVolume,
    localMuted: audioDucking.localMuted,
    setUserVolume: audioDucking.setUserVolume,
    setLocalMuted: audioDucking.setLocalMuted,
    duckingState: audioDucking.duckingState,
    duckingGain: audioDucking.duckingGain,
    effectiveVolume: audioDucking.effectiveVolume,
    audioMode: audioDucking.audioMode,
    audioContextState: audioDucking.audioContextState,
    play,
    pause,
    next,
    previous,
    seek,
    selectTrack,
    enablePlayback,
    onEnded,
    onBuffering: () => setSyncStatus("buffering"),
    onPlaying: () => setSyncStatus("synced"),
    onPaused: () => { if (!stateRef.current?.isPlaying) setSyncStatus("synced"); },
    onCanPlay: () => { if (!stateRef.current?.isPlaying) setSyncStatus("synced"); },
    onMediaError: () => { setSyncStatus("error"); setError("Audio demo tidak dapat dimuat. Periksa koneksi atau sumber file."); },
  };
}
