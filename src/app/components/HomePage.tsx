"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  getSocket,
  setPlayerId,
  setPlayerName,
  setLobbyCode
} from "@/app/lib/socket";
import { Users, Plus, LogIn, Sword } from "lucide-react";

export default function HomePage() {
  const router = useRouter();
  const [playerName, setName] = useState("");
  const [lobbyCode, setCode] = useState("");
  const [loading, setLoading] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState("");

  const handleCreateLobby = () => {
    if (!playerName.trim()) {
      setError("لطفاً اسمت را وارد کن");
      return;
    }
    setError("");
    setLoading("create");

    const socket = getSocket();

    socket.emit("create_lobby", { playerName: playerName.trim() });

    socket.once(
      "lobby_created",
      (response: { code: string; playerId: string }) => {
        // ★ ذخیره در sessionStorage (هر تب جدا)
        setPlayerId(response.playerId);
        setPlayerName(playerName.trim());
        setLobbyCode(response.code);
        setLoading(null);
        router.push(`/lobby/${response.code}`);
      }
    );

    socket.once("error", ({ message }: { message: string }) => {
      setError(message);
      setLoading(null);
    });
  };

  const handleJoinLobby = () => {
    if (!playerName.trim()) {
      setError("لطفاً اسمت را وارد کن");
      return;
    }
    if (!lobbyCode.trim()) {
      setError("لطفاً کد لابی را وارد کن");
      return;
    }
    setError("");
    setLoading("join");

    const socket = getSocket();

    socket.emit("join_lobby", {
      playerName: playerName.trim(),
      code: lobbyCode.trim().toUpperCase()
    });

    socket.once(
      "lobby_joined",
      (response: { code: string; playerId: string }) => {
        // ★ ذخیره در sessionStorage (هر تب جدا)
        setPlayerId(response.playerId);
        setPlayerName(playerName.trim());
        setLobbyCode(response.code);
        setLoading(null);
        router.push(`/lobby/${response.code}`);
      }
    );

    socket.once("error", ({ message }: { message: string }) => {
      setError(message);
      setLoading(null);
    });
  };

  return (
    <div className="min-h-screen night-theme flex items-center justify-center p-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-20 w-72 h-72 bg-red-900/20 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-20 w-96 h-96 bg-purple-900/20 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md animate-slide-up">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-red-600/20 border border-red-500/30 mb-4 glow-red">
            <Sword className="w-10 h-10 text-red-400" />
          </div>
          <h1 className="text-4xl font-black text-white mb-2 tracking-tight">
            مافیا آنلاین
          </h1>
          <p className="text-white/50 text-sm">با دوستانت بازی کن</p>
        </div>

        {/* Card */}
        <div className="glass-dark rounded-2xl p-6 space-y-5">
          {/* Name Input */}
          <div>
            <label className="block text-white/70 text-sm mb-2 font-medium">
              اسم بازیکن
            </label>
            <input
              type="text"
              value={playerName}
              onChange={(e) => setName(e.target.value)}
              placeholder="اسمت رو وارد کن..."
              className="input-field"
              maxLength={20}
              onKeyDown={(e) => e.key === "Enter" && handleCreateLobby()}
            />
          </div>

          {/* Create Lobby */}
          <button
            onClick={handleCreateLobby}
            disabled={loading !== null}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {loading === "create" ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Plus className="w-5 h-5" />
            )}
            ساخت لابی جدید
          </button>

          {/* Separator */}
          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-white/10" />
            <span className="text-white/30 text-xs">یا</span>
            <div className="flex-1 border-t border-white/10" />
          </div>

          {/* Join Lobby */}
          <div className="space-y-3">
            <input
              type="text"
              value={lobbyCode}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="کد لابی را وارد کن..."
              className="input-field tracking-widest text-center text-lg font-bold"
              maxLength={6}
              onKeyDown={(e) => e.key === "Enter" && handleJoinLobby()}
            />
            <button
              onClick={handleJoinLobby}
              disabled={loading !== null}
              className="btn-secondary w-full flex items-center justify-center gap-2"
            >
              {loading === "join" ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <LogIn className="w-5 h-5" />
              )}
              پیوستن به لابی
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-500/20 border border-red-500/40 rounded-xl p-3 text-red-300 text-sm text-center animate-fade-in">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-center mt-6">
          <div className="flex items-center justify-center gap-2 text-white/30 text-xs">
            <Users className="w-3 h-3" />
            <span>حداکثر ۱۶ نفر در هر لابی</span>
          </div>
        </div>
      </div>
    </div>
  );
}
