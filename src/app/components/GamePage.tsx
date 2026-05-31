"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getSocket, getPlayerId } from "@/app/lib/socket";
import {
  LobbyData,
  ChatMessage,
  SystemMessage,
  GameEndData,
  PlayerRole,
  GodNotification
} from "@/app/lib/types";
import { DEFAULT_ROLES, ROLE_NIGHT_ACTIONS } from "@/app/lib/roles";
import GodPanel from "./GodPanel";
import PlayerSeat from "./PlayerSeat";
import RoleCard from "./RoleCard";
import VoiceManager from "./VoiceManager";
import {
  Mic,
  MicOff,
  Crown,
  Sun,
  Moon,
  MessageCircle,
  Clock,
  Target,
  FileText,
  Vote
} from "lucide-react";

type MessageItem =
  | (ChatMessage & { isSystem: false })
  | (SystemMessage & { isSystem: true });

const PLAYER_EMOJIS = [
  { id: "like", icon: "👍" },
  { id: "dislike", icon: "👎" },
  { id: "laugh", icon: "😂" },
  { id: "cry", icon: "😢" },
  { id: "angry", icon: "😡" },
  { id: "poop", icon: "💩" }
];

export default function GamePage({ code }: { code: string }) {
  const router = useRouter();
  const [lobby, setLobby] = useState<LobbyData | null>(null);
  const [playerId, setPlayerId_] = useState("");
  const [isGod, setIsGod] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isGodMuted, setIsGodMuted] = useState(false);
  const [isSelfMuted, setIsSelfMuted] = useState(false);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [myTeam, setMyTeam] = useState<string | null>(null);
  const [showRoleCard, setShowRoleCard] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [gameEnded, setGameEnded] = useState<GameEndData | null>(null);
  const [playerRoles, setPlayerRoles] = useState<PlayerRole[]>([]);
  const [speakingMap, setSpeakingMap] = useState<Record<string, boolean>>({});
  const [phaseTimer, setPhaseTimer] = useState("00:00");
  const [canChat, setCanChat] = useState(true);
  const [actionTarget, setActionTarget] = useState<string | null>(null);
  const [actionConfirmed, setActionConfirmed] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [showChat, setShowChat] = useState(true);
  const [revealedRole, setRevealedRole] = useState<{
    playerName: string;
    role: string;
  } | null>(null);
  const [votingActive, setVotingActive] = useState(false);
  const [voteEndTime, setVoteEndTime] = useState(0);
  const [voteTimer, setVoteTimer] = useState("");
  const [votes, setVotes] = useState<Record<string, string>>({});
  const [myVote, setMyVote] = useState<string | null>(null);
  const [voteType, setVoteType] = useState<"eliminate" | "inquiry">(
    "eliminate"
  );
  const [inquiryResult, setInquiryResult] = useState<{
    roleList: string;
    passed: boolean;
  } | null>(null);
  const [testament, setTestament] = useState("");
  const [showTestament, setShowTestament] = useState(false);
  const [floatingEmojis, setFloatingEmojis] = useState<
    { id: string; emoji: string; targetId: string }[]
  >([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const phaseTimerRef = useRef<NodeJS.Timeout | null>(null);
  const voteTimerRef = useRef<NodeJS.Timeout | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bgMusicRef = useRef<HTMLAudioElement | null>(null);

  const playLocalSound = useCallback((sound: string) => {
    try {
      if (audioRef.current) audioRef.current.pause();
      const a = new Audio(`/sounds/${sound}.mp3`);
      a.volume = 0.6;
      a.play().catch(() => {});
      audioRef.current = a;
    } catch {}
  }, []);

  const updateBgMusic = useCallback((phase: "day" | "night") => {
    try {
      if (bgMusicRef.current) bgMusicRef.current.pause();
      const a = new Audio(`/sounds/${phase}.mp3`);
      a.loop = true;
      a.volume = 0.15;
      a.play().catch(() => {});
      bgMusicRef.current = a;
    } catch {}
  }, []);

  const handleSpeakingChange = useCallback(
    (m: Record<string, boolean>) => setSpeakingMap(m),
    []
  );

  useEffect(() => {
    if (!lobby?.phaseStartTime) return;
    const st = lobby.phaseStartTime;
    const update = () => {
      const e = Math.floor((Date.now() - st) / 1000);
      setPhaseTimer(
        `${Math.floor(e / 60)
          .toString()
          .padStart(2, "0")}:${(e % 60).toString().padStart(2, "0")}`
      );
    };
    update();
    phaseTimerRef.current = setInterval(update, 1000);
    return () => {
      if (phaseTimerRef.current) clearInterval(phaseTimerRef.current);
    };
  }, [lobby?.phaseStartTime, lobby?.phase, lobby?.round]);

  useEffect(() => {
    if (!votingActive) {
      setVoteTimer("");
      return;
    }
    const update = () => {
      const remaining = Math.max(
        0,
        Math.floor((voteEndTime - Date.now()) / 1000)
      );
      setVoteTimer(
        `${Math.floor(remaining / 60)
          .toString()
          .padStart(2, "0")}:${(remaining % 60).toString().padStart(2, "0")}`
      );
    };
    update();
    voteTimerRef.current = setInterval(update, 1000);
    return () => {
      if (voteTimerRef.current) clearInterval(voteTimerRef.current);
    };
  }, [votingActive, voteEndTime]);

  const getMyAction = () => {
    if (!myRole || isGod) return null;
    const ra = ROLE_NIGHT_ACTIONS[myRole];
    return ra
      ? {
          action: ra.action,
          label: ra.label,
          icon: DEFAULT_ROLES.find((r) => r.name === myRole)?.icon || "⚡",
          sound: ra.sound
        }
      : null;
  };
  const isMyTurn = () => {
    if (!lobby || lobby.phase !== "night" || isGod || !lobby.awakeGroup)
      return false;
    return lobby.awakeGroup === "mafia"
      ? myTeam === "mafia"
      : myRole === lobby.awakeGroup;
  };
  const sendAction = (targetId: string) => {
    const ma = getMyAction();
    if (!ma) return;
    getSocket().emit("role_action", {
      code,
      playerId,
      targetId,
      action: ma.action
    });
    setActionTarget(targetId);
    playLocalSound(ma.sound);
  };

  // ★ ایموجی — کلیک مستقیم، فلوت ۲ ثانیه روی پروفایل
  const sendEmoji = (targetId: string, emoji: string) => {
    getSocket().emit("send_emoji", { code, playerId, targetId, emoji });
  };

  // ★ میوت — گاد هم بتونه
  const toggleMute = () => {
    // فقط اگر گاد میوت کرده و خودش گاد نیست، نتونه
    if (isGodMuted && !isGod) return;
    getSocket().emit("self_mute", { code, playerId });
  };

  useEffect(() => {
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
    socket.on("your_role", ({ role, team }: any) => {
      setMyRole(role);
      setMyTeam(team);
      setShowRoleCard(true);
    });
    socket.on("all_roles", ({ players }: any) => setPlayerRoles(players));
    socket.on("game_starting", ({ lobby: d, countdown: cd }: any) => {
      setLobby(d);
      setCountdown(cd);
      let r = cd;
      countdownRef.current = setInterval(() => {
        r--;
        setCountdown(r);
        if (r <= 0) {
          clearInterval(countdownRef.current!);
          setCountdown(null);
        }
      }, 1000);
    });
    socket.on("game_started", (d: LobbyData) => {
      setLobby(d);
      setCountdown(null);
      updateBgMusic("day");
    });
    socket.on("phase_changed", ({ phase, round, phaseStartTime }: any) => {
      setLobby((prev) =>
        prev
          ? { ...prev, phase, round, phaseStartTime, awakeGroup: null }
          : prev
      );
      setActionTarget(null);
      setActionConfirmed(null);
      setVotingActive(false);
      setMyVote(null);
      if (phase === "day") {
        playLocalSound("rooster");
        setTimeout(() => updateBgMusic("day"), 2000);
      } else {
        playLocalSound("wolf");
        setTimeout(() => updateBgMusic("night"), 2000);
      }
    });
    socket.on("awake_group_changed", ({ group }: any) => {
      setLobby((prev) => (prev ? { ...prev, awakeGroup: group } : prev));
      setActionTarget(null);
      setActionConfirmed(null);
    });
    socket.on("chat_permission_changed", ({ canChat: c }: any) => {
      if (c !== undefined) setCanChat(c);
    });
    socket.on("action_confirmed", ({ targetName }: any) => {
      setActionConfirmed(targetName);
      setTimeout(() => setActionConfirmed(null), 3000);
    });
    socket.on("player_eliminated", ({ lobby: d }: any) => {
      setLobby(d);
      playLocalSound("gun");
    });

    // ★ مهم: isSelfMuted جدا track بشه
    socket.on(
      "mute_changed",
      ({ isMuted: m, isGodMuted: gm, isSelfMuted: sm }: any) => {
        setIsMuted(m);
        if (gm !== undefined) setIsGodMuted(gm);
        if (sm !== undefined) setIsSelfMuted(sm);
      }
    );

    socket.on("role_revealed", ({ playerName, role }: any) => {
      setRevealedRole({ playerName, role });
      setTimeout(() => setRevealedRole(null), 5000);
    });
    socket.on("game_ended", (d: GameEndData) => {
      setGameEnded(d);
      if (bgMusicRef.current) bgMusicRef.current.pause();
      playLocalSound("win");
    });
    socket.on("play_sound", ({ sound }: any) => playLocalSound(sound));
    socket.on("god_notification", (n: GodNotification) => {
      setMessages((prev) => [
        ...prev,
        { text: n.text, type: "action" as const, isSystem: true as const }
      ]);
    });
    socket.on("system_message", (m: SystemMessage) =>
      setMessages((prev) => [...prev, { ...m, isSystem: true as const }])
    );
    socket.on("chat_message", (m: ChatMessage) =>
      setMessages((prev) => [...prev, { ...m, isSystem: false as const }])
    );
    socket.on("vote_started", ({ endTime, duration, type }: any) => {
      setVotingActive(true);
      setVoteEndTime(endTime);
      setMyVote(null);
      setVotes({});
      setVoteType(type || "eliminate");
    });
    socket.on("vote_updated", ({ votes: v }: any) => setVotes(v));
    socket.on("vote_result", ({ type, passed, roleList }: any) => {
      setVotingActive(false);
      setMyVote(null);
      if (type === "inquiry" && passed && roleList) {
        setInquiryResult({ roleList, passed });
        setTimeout(() => setInquiryResult(null), 10000);
      }
    });

    // ★ ایموجی — فلوت ۲ ثانیه
    socket.on(
      "emoji_received",
      ({ targetId, emoji }: { targetId: string; emoji: string }) => {
        const eid = `${Date.now()}-${Math.random()}`;
        setFloatingEmojis((prev) => [...prev, { id: eid, emoji, targetId }]);
        setTimeout(
          () => setFloatingEmojis((prev) => prev.filter((e) => e.id !== eid)),
          2000
        );
      }
    );

    socket.on("investigate_result", ({ targetName, result }: any) => {
      setMessages((prev) => [
        ...prev,
        {
          text: `🔍 نتیجه استعلام ${targetName}: ${result}`,
          type: "reveal" as const,
          isSystem: true as const
        }
      ]);
    });
    socket.on("error", ({ message }: any) => alert(message));

    return () => {
      [
        "lobby_data",
        "lobby_updated",
        "your_role",
        "all_roles",
        "game_starting",
        "game_started",
        "phase_changed",
        "awake_group_changed",
        "chat_permission_changed",
        "action_confirmed",
        "player_eliminated",
        "mute_changed",
        "role_revealed",
        "game_ended",
        "play_sound",
        "god_notification",
        "system_message",
        "chat_message",
        "vote_started",
        "vote_updated",
        "vote_result",
        "emoji_received",
        "investigate_result",
        "error"
      ].forEach((e) => socket.off(e));
      [countdownRef, phaseTimerRef, voteTimerRef].forEach((r) => {
        if (r.current) clearInterval(r.current);
      });
      if (bgMusicRef.current) bgMusicRef.current.pause();
    };
  }, [code, playLocalSound, updateBgMusic]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = () => {
    if (!chatInput.trim()) return;
    getSocket().emit("chat_message", {
      code,
      playerId,
      message: chatInput.trim()
    });
    setChatInput("");
  };
  const handleGodAction = (action: string, targetId: string) => {
    const map: Record<string, string> = {
      eliminate: "eliminate_player",
      toggle_mute: "toggle_mute",
      skip_vote: "skip_vote",
      reveal_role: "reveal_role",
      revive: "revive_player"
    };
    getSocket().emit(map[action] || action, { code, playerId, targetId });
  };
  const castVote = (targetId: string) => {
    getSocket().emit("cast_vote", { code, playerId, targetId });
    setMyVote(targetId);
  };
  const saveTestament = () => {
    getSocket().emit("save_testament", { code, playerId, text: testament });
    setShowTestament(false);
  };

  const isDay = lobby?.phase === "day";
  const myAction = getMyAction();
  const myTurn = isMyTurn();

  // ── Game Ended ──
  if (gameEnded) {
    return (
      <div className="min-h-screen night-theme flex items-center justify-center p-4">
        <div className="glass-dark rounded-3xl p-6 sm:p-8 max-w-lg w-full text-center animate-slide-up">
          <div className="text-5xl sm:text-6xl mb-4">
            {gameEnded.winner === "مافیا" ? "🔫" : "👥"}
          </div>
          <h1 className="text-2xl sm:text-4xl font-black text-white mb-2">
            {gameEnded.winner} برنده شد!
          </h1>
          <div className="space-y-1.5 mb-6 max-h-60 overflow-y-auto">
            {gameEnded.players.map((p) => {
              const ri = DEFAULT_ROLES.find((r) => r.name === p.role);
              return (
                <div
                  key={p.id}
                  className={`flex items-center justify-between rounded-xl p-2.5 text-sm ${p.isGod ? "bg-yellow-500/10 border border-yellow-500/20" : p.isAlive ? "bg-green-500/10 border border-green-500/20" : "bg-red-500/10 border border-red-500/20 opacity-60"}`}
                >
                  <div className="flex items-center gap-2">
                    {p.isGod && <Crown className="w-4 h-4 text-yellow-400" />}
                    <span className="text-white font-medium">{p.name}</span>
                    {p.id === playerId && (
                      <span className="text-white/30 text-xs">(شما)</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {!p.isGod && (
                      <>
                        <span>{ri?.icon}</span>
                        <span
                          className="text-xs font-bold"
                          style={{ color: ri?.color }}
                        >
                          {p.role}
                        </span>
                      </>
                    )}
                    {!p.isAlive && !p.isGod && (
                      <span className="text-xs">☠️</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <button
            onClick={() => router.push("/")}
            className="btn-primary w-full"
          >
            بازگشت به خانه
          </button>
        </div>
      </div>
    );
  }

  if (!lobby)
    return (
      <div className="min-h-screen night-theme flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-red-500/30 border-t-red-500 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white/50">در حال بارگذاری...</p>
        </div>
      </div>
    );

  // ── Chat Panel ──
  const chatPanel = (
    <div className="glass-dark rounded-2xl p-3 flex flex-col h-72 sm:h-80">
      <h3 className="text-white font-bold mb-2 flex items-center gap-2 text-xs">
        <MessageCircle className="w-3.5 h-3.5 text-red-400" />
        چت
        {!canChat && !isGod && (
          <span className="text-red-400/60 text-[10px]">🔒</span>
        )}
      </h3>
      <div className="flex-1 overflow-y-auto space-y-1.5 mb-2">
        {messages.map((msg, idx) => {
          if (msg.isSystem)
            return (
              <div key={idx} className="text-center">
                <span className="text-white/30 text-[10px] bg-white/5 px-2 py-0.5 rounded-full">
                  {msg.text}
                </span>
              </div>
            );
          const cm = msg as ChatMessage & { isSystem: false };
          return (
            <div key={idx} className="flex flex-col">
              <div className="flex items-center gap-1 mb-0.5">
                {cm.isGod && <Crown className="w-2.5 h-2.5 text-yellow-400" />}
                {cm.isNightChat && (
                  <Moon className="w-2.5 h-2.5 text-indigo-400" />
                )}
                <span
                  className={`text-[10px] font-bold ${cm.isGod ? "text-yellow-400" : cm.isNightChat ? "text-indigo-400" : "text-red-400"}`}
                >
                  {cm.playerName}
                </span>
              </div>
              <p
                className={`text-[10px] rounded-lg px-2 py-1 ${cm.isNightChat ? "text-indigo-200 bg-indigo-500/10" : "text-white/80 bg-white/5"}`}
              >
                {cm.message}
              </p>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>
      <div className="flex gap-1.5">
        <input
          type="text"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder={canChat || isGod ? "پیام..." : "🔒"}
          className="flex-1 bg-white/10 border border-white/20 text-white placeholder-white/30 rounded-lg px-2.5 py-1.5 text-[10px] focus:outline-none focus:border-red-500 disabled:opacity-40"
          disabled={(!canChat && !isGod) || (isGodMuted && !isGod)}
        />
        <button
          onClick={sendMessage}
          disabled={(!canChat && !isGod) || (isGodMuted && !isGod)}
          className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-2.5 py-1.5 text-[10px] disabled:opacity-50"
        >
          ارسال
        </button>
      </div>
    </div>
  );

  // ── Vote Panel ──
  const votePanel = votingActive && (
    <div className="glass-dark rounded-2xl p-3 border border-blue-500/20 animate-slide-up">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Vote className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-white font-bold text-xs">
            {voteType === "inquiry" ? "نظرسنجی استعلام" : "رأی‌گیری اخراج"}
          </span>
        </div>
        <span className="text-white/70 font-mono text-xs">{voteTimer}</span>
      </div>
      {!isGod ? (
        voteType === "inquiry" ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => castVote("yes")}
              disabled={!!myVote}
              className={`py-2.5 rounded-xl text-sm font-bold transition-all ${myVote === "yes" ? "bg-green-600 text-white ring-2 ring-green-400" : myVote ? "bg-white/5 text-white/30" : "bg-green-600/20 hover:bg-green-600/40 text-green-300"}`}
            >
              ✅ بله
            </button>
            <button
              onClick={() => castVote("no")}
              disabled={!!myVote}
              className={`py-2.5 rounded-xl text-sm font-bold transition-all ${myVote === "no" ? "bg-red-600 text-white ring-2 ring-red-400" : myVote ? "bg-white/5 text-white/30" : "bg-red-600/20 hover:bg-red-600/40 text-red-300"}`}
            >
              ❌ خیر
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1 max-h-36 overflow-y-auto">
            {lobby.players
              .filter((p) => p.isAlive && !p.isGod)
              .map((p) => (
                <button
                  key={p.id}
                  onClick={() => castVote(p.id)}
                  disabled={!!myVote}
                  className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-all ${myVote === p.id ? "bg-blue-600 text-white ring-1 ring-blue-400" : myVote ? "bg-white/5 text-white/30" : "bg-white/10 hover:bg-white/20 text-white"}`}
                >
                  {p.name}
                  {Object.values(votes).filter((v) => v === p.id).length >
                    0 && (
                    <span className="mr-1 text-blue-300 text-[10px]">
                      ({Object.values(votes).filter((v) => v === p.id).length})
                    </span>
                  )}
                </button>
              ))}
          </div>
        )
      ) : (
        <div className="text-center">
          <p className="text-yellow-300 text-xs animate-pulse">
            🗳️ در جریان...
          </p>
          <p className="text-white/40 text-[10px] mt-1">
            {Object.keys(votes).length} رأی
          </p>
        </div>
      )}
      {myVote && (
        <p className="text-green-300 text-[10px] text-center mt-2">
          ✅ رأی ثبت شد
        </p>
      )}
    </div>
  );

  return (
    <div
      className={`min-h-screen transition-all duration-1000 phase-transition ${isDay ? "day-theme" : "night-theme"}`}
    >
      {/* ★ Voice: isMuted از ترکیب self+god محاسبه میشه */}
      <VoiceManager
        code={code}
        playerId={playerId}
        isMuted={isMuted}
        isGod={isGod}
        onSpeakingChange={handleSpeakingChange}
      />
      {showRoleCard && myRole && (
        <RoleCard role={myRole} onClose={() => setShowRoleCard(false)} />
      )}

      {countdown !== null && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="text-center animate-fade-in">
            <p className="text-white/60 text-lg mb-2">بازی شروع می‌شود</p>
            <div
              className="text-6xl sm:text-8xl font-black text-white"
              style={{ textShadow: "0 0 40px rgba(239,68,68,0.8)" }}
            >
              {countdown}
            </div>
            {myRole && (
              <div className="mt-4 glass-dark rounded-2xl px-6 py-3">
                <p className="text-white/50 text-sm">نقش شما</p>
                <p className="text-white font-black text-xl">{myRole}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ★ نتیجه استعلام گرافیکی */}
      {inquiryResult && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setInquiryResult(null)}
        >
          <div
            className="glass-dark rounded-3xl p-6 max-w-md w-full mx-4 animate-slide-up border border-blue-500/30"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-blue-400 font-black text-lg text-center mb-4">
              🔍 نقش‌های باقی‌مانده
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {inquiryResult.roleList.split(" | ").map((item, idx) => {
                const parts = item.split(": ");
                const roleName = parts[0]?.trim() || "";
                const countStr = parts[1]?.trim() || "0";
                const roleInfo = DEFAULT_ROLES.find((r) => r.name === roleName);
                return (
                  <div
                    key={idx}
                    className="flex items-center gap-2 rounded-xl p-3 bg-white/5 border border-white/10"
                  >
                    <span className="text-2xl">{roleInfo?.icon || "❓"}</span>
                    <div>
                      <p className="text-white text-sm font-bold">{roleName}</p>
                      <p
                        className="text-xs"
                        style={{ color: roleInfo?.color || "#9ca3af" }}
                      >
                        {countStr} نفر
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-white/30 text-xs text-center mt-4">کلیک کنید</p>
          </div>
        </div>
      )}

      {actionConfirmed && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 animate-slide-up">
          <div className="glass-dark rounded-2xl px-6 py-3 border border-green-500/30 text-center">
            <p className="text-green-300 font-bold text-sm">
              ✅ {myAction?.icon} {myAction?.label}: {actionConfirmed}
            </p>
          </div>
        </div>
      )}
      {revealedRole && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 animate-slide-up">
          <div className="glass-dark rounded-2xl px-6 py-3 border border-purple-500/30 text-center">
            <p className="text-purple-300 text-sm">نقش فاش شد</p>
            <p className="text-white font-bold">
              {revealedRole.playerName}:{" "}
              <span className="text-purple-300">{revealedRole.role}</span>
            </p>
          </div>
        </div>
      )}

      {showTestament && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowTestament(false)}
        >
          <div
            className="glass-dark rounded-2xl p-6 max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-white font-bold mb-3 flex items-center gap-2">
              <FileText className="w-4 h-4 text-amber-400" />
              وصیت‌نامه
            </h3>
            <textarea
              value={testament}
              onChange={(e) => setTestament(e.target.value)}
              placeholder="وصیت خود را بنویسید..."
              className="w-full h-32 bg-white/10 border border-white/20 text-white placeholder-white/30 rounded-xl p-3 text-sm resize-none focus:outline-none focus:border-red-500"
              maxLength={500}
            />
            <p className="text-white/30 text-xs text-left mt-1">
              {testament.length}/500
            </p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={saveTestament}
                className="flex-1 btn-primary py-2 text-sm"
              >
                ذخیره
              </button>
              <button
                onClick={() => setShowTestament(false)}
                className="flex-1 btn-secondary py-2 text-sm"
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto p-2 sm:p-4">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold glass-dark text-xs sm:text-sm">
              {isDay ? (
                <Sun className="w-3.5 h-3.5 text-amber-400" />
              ) : (
                <Moon className="w-3.5 h-3.5 text-indigo-400" />
              )}
              <span className="text-white">
                {isDay ? "روز" : "شب"} {lobby.round}
              </span>
              <span className="text-white/30 mx-1">|</span>
              <Clock className="w-3 h-3 text-white/50" />
              <span className="text-white/70 font-mono text-xs">
                {phaseTimer}
              </span>
            </div>
            {myTurn && myAction && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl glass-dark border border-yellow-500/30 animate-pulse">
                <Target className="w-3 h-3 text-yellow-400" />
                <span className="text-yellow-300 text-[10px] sm:text-xs font-bold">
                  نوبت: {myAction.icon} {myAction.label}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {myRole && (
              <button
                onClick={() => setShowRoleCard(true)}
                className="glass-dark rounded-lg px-2 py-1.5 text-white/70 hover:text-white text-[10px] sm:text-xs"
              >
                نقش: <span className="text-white font-bold">{myRole}</span>
              </button>
            )}
            {!isGod && (
              <button
                onClick={() => setShowTestament(true)}
                className="glass-dark rounded-lg p-1.5 text-amber-400/70 hover:text-amber-400"
                title="وصیت‌نامه"
              >
                <FileText className="w-4 h-4" />
              </button>
            )}
            {/* ★ میکروفن — برای همه شامل گاد */}
            <button
              onClick={toggleMute}
              className={`rounded-lg p-1.5 transition-all ${isMuted ? "bg-red-600/30 border border-red-500/50 text-red-300" : "bg-green-600/30 border border-green-500/50 text-green-300"} ${isGodMuted && !isGod ? "opacity-50 cursor-not-allowed" : ""}`}
              title={
                isGodMuted && !isGod
                  ? "گاد میوت کرده"
                  : isMuted
                    ? "میکروفن خاموش"
                    : "میکروفن روشن"
              }
            >
              {isMuted ? (
                <MicOff className="w-4 h-4" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={() => setShowChat(!showChat)}
              className={`rounded-lg p-1.5 transition-all ${showChat ? "bg-green-600/30 border border-green-500/50 text-green-300" : "bg-red-600/30 border border-red-500/50 text-red-300"}`}
            >
              <MessageCircle className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-3">
          <div className="flex-1 space-y-3">
            {/* میز بازی */}
            <div className="glass-dark rounded-2xl sm:rounded-3xl p-4 sm:p-6 min-h-[280px] sm:min-h-96 relative">
              <div className="text-center mb-4">
                <span className="text-white/30 text-xs">میز بازی</span>
              </div>
              <div className="flex flex-wrap justify-center gap-4 sm:gap-6">
                {lobby.players.map((player) => (
                  <div key={player.id} className="relative group">
                    <PlayerSeat
                      player={player}
                      isMe={player.id === playerId}
                      isGodView={isGod}
                      onAction={isGod ? handleGodAction : undefined}
                      showActions={isGod}
                      isSpeaking={speakingMap[player.id] || false}
                    />

                    {/* ★ فلوتینگ ایموجی — ۲ ثانیه گوشه پروفایل */}
                    {floatingEmojis
                      .filter((e) => e.targetId === player.id)
                      .map((e) => (
                        <div
                          key={e.id}
                          className="absolute -top-3 -right-3 text-2xl pointer-events-none z-20 animate-bounce drop-shadow-lg"
                        >
                          {e.emoji}
                        </div>
                      ))}

                    {/* ★ دکمه‌های ایموجی — مستقیم زیر پروفایل */}
                    {player.id !== playerId &&
                      player.isAlive &&
                      !player.isGod && (
                        <div className="flex gap-0.5 justify-center mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {PLAYER_EMOJIS.map((e) => (
                            <button
                              key={e.id}
                              onClick={() => sendEmoji(player.id, e.icon)}
                              className="text-sm hover:scale-150 active:scale-75 transition-transform cursor-pointer"
                            >
                              {e.icon}
                            </button>
                          ))}
                        </div>
                      )}

                    {/* اکشن شب */}
                    {myTurn &&
                      myAction &&
                      !player.isGod &&
                      player.isAlive &&
                      player.id !== playerId && (
                        <button
                          onClick={() => sendAction(player.id)}
                          className={`absolute -bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded text-[10px] font-bold transition-all z-10 ${actionTarget === player.id ? "bg-yellow-500 text-black scale-110" : "bg-white/10 hover:bg-white/20 text-white/80"}`}
                        >
                          {myAction.icon}
                        </button>
                      )}
                  </div>
                ))}
              </div>
              <div className="absolute bottom-3 left-3 right-3 flex justify-between text-white/30 text-[10px]">
                <span>
                  زنده:{" "}
                  {lobby.players.filter((p) => p.isAlive && !p.isGod).length}
                </span>
                <span>
                  حذف: {lobby.players.filter((p) => !p.isAlive).length}
                </span>
              </div>
            </div>
            <div className="hidden lg:block">{showChat && chatPanel}</div>
          </div>

          {/* ستون کناری */}
          <div className="w-full lg:w-80 space-y-3">
            {isGod && (
              <GodPanel
                lobby={lobby}
                code={code}
                playerId={playerId}
                playerRoles={playerRoles}
              />
            )}
            <div className="lg:hidden">{showChat && chatPanel}</div>
            <div className="glass-dark rounded-2xl p-3">
              <h3 className="text-white/60 text-[10px] font-bold mb-2">
                نقش‌های بازی
              </h3>
              <div className="grid grid-cols-2 gap-1">
                {lobby.roles
                  .filter((r) => r.count > 0)
                  .map((role) => {
                    const info = DEFAULT_ROLES.find(
                      (r) => r.name === role.name
                    );
                    return (
                      <div
                        key={role.name}
                        className="flex items-center justify-between text-[10px]"
                      >
                        <div className="flex items-center gap-1">
                          <span>{info?.icon}</span>
                          <span className="text-white/70">{role.name}</span>
                        </div>
                        <span className="text-white/30">×{role.count}</span>
                      </div>
                    );
                  })}
              </div>
            </div>
            {votePanel}
          </div>
        </div>
      </div>
    </div>
  );
}
