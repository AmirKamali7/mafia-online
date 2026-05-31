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

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" }
  ]
};

interface PeerData {
  pc: RTCPeerConnection;
  peerId: string;
  stream?: MediaStream;
}

export default function VoiceManager({
  code,
  playerId,
  isMuted,
  isGod,
  onSpeakingChange
}: VoiceManagerProps) {
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, PeerData>>(new Map()); // key = socketId
  const audioContainerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const speakingRef = useRef<Record<string, boolean>>({});
  const analyserRef = useRef<{
    ctx: AudioContext | null;
    interval: NodeJS.Timeout | null;
    analysers: Map<string, AnalyserNode>;
  }>({ ctx: null, interval: null, analysers: new Map() });

  // ── Cleanup peer ──
  const removePeer = useCallback((socketId: string) => {
    const peer = peersRef.current.get(socketId);
    if (peer) {
      peer.pc.close();
      peersRef.current.delete(socketId);
    }
    // حذف audio element
    const el = audioContainerRef.current?.querySelector(
      `audio[data-sid="${socketId}"]`
    );
    if (el) el.remove();
    // حذف analyser
    analyserRef.current.analysers.delete(socketId);
  }, []);

  // ── Create peer connection ──
  const createPeer = useCallback(
    (targetSocketId: string, targetPlayerId: string, initiator: boolean) => {
      // اگر قبلاً وجود داره و سالمه، نساز
      const existing = peersRef.current.get(targetSocketId);
      if (
        existing &&
        existing.pc.connectionState !== "failed" &&
        existing.pc.connectionState !== "closed"
      ) {
        return existing.pc;
      }
      if (existing) removePeer(targetSocketId);

      const pc = new RTCPeerConnection(ICE_SERVERS);

      // اضافه کردن track‌های لوکال
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      // ICE candidate → به طرف مقابل بفرست
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          getSocket().emit("voice_ice", {
            targetSocketId,
            candidate: event.candidate
          });
        }
      };

      // دریافت stream ریموت
      pc.ontrack = (event) => {
        // حذف audio قبلی
        const oldEl = audioContainerRef.current?.querySelector(
          `audio[data-sid="${targetSocketId}"]`
        );
        if (oldEl) oldEl.remove();

        const audio = document.createElement("audio");
        audio.autoplay = true;
        audio.srcObject = event.streams[0];
        audio.dataset.sid = targetSocketId;
        audioContainerRef.current?.appendChild(audio);

        const peer = peersRef.current.get(targetSocketId);
        if (peer) peer.stream = event.streams[0];

        // اضافه کردن analyser برای speaking detection
        if (analyserRef.current.ctx && event.streams[0]) {
          try {
            const source = analyserRef.current.ctx.createMediaStreamSource(
              event.streams[0]
            );
            const analyser = analyserRef.current.ctx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            analyserRef.current.analysers.set(targetSocketId, analyser);
          } catch {}
        }
      };

      pc.onconnectionstatechange = () => {
        if (
          pc.connectionState === "disconnected" ||
          pc.connectionState === "failed"
        ) {
          removePeer(targetSocketId);
        }
      };

      peersRef.current.set(targetSocketId, { pc, peerId: targetPlayerId });

      // initiator = offer بساز
      if (initiator) {
        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => {
            getSocket().emit("voice_offer", {
              targetSocketId,
              offer: pc.localDescription
            });
          })
          .catch(console.error);
      }

      return pc;
    },
    [removePeer]
  );

  // ── Speaking detection ──
  const startSpeakingDetection = useCallback(() => {
    if (analyserRef.current.interval) return;
    try {
      const ctx = new AudioContext();
      analyserRef.current.ctx = ctx;

      // analyser برای میکروفن لوکال
      if (localStreamRef.current) {
        const source = ctx.createMediaStreamSource(localStreamRef.current);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current.analysers.set("local", analyser);
      }

      analyserRef.current.interval = setInterval(() => {
        const newSpeaking: Record<string, boolean> = {};

        analyserRef.current.analysers.forEach((analyser, key) => {
          try {
            const data = new Uint8Array(analyser.fftSize);
            analyser.getByteTimeDomainData(data);
            const volume = Math.max(
              ...Array.from(data).map((v) => Math.abs(v - 128))
            );
            const id =
              key === "local"
                ? playerId
                : peersRef.current.get(key)?.peerId || key;
            newSpeaking[id] = volume > 10 && (key !== "local" || !isMuted);
          } catch {}
        });

        const changed = Object.keys(newSpeaking).some(
          (k) => newSpeaking[k] !== speakingRef.current[k]
        );
        if (changed) {
          speakingRef.current = newSpeaking;
          onSpeakingChange?.(newSpeaking);
        }
      }, 200);
    } catch {}
  }, [playerId, isMuted, onSpeakingChange]);

  // ── Start microphone ──
  const startMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
      localStreamRef.current = stream;
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !isMuted;
      });
      setError("");

      // آماده voice
      getSocket().emit("voice_ready", { code, playerId });
      startSpeakingDetection();
    } catch (err) {
      setError("دسترسی به میکروفن رد شد");
      console.error("Mic error:", err);
    }
  }, [code, playerId, isMuted, startSpeakingDetection]);

  // ── Socket events ──
  useEffect(() => {
    if (!playerId) return;
    startMic();

    const socket = getSocket();

    // بازیکن جدید آماده voice شد → ما initiator هستیم
    socket.on(
      "voice_user_joined",
      ({
        userId,
        socketId: targetSid
      }: {
        userId: string;
        socketId: string;
      }) => {
        if (userId !== playerId && targetSid) {
          createPeer(targetSid, userId, true);
        }
      }
    );

    // دریافت offer → peer بساز و answer بده
    socket.on(
      "voice_offer",
      async ({
        fromSocketId,
        offer
      }: {
        fromSocketId: string;
        offer: RTCSessionDescriptionInit;
      }) => {
        try {
          removePeer(fromSocketId); // پاک کردن قبلی
          const pc = createPeer(fromSocketId, "", false);
          if (!pc) return;

          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          socket.emit("voice_answer", {
            targetSocketId: fromSocketId,
            answer: pc.localDescription
          });
        } catch (err) {
          console.warn("voice_offer error:", err);
        }
      }
    );

    // دریافت answer
    socket.on(
      "voice_answer",
      async ({
        fromSocketId,
        answer
      }: {
        fromSocketId: string;
        answer: RTCSessionDescriptionInit;
      }) => {
        try {
          const peer = peersRef.current.get(fromSocketId);
          if (peer && peer.pc.signalingState === "have-local-offer") {
            await peer.pc.setRemoteDescription(
              new RTCSessionDescription(answer)
            );
          }
        } catch (err) {
          console.warn("voice_answer error:", err);
        }
      }
    );

    // دریافت ICE candidate
    socket.on(
      "voice_ice",
      async ({
        fromSocketId,
        candidate
      }: {
        fromSocketId: string;
        candidate: RTCIceCandidateInit;
      }) => {
        try {
          const peer = peersRef.current.get(fromSocketId);
          if (peer && peer.pc.remoteDescription) {
            await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
          }
        } catch {}
      }
    );

    // بازیکن از voice خارج شد
    socket.on(
      "voice_user_left",
      ({ socketId: leftSid }: { socketId: string }) => {
        removePeer(leftSid);
      }
    );

    return () => {
      socket.off("voice_user_joined");
      socket.off("voice_offer");
      socket.off("voice_answer");
      socket.off("voice_ice");
      socket.off("voice_user_left");

      // ★ Cleanup — جلوگیری از memory leak
      peersRef.current.forEach((peer) => peer.pc.close());
      peersRef.current.clear();

      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;

      if (analyserRef.current.interval) {
        clearInterval(analyserRef.current.interval);
        analyserRef.current.interval = null;
      }
      if (analyserRef.current.ctx) {
        analyserRef.current.ctx.close();
        analyserRef.current.ctx = null;
      }
      analyserRef.current.analysers.clear();
    };
  }, [code, playerId, createPeer, startMic, removePeer]);

  // ── Mute/unmute track ──
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
