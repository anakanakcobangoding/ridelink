"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WebRTCIntercomClient } from "../lib/webrtc-client.js";

const INITIAL_STATE = {
  microphoneStatus: "permission-required",
  microphoneEnabled: false,
  connectionStatus: "waiting",
  connectionState: "new",
  iceConnectionState: "new",
  signalingState: "stable",
  iceGatheringState: "new",
  remoteAudioBlocked: false,
  turnAvailable: false,
  iceTransportPolicy: "all",
  candidateType: "unknown",
  peerMicrophoneEnabled: false,
  microphonePermission: "unknown",
  localAudioTrackState: "none",
  selectedCandidatePair: "unavailable",
  incomingAudioBytes: 0,
  outgoingAudioBytes: 0,
  error: "",
};

export function useIntercom({ room, currentParticipantId, signalingStatus }) {
  const [state, setState] = useState(INITIAL_STATE);
  const clientRef = useRef(null);
  const audioRef = useRef(null);
  const previousSignalingStatus = useRef(signalingStatus);
  const peer = room?.participants.find((participant) => participant.participantId !== currentParticipantId) ?? null;

  useEffect(() => {
    const client = new WebRTCIntercomClient({
      onState: (nextState) => setState({ ...nextState }),
      getAudioElement: () => audioRef.current,
    });
    clientRef.current = client;
    client.start();
    return () => {
      client.destroy();
      clientRef.current = null;
    };
  }, []);

  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;
    client.setCurrentParticipantId(currentParticipantId);
    void client.setPeer(peer);
  }, [currentParticipantId, peer]);

  useEffect(() => {
    const previous = previousSignalingStatus.current;
    previousSignalingStatus.current = signalingStatus;
    if ((previous === "reconnecting" || previous === "disconnected") && signalingStatus === "connected" && peer) {
      void clientRef.current?.retryConnection({ automatic: true, force: true });
    }
  }, [peer, signalingStatus]);

  const enableMicrophone = useCallback(() => clientRef.current?.enableMicrophone(), []);
  const toggleMute = useCallback(() => clientRef.current?.toggleMute(), []);
  const enableRemoteAudio = useCallback(() => clientRef.current?.enableRemoteAudio(), []);
  const retryConnection = useCallback(() => clientRef.current?.retryConnection(), []);
  const setRelayOnly = useCallback((enabled) => clientRef.current?.setRelayOnly(enabled), []);

  return {
    state,
    audioRef,
    peer,
    enableMicrophone,
    toggleMute,
    enableRemoteAudio,
    retryConnection,
    setRelayOnly,
  };
}
