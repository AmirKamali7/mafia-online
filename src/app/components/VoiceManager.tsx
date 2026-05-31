"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getSocket } from "@/app/lib/socket";

interface VoiceManagerProps {
  code: string;
  playerId: string;
  isMuted: boolean;
  isGod: boolean;
  onSpeakingChange?: (speakingMap: Record<string, boolean>) => void;
}

interface PeerConnection {
  peerId: string;
  connection: RTCPeerConnection;
  stream?: MediaStream;
}

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export default function VoiceManager({
  code,
  playerId,
  isMuted,
  isGod,
  onSpeakingChange,
}: VoiceManagerProps) {
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, PeerConnection>>(new Map());
  const audioContainerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const speakingRef = useRef<Record<string, boolean>>({});
  const analyserIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analysersRef = useRef<Map<string, AnalyserNode>>(new Map());

  // ── Remove peer ──────────────────────────────────────────────────────────
  const removePeer = useCallback((targetId: string) => {
    const peer = peersRef.current.get(targetId);
    if (peer) {
      peer.connection.close();
      peersRef.current.delete(targetId);
    }
    analysersRef.current.delete(targetId);
    const audio = audioContainerRef.current?.querySelector(
      `audio[data-peer-id="${targetId}"]`
    );
    if (audio) audio.remove();
  }, []);

  // ── Create peer connection ── ★ فیکس WebRTC error ────────────────────────
  const createPeer = useCallback(
    (targetId: string, initiator: boolean): RTCPeerConnection | null => {
      // ★ اگر قبلاً connection وجود داره، نساز
      if (peersRef.current.has(targetId)) {
        const existing = peersRef.current.get(targetId)!;
        if (
          existing.connection.connectionState !== "failed" &&
          existing.connection.connectionState !== "closed"
        ) {
          return existing.connection;
        }
        removePeer(targetId);
      }

      const pc = new RTCPeerConnection(ICE_SERVERS);

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          getSocket().emit("voice_ice", {
            code,
            playerId,
            targetId,
            candidate: event.candidate,
          });
        }
      };

      pc.ontrack = (event) => {
        // حذف audio قبلی
        const oldAudio = audioContainerRef.current?.querySelector(
          `audio[data-peer-id="${targetId}"]`
        );
        if (oldAudio) oldAudio.remove();

        const audio = document.createElement("audio");
        audio.autoplay = true;
        audio.srcObject = event.streams[0];
        audio.dataset.peerId = targetId;
        audioContainerRef.current?.appendChild(audio);

        const peer = peersRef.current.get(targetId);
        if (peer) {
          peer.stream = event.streams[0];
        }
      };

      pc.onconnectionstatechange = () => {
        if (
          pc.connectionState === "disconnected" ||
          pc.connectionState === "failed"
        ) {
          removePeer(targetId);
        }
      };

      peersRef.current.set(targetId, { peerId: targetId, connection: pc });

      if (initiator) {
        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => {
            getSocket().emit("voice_offer", {
              code,
              playerId,
              targetId,
              offer: pc.localDescription,
            });
          })
          .catch(console.error);
      }

      return pc;
    },
    [code, playerId, removePeer]
  );

  // ── Speaking detection ───────────────────────────────────────────────────
  const startSpeakingDetection = useCallback(() => {
    if (analyserIntervalRef.current) return;

    try {
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;

      if (localStreamRef.current) {
        const source = audioCtx.createMediaStreamSource(localStreamRef.current);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analysersRef.current.set(playerId, analyser);
      }

      analyserIntervalRef.current = setInterval(() => {
        const newSpeaking: Record<string, boolean> = {};

        analysersRef.current.forEach((analyser, id) => {
          try {
            const data = new Uint8Array(analyser.fftSize);
            analyser.getByteTimeDomainData(data);
            const volume = Math.max(
              ...Array.from(data).map((v) => Math.abs(v - 128))
            );
            newSpeaking[id] = volume > 10 && (id !== playerId || !isMuted);
          } catch {
            // ignore
          }
        });

        const changed = Object.keys(newSpeaking).some(
          (k) => newSpeaking[k] !== speakingRef.current[k]
        );
        if (changed) {
          speakingRef.current = newSpeaking;
          onSpeakingChange?.(newSpeaking);
        }
      }, 200);
    } catch {
      // AudioContext not available
    }
  }, [playerId, isMuted, onSpeakingChange]);

  // ── Start mic ────────────────────────────────────────────────────────────
  const startMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      localStreamRef.current = stream;
      setError("");

      stream.getAudioTracks().forEach((track) => {
        track.enabled = !isMuted;
      });

      getSocket().emit("voice_ready", { code, playerId });
      startSpeakingDetection();
    } catch (err) {
      setError("دسترسی به میکروفن رد شد");
      console.error("Mic error:", err);
    }
  }, [code, playerId, isMuted, startSpeakingDetection]);

  // ── Socket events ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!playerId) return;

    startMic();

    const socket = getSocket();

    socket.on("voice_user_joined", ({ userId }: { userId: string }) => {
      if (userId !== playerId) {
        createPeer(userId, true);
      }
    });

    // ★ فیکس WebRTC: handle offer/answer با state checking
    socket.on(
      "voice_offer",
      async ({
        fromId,
        offer,
      }: {
        fromId: string;
        offer: RTCSessionDescriptionInit;
      }) => {
        try {
          // همیشه peer جدید بساز برای offer دریافتی
          removePeer(fromId);
          const pc = createPeer(fromId, false);
          if (!pc) return;

          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          socket.emit("voice_answer", {
            code,
            playerId,
            targetId: fromId,
            answer: pc.localDescription,
          });
        } catch (err) {
          console.warn("voice_offer error:", err);
        }
      }
    );

    socket.on(
      "voice_answer",
      async ({
        fromId,
        answer,
      }: {
        fromId: string;
        answer: RTCSessionDescriptionInit;
      }) => {
        try {
          const peer = peersRef.current.get(fromId);
          if (!peer) return;

          // ★ فیکس: فقط اگر state درست باشه answer رو ست کن
          if (peer.connection.signalingState === "have-local-offer") {
            await peer.connection.setRemoteDescription(
              new RTCSessionDescription(answer)
            );
          }
        } catch (err) {
          console.warn("voice_answer error:", err);
        }
      }
    );

    socket.on(
      "voice_ice",
      async ({
        fromId,
        candidate,
      }: {
        fromId: string;
        candidate: RTCIceCandidateInit;
      }) => {
        try {
          const peer = peersRef.current.get(fromId);
          if (!peer) return;

          // ★ فیکس: فقط اگر remoteDescription ست شده باشه
          if (peer.connection.remoteDescription) {
            await peer.connection.addIceCandidate(
              new RTCIceCandidate(candidate)
            );
          }
        } catch (err) {
          // ignore ICE errors
        }
      }
    );

    socket.on("voice_user_left", ({ userId }: { userId: string }) => {
      removePeer(userId);
    });

    return () => {
      socket.off("voice_user_joined");
      socket.off("voice_offer");
      socket.off("voice_answer");
      socket.off("voice_ice");
      socket.off("voice_user_left");

      peersRef.current.forEach((peer) => peer.connection.close());
      peersRef.current.clear();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());

      if (analyserIntervalRef.current) {
        clearInterval(analyserIntervalRef.current);
        analyserIntervalRef.current = null;
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
      }
    };
  }, [code, playerId, createPeer, startMic, removePeer]);

  // ── Handle mute changes ──────────────────────────────────────────────────
  useEffect(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !isMuted;
      });
    }
  }, [isMuted]);

  return (
    <>
      <div ref={audioContainerRef} className="hidden" />
      {error && (
        <div className="fixed bottom-4 left-4 z-50 bg-red-900/80 border border-red-500/50 rounded-xl px-4 py-2 text-red-300 text-sm backdrop-blur-sm">
          ⚠️ {error}
        </div>
      )}
    </>
  );
}
