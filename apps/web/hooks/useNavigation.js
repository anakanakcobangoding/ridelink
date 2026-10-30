"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { emitInstructionEvent } from "../lib/navigation/instruction-events.js";
import { isValidCoordinate, projectProgress } from "../lib/navigation/route-normalizer.js";

const INITIAL = { permission: "idle", tracking: false, location: null, accuracy: null, error: "", route: null, progress: null, searching: false, calculating: false, rerouting: false, destination: null, speech: "unknown", offRouteSamples: 0 };
const formatDistance = (meters) => meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.max(0, Math.round(meters))} meter`;

function announcement(progress) {
  if (!progress) return "";
  if (progress.arrived) return "Anda telah tiba di tujuan.";
  const step = progress.nextManeuver;
  if (!step || step.maneuverType === "arrive") return "Lanjutkan perjalanan.";
  const distance = Math.max(50, Math.round(step.distanceToManeuverMeters / 50) * 50);
  const action = step.instruction?.trim() || "Lanjutkan perjalanan.";
  return `Dalam ${distance} meter, ${action}`;
}

export function useNavigation() {
  const [state, setState] = useState(INITIAL);
  const watcherRef = useRef(null);
  const lastPositionRef = useRef(null);
  const routeAbortRef = useRef(null);
  const searchAbortRef = useRef(null);
  const offRouteRef = useRef(0);
  const rerouteAtRef = useRef(0);
  const lastAnnouncementRef = useRef("");
  const utteranceRef = useRef(null);
  const instructionSequenceRef = useRef(0);

  const cancelInstruction = useCallback(() => {
    const active = utteranceRef.current;
    utteranceRef.current = null;
    if (active?._ridelinkTimer) clearTimeout(active._ridelinkTimer);
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    if (active?._ridelinkStarted) emitInstructionEvent("cancel", { instructionId: active._ridelinkInstructionId, source: "navigation" });
  }, []);

  const speak = useCallback((text) => {
    if (!text || typeof window === "undefined") return;
    const speech = window.speechSynthesis;
    if (!speech || typeof window.SpeechSynthesisUtterance !== "function") {
      emitInstructionEvent("error", { code: "SPEECH_UNAVAILABLE" });
      setState((current) => ({ ...current, speech: "unavailable" }));
      return;
    }
    cancelInstruction();
    const utterance = new SpeechSynthesisUtterance(text);
    const instructionId = `${Date.now()}-${++instructionSequenceRef.current}`;
    utterance._ridelinkInstructionId = instructionId;
    utterance.lang = "id-ID";
    utterance.rate = 0.95;
    utteranceRef.current = utterance;
    utterance.onstart = () => { utterance._ridelinkStarted = true; emitInstructionEvent("start", { instructionId, language: utterance.lang }); };
    utterance.onend = () => {
      if (utteranceRef.current !== utterance) return;
      clearTimeout(utterance._ridelinkTimer);
      utteranceRef.current = null;
      emitInstructionEvent("end", { instructionId, language: utterance.lang });
    };
    utterance.onerror = (event) => {
      if (utteranceRef.current !== utterance) return;
      clearTimeout(utterance._ridelinkTimer);
      utteranceRef.current = null;
      emitInstructionEvent("error", { instructionId, code: event.error || "SPEECH_ERROR" });
    };
    try {
      utterance._ridelinkTimer = setTimeout(() => {
        if (utteranceRef.current !== utterance) return;
        utteranceRef.current = null;
        window.speechSynthesis.cancel();
        emitInstructionEvent("error", { instructionId, code: "SPEECH_TIMEOUT" });
      }, Math.min(30_000, Math.max(8_000, text.length * 140)));
      speech.speak(utterance);
      setState((current) => ({ ...current, speech: speech.getVoices().some((voice) => voice.lang.toLowerCase().startsWith("id")) ? "id-available" : "fallback" }));
    } catch {
      clearTimeout(utterance._ridelinkTimer);
      utteranceRef.current = null;
      emitInstructionEvent("error", { instructionId, code: "SPEECH_ERROR" });
    }
  }, [cancelInstruction]);

  const calculateRoute = useCallback(async (start, end, isReroute = false) => {
    if (!isValidCoordinate(start) || !isValidCoordinate(end)) return;
    cancelInstruction();
    routeAbortRef.current?.abort();
    const controller = new AbortController();
    routeAbortRef.current = controller;
    setState((current) => ({ ...current, calculating: !isReroute, rerouting: isReroute, error: "" }));
    try {
      const response = await fetch("/api/navigation/route", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ start, end }), signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message || "Rute belum tersedia.");
      setState((current) => ({ ...current, route: body.route, destination: { ...current.destination, coordinates: end }, progress: projectProgress(body.route, start), calculating: false, rerouting: false, error: "" }));
      offRouteRef.current = 0;
      rerouteAtRef.current = isReroute ? Date.now() : Date.now() - 45_000;
      lastAnnouncementRef.current = "";
    } catch (error) {
      if (error.name !== "AbortError") setState((current) => ({ ...current, calculating: false, rerouting: false, error: error.message || "Rute belum tersedia." }));
    }
  }, [cancelInstruction]);

  const updatePosition = useCallback((position) => {
    const coordinate = [position.coords.longitude, position.coords.latitude];
    if (!isValidCoordinate(coordinate)) return;
    lastPositionRef.current = { coordinate, accuracy: position.coords.accuracy, timestamp: position.timestamp };
    setState((current) => {
      const minimumDistance = current.progress ? Math.max(0, current.progress.distanceAlongMeters - Math.max(15, position.coords.accuracy || 0)) : 0;
      const progress = current.route ? projectProgress(current.route, coordinate, minimumDistance) : null;
      return { ...current, permission: "granted", tracking: true, location: coordinate, accuracy: position.coords.accuracy, error: "", progress, offRouteSamples: current.offRouteSamples };
    });
  }, []);

  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      setState((current) => ({ ...current, permission: "unavailable", error: "Geolocation tidak tersedia di browser ini." }));
      return;
    }
    if (watcherRef.current !== null) return;
    setState((current) => ({ ...current, permission: "requesting", error: "" }));
    watcherRef.current = navigator.geolocation.watchPosition(updatePosition, (error) => {
      const permission = error.code === 1 ? "denied" : "unavailable";
      const message = error.code === 1 ? "Izin lokasi ditolak. Ubah izin lokasi Safari untuk RideLink." : error.code === 3 ? "GPS timeout. Coba di area terbuka." : "Lokasi GPS belum tersedia.";
      setState((current) => ({ ...current, permission, tracking: false, error: message }));
    }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20_000 });
  }, [updatePosition]);

  const stopTracking = useCallback(() => {
    if (watcherRef.current !== null) navigator.geolocation?.clearWatch(watcherRef.current);
    watcherRef.current = null;
    cancelInstruction();
    setState((current) => ({ ...current, tracking: false }));
  }, [cancelInstruction]);

  const selectDestination = useCallback((place) => {
    if (!isValidCoordinate(place?.coordinates)) return;
    cancelInstruction();
    setState((current) => ({ ...current, destination: { label: place.label || "Titik pada peta", coordinates: place.coordinates } }));
  }, [cancelInstruction]);

  const search = useCallback(async (query) => {
    if (query.trim().length < 3) return [];
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setState((current) => ({ ...current, searching: true, error: "" }));
    try {
      const params = new URLSearchParams({ q: query.trim() });
      if (lastPositionRef.current) {
        params.set("lon", String(lastPositionRef.current.coordinate[0]));
        params.set("lat", String(lastPositionRef.current.coordinate[1]));
      }
      const response = await fetch(`/api/navigation/geocode?${params}`, { signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message || "Pencarian tidak tersedia.");
      return body.places || [];
    } catch (error) {
      if (error.name !== "AbortError") setState((current) => ({ ...current, error: error.message }));
      return [];
    } finally { if (searchAbortRef.current === controller) setState((current) => ({ ...current, searching: false })); }
  }, []);

  useEffect(() => {
    if (!state.route || !state.location || !state.progress) return;
    const message = announcement(state.progress);
    if (message && message !== lastAnnouncementRef.current && (state.progress.arrived || (state.progress.nextManeuver && state.progress.nextManeuver.distanceToManeuverMeters <= 350))) {
      lastAnnouncementRef.current = message;
      speak(message);
    }
    const accuracy = state.accuracy || 100;
    const threshold = Math.max(45, Math.min(100, accuracy * 1.8));
    if (state.progress.distance > threshold && accuracy <= 65) offRouteRef.current += 1;
    else offRouteRef.current = 0;
    setState((current) => current.offRouteSamples === offRouteRef.current ? current : ({ ...current, offRouteSamples: offRouteRef.current }));
    if (offRouteRef.current >= 3 && state.destination && Date.now() - rerouteAtRef.current > 45_000) {
      offRouteRef.current = 0;
      rerouteAtRef.current = Date.now();
      void calculateRoute(state.location, state.destination.coordinates, true);
    }
  }, [calculateRoute, speak, state.accuracy, state.destination, state.location, state.progress, state.route]);

  useEffect(() => () => {
    if (watcherRef.current !== null) navigator.geolocation?.clearWatch(watcherRef.current);
    routeAbortRef.current?.abort();
    searchAbortRef.current?.abort();
    const activeInstruction = utteranceRef.current;
    utteranceRef.current = null;
    if (activeInstruction?._ridelinkTimer) clearTimeout(activeInstruction._ridelinkTimer);
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    if (activeInstruction?._ridelinkStarted) emitInstructionEvent("cancel", { instructionId: activeInstruction._ridelinkInstructionId, source: "navigation" });
  }, []);

  const confirmDestination = useCallback(() => {
    const start = lastPositionRef.current?.coordinate;
    if (!start) {
      setState((current) => ({ ...current, error: "Aktifkan GPS sebelum menghitung rute." }));
      return;
    }
    if (!state.destination) {
      setState((current) => ({ ...current, error: "Pilih tujuan melalui pencarian atau sentuh peta." }));
      return;
    }
    void calculateRoute(start, state.destination.coordinates);
  }, [calculateRoute, state.destination]);

  return { ...state, startTracking, stopTracking, selectDestination, calculateRoute, confirmDestination, search, speak, cancelInstruction, currentPosition: lastPositionRef.current, formatDistance };
}
