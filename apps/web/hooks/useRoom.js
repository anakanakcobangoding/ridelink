"use client";

import { useCallback, useEffect, useState } from "react";
import { roomClient } from "../lib/room-client.js";

export function useRoom(roomCode) {
  const [room, setRoom] = useState(null);
  const [currentParticipantId, setCurrentParticipantId] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [closed, setClosed] = useState(false);

  const restore = useCallback(async () => {
    try {
      const restored = await roomClient.restoreRoom(roomCode);
      setRoom(restored.room);
      setCurrentParticipantId(restored.participantId);
      setConnectionStatus("connected");
      setError("");
      setClosed(false);
    } catch (reason) {
      setError(reason.message || "Tidak dapat memulihkan room.");
      setConnectionStatus(reason.code === "SESSION_MISSING" ? "disconnected" : "reconnecting");
      if (["ROOM_EXPIRED", "ROOM_NOT_FOUND", "UNAUTHORIZED"].includes(reason.code)) setClosed(true);
    } finally {
      setLoading(false);
    }
  }, [roomCode]);

  useEffect(() => {
    let disposed = false;
    const unsubscribers = [];
    const listen = (event, handler) => unsubscribers.push(roomClient.on(event, (...args) => { if (!disposed) handler(...args); }));

    listen("connect", () => { void restore(); });
    listen("disconnect", (reason) => {
      if (reason === "io server disconnect") {
        setConnectionStatus("disconnected");
        setError("Koneksi sesi ini ditutup oleh server. Kembali ke beranda untuk bergabung lagi.");
      } else {
        setConnectionStatus("reconnecting");
      }
    });
    listen("connect_error", () => {
      setConnectionStatus("reconnecting");
      setError("Tidak dapat tersambung ke signaling. Memeriksa koneksi kembali…");
      setLoading(false);
    });
    listen("room:state", (nextRoom) => { setRoom(nextRoom); setConnectionStatus("connected"); });
    listen("room:participant-joined", (participant) => setRoom((current) => current ? {
      ...current,
      participants: current.participants.some((item) => item.participantId === participant.participantId)
        ? current.participants
        : [...current.participants, participant],
    } : current));
    listen("room:participant-disconnected", (participant) => setRoom((current) => current ? {
      ...current,
      participants: current.participants.map((item) => item.participantId === participant.participantId ? participant : item),
    } : current));
    listen("room:participant-reconnected", (participant) => setRoom((current) => current ? {
      ...current,
      participants: current.participants.map((item) => item.participantId === participant.participantId ? participant : item),
    } : current));
    listen("room:participant-left", (participant) => setRoom((current) => current ? {
      ...current,
      participants: current.participants.filter((item) => item.participantId !== participant.participantId),
    } : current));
    listen("room:closed", (payload) => {
      roomClient.forgetRoom(roomCode);
      setClosed(true);
      setRoom(null);
      setError(payload.reason === "expired" ? "Room sudah kedaluwarsa." : "Room sudah ditutup.");
      setConnectionStatus("disconnected");
    });
    listen("room:error", (payload) => {
      if (payload.code === "UNAUTHORIZED" || payload.code === "ROOM_EXPIRED" || payload.code === "ROOM_NOT_FOUND") {
        roomClient.forgetRoom(roomCode);
        setClosed(true);
      }
      setError(payload.message || "Terjadi kesalahan pada room.");
    });

    if (roomClient.ensureConnected()) queueMicrotask(() => { if (!disposed) void restore(); });
    return () => {
      disposed = true;
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [restore, roomCode]);

  return { room, currentParticipantId, connectionStatus, loading, error, closed, setError };
}
