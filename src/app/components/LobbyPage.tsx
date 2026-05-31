"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { getSocket, getPlayerId } from "@/app/lib/socket";
import { DEFAULT_ROLES } from "@/app/lib/roles";
import { LobbyData, ChatMessage, SystemMessage } from "@/app/lib/types";
import {
  Copy,
  Check,
  Users,
  Crown,
  Mic,
  MicOff,
  Play,
  Settings,
  MessageCircle,
  Plus,
  Minus
} from "lucide-react";

type MessageItem =
  | (ChatMessage & { isSystem: false })
  | (SystemMessage & { isSystem: true });

export default function LobbyPage({ code }: { code: string }) {
  const router = useRouter();
  const [lobby, setLobby] = useState<LobbyData | null>(null);
  const [playerId, setPlayerId_] = useState("");
  const [isGod, setIsGod] = useState(false);
  const [copied, setCopied] = useState(false);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // ★ از sessionStorage بخون (هر تب playerId خودش رو داره)
    const id = getPlayerId();
    setPlayerId_(id);

    const socket = getSocket();

    socket.emit("get_lobby", { code, playerId: id });

    socket.on("lobby_data", (data: LobbyData) => {
      setLobby(data);
      const me = data.players.find((p) => p.id === id);
      if (me) {
        setIsMuted(me.isMuted);
        setIsGod(me.isGod);
      }
    });

    socket.on("lobby_updated", (data: LobbyData) => {
      setLobby(data);
      const me = data.players.find((p) => p.id === id);
      if (me) {
        setIsMuted(me.isMuted);
        setIsGod(me.isGod);
      }
    });

    socket.on("lobby_created", ({ lobby: data }: { lobby: LobbyData }) => {
      setLobby(data);
      setIsGod(true);
    });

    socket.on("lobby_joined", ({ lobby: data }: { lobby: LobbyData }) => {
      setLobby(data);
    });

    socket.on("system_message", (msg: SystemMessage) => {
      const item: MessageItem = { ...msg, isSystem: true };
      setMessages((prev) => [...prev, item]);
    });

    socket.on("chat_message", (msg: ChatMessage) => {
      const item: MessageItem = { ...msg, isSystem: false };
      setMessages((prev) => [...prev, item]);
    });

    socket.on("mute_changed", ({ isMuted: muted }: { isMuted: boolean }) => {
      setIsMuted(muted);
    });

    socket.on("game_starting", ({ lobby: data }: { lobby: LobbyData }) => {
      setLobby(data);
      router.push(`/game/${data.code}`);
    });

    socket.on("error", ({ message }: { message: string }) => {
      alert(message);
    });

    return () => {
      socket.off("lobby_data");
      socket.off("lobby_updated");
      socket.off("lobby_created");
      socket.off("lobby_joined");
      socket.off("system_message");
      socket.off("chat_message");
      socket.off("mute_changed");
      socket.off("game_starting");
      socket.off("error");
    };
  }, [code, router]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const copyCode = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleReady = () => {
    getSocket().emit("player_ready", { code, playerId });
  };

  const toggleMute = () => {
    getSocket().emit("self_mute", { code, playerId });
  };

  const startGame = () => {
    getSocket().emit("start_game", { code, playerId });
  };

  const sendMessage = () => {
    if (!chatInput.trim()) return;
    getSocket().emit("chat_message", {
      code,
      playerId,
      message: chatInput.trim()
    });
    setChatInput("");
  };

  const updateRoleCount = (roleName: string, delta: number) => {
    if (!lobby) return;
    const exists = lobby.roles.find((r) => r.name === roleName);
    let updated;
    if (exists) {
      updated = lobby.roles
        .map((r) =>
          r.name === roleName
            ? { ...r, count: Math.max(0, r.count + delta) }
            : r
        )
        .filter((r) => r.count > 0);
    } else {
      const roleInfo = DEFAULT_ROLES.find((r) => r.name === roleName);
      if (!roleInfo) return;
      updated = [...lobby.roles, { ...roleInfo, count: 1 }];
    }
    getSocket().emit("update_settings", {
      code,
      playerId,
      roles: updated,
      maxPlayers: lobby.maxPlayers
    });
  };

  const updateMaxPlayers = (delta: number) => {
    if (!lobby) return;
    const newMax = Math.min(16, Math.max(2, lobby.maxPlayers + delta));
    getSocket().emit("update_settings", {
      code,
      playerId,
      roles: lobby.roles,
      maxPlayers: newMax
    });
  };

  const me = lobby?.players.find((p) => p.id === playerId);
  const allReady = lobby?.players
    .filter((p) => !p.isGod)
    .every((p) => p.isReady);
  const nonGodPlayers = lobby?.players.filter((p) => !p.isGod) || [];

  if (!lobby) {
    return (
      <div className="min-h-screen night-theme flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-red-500/30 border-t-red-500 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white/50">در حال اتصال...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen night-theme p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="glass-dark rounded-xl px-4 py-2 flex items-center gap-2">
              <span className="text-white/50 text-sm">کد لابی:</span>
              <span className="text-white font-black text-lg tracking-widest">
                {code}
              </span>
              <button
                onClick={copyCode}
                className="text-white/50 hover:text-white transition-colors mr-1"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-green-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="glass-dark rounded-xl px-3 py-2 flex items-center gap-2">
              <Users className="w-4 h-4 text-white/50" />
              <span className="text-white font-bold">
                {lobby.players.length}/{lobby.maxPlayers}
              </span>
            </div>
            {isGod && (
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`glass-dark rounded-xl p-2 transition-colors ${
                  showSettings
                    ? "text-red-400"
                    : "text-white/50 hover:text-white"
                }`}
              >
                <Settings className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Players List */}
          <div className="lg:col-span-1 space-y-4">
            <div className="glass-dark rounded-2xl p-4">
              <h2 className="text-white font-bold mb-3 flex items-center gap-2">
                <Users className="w-4 h-4 text-red-400" />
                بازیکنان
              </h2>
              <div className="space-y-2">
                {lobby.players.map((player) => (
                  <div
                    key={player.id}
                    className={`flex items-center justify-between rounded-xl p-3 transition-all ${
                      player.id === playerId
                        ? "bg-red-500/20 border border-red-500/30"
                        : "bg-white/5"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {player.isGod ? (
                        <Crown className="w-4 h-4 text-yellow-400" />
                      ) : (
                        <div
                          className={`w-2 h-2 rounded-full ${
                            player.isReady ? "bg-green-400" : "bg-white/20"
                          }`}
                        />
                      )}
                      <span className="text-white text-sm font-medium">
                        {player.name}
                      </span>
                      {player.id === playerId && (
                        <span className="text-white/30 text-xs">(شما)</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {player.isMuted ? (
                        <MicOff className="w-3 h-3 text-red-400" />
                      ) : (
                        <Mic className="w-3 h-3 text-green-400" />
                      )}
                      {player.isGod && (
                        <span className="text-yellow-400 text-xs">گاد</span>
                      )}
                      {!player.isGod && player.isReady && (
                        <span className="text-green-400 text-xs">آماده</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-2">
              {!isGod && (
                <button
                  onClick={toggleReady}
                  className={`w-full py-3 rounded-xl font-bold transition-all active:scale-95 ${
                    me?.isReady
                      ? "bg-green-600 hover:bg-green-700 text-white"
                      : "bg-white/10 hover:bg-white/20 text-white border border-white/20"
                  }`}
                >
                  {me?.isReady ? "✓ آماده‌ام" : "آماده‌ام"}
                </button>
              )}

              <button
                onClick={toggleMute}
                className={`w-full py-3 rounded-xl font-bold transition-all active:scale-95 flex items-center justify-center gap-2 ${
                  isMuted
                    ? "bg-red-600/30 border border-red-500/50 text-red-300"
                    : "bg-white/10 hover:bg-white/20 text-white border border-white/20"
                }`}
              >
                {isMuted ? (
                  <MicOff className="w-4 h-4" />
                ) : (
                  <Mic className="w-4 h-4" />
                )}
                {isMuted ? "میوت هستید" : "میکروفن روشن"}
              </button>

              {isGod && (
                <button
                  onClick={startGame}
                  disabled={!allReady || nonGodPlayers.length < 2}
                  className="btn-primary w-full flex items-center justify-center gap-2"
                >
                  <Play className="w-4 h-4" />
                  شروع بازی
                </button>
              )}
            </div>
          </div>

          {/* Middle: Settings or Role Info */}
          <div className="lg:col-span-1 space-y-4">
            {showSettings && isGod ? (
              <div className="glass-dark rounded-2xl p-4">
                <h2 className="text-white font-bold mb-4 flex items-center gap-2">
                  <Settings className="w-4 h-4 text-red-400" />
                  تنظیمات بازی
                </h2>

                <div className="mb-4">
                  <label className="text-white/60 text-sm mb-2 block">
                    حداکثر بازیکنان
                  </label>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => updateMaxPlayers(-1)}
                      className="btn-secondary p-2 rounded-lg"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <span className="text-white font-bold text-xl w-8 text-center">
                      {lobby.maxPlayers}
                    </span>
                    <button
                      onClick={() => updateMaxPlayers(1)}
                      className="btn-secondary p-2 rounded-lg"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-white/60 text-sm mb-2 block">
                    نقش‌ها
                  </label>
                  <div className="space-y-2">
                    {DEFAULT_ROLES.map((role) => {
                      const current = lobby.roles.find(
                        (r) => r.name === role.name
                      );
                      const count = current?.count ?? 0;
                      return (
                        <div
                          key={role.name}
                          className="flex items-center justify-between bg-white/5 rounded-xl p-3"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{role.icon}</span>
                            <div>
                              <p className="text-white text-sm font-medium">
                                {role.name}
                              </p>
                              <p className="text-white/40 text-xs">
                                {role.description}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => updateRoleCount(role.name, -1)}
                              className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="text-white font-bold w-5 text-center">
                              {count}
                            </span>
                            <button
                              onClick={() => updateRoleCount(role.name, 1)}
                              className="w-7 h-7 rounded-lg bg-red-600/50 hover:bg-red-600 flex items-center justify-center text-white transition-colors"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="glass-dark rounded-2xl p-4">
                <h2 className="text-white font-bold mb-3">نقش‌های بازی</h2>
                <div className="space-y-2">
                  {lobby.roles
                    .filter((r) => r.count > 0)
                    .map((role) => {
                      const info = DEFAULT_ROLES.find(
                        (r) => r.name === role.name
                      );
                      return (
                        <div
                          key={role.name}
                          className="flex items-center justify-between bg-white/5 rounded-xl p-3"
                        >
                          <div className="flex items-center gap-2">
                            <span>{info?.icon}</span>
                            <span className="text-white text-sm">
                              {role.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              className="text-xs px-2 py-1 rounded-full"
                              style={{
                                backgroundColor: info?.color + "20",
                                color: info?.color
                              }}
                            >
                              {role.team === "mafia"
                                ? "مافیا"
                                : role.team === "citizen"
                                  ? "شهروند"
                                  : "مستقل"}
                            </span>
                            <span className="text-white/50 text-sm">
                              x{role.count}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>

          {/* Chat */}
          <div className="lg:col-span-1">
            <div className="glass-dark rounded-2xl p-4 flex flex-col h-96">
              <h2 className="text-white font-bold mb-3 flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-red-400" />
                چت لابی
              </h2>

              <div className="flex-1 overflow-y-auto space-y-2 mb-3">
                {messages.map((msg, idx) => {
                  if (msg.isSystem === true) {
                    return (
                      <div key={idx} className="text-center">
                        <span className="text-white/30 text-xs bg-white/5 px-3 py-1 rounded-full">
                          {msg.text}
                        </span>
                      </div>
                    );
                  }
                  return (
                    <div key={idx} className="flex flex-col">
                      <div className="flex items-center gap-1 mb-0.5">
                        {msg.isGod && (
                          <Crown className="w-3 h-3 text-yellow-400" />
                        )}
                        <span
                          className={`text-xs font-bold ${
                            msg.isGod ? "text-yellow-400" : "text-red-400"
                          }`}
                        >
                          {msg.playerName}
                        </span>
                      </div>
                      <p className="text-white/80 text-sm bg-white/5 rounded-xl px-3 py-2">
                        {msg.message}
                      </p>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                  placeholder="پیام بده..."
                  className="flex-1 bg-white/10 border border-white/20 text-white placeholder-white/30 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-500"
                  disabled={isMuted && !isGod}
                />
                <button
                  onClick={sendMessage}
                  disabled={isMuted && !isGod}
                  className="bg-red-600 hover:bg-red-700 text-white rounded-xl px-3 py-2 transition-colors disabled:opacity-50"
                >
                  ارسال
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
