"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { LobbyData, Player, PlayerRole, GameLogEntry } from "@/app/lib/types";
import { getSocket } from "@/app/lib/socket";
import { NIGHT_GROUPS } from "@/app/lib/roles";
import {
  Sun,
  Moon,
  Skull,
  Mic,
  MicOff,
  Eye,
  Heart,
  Shield,
  StopCircle,
  Volume2,
  VolumeX,
  Clock,
  Users,
  Crosshair,
  Vote,
  FileText,
  ChevronDown,
  ChevronUp,
  Search
} from "lucide-react";

interface GodPanelProps {
  lobby: LobbyData;
  code: string;
  playerId: string;
  playerRoles?: PlayerRole[];
}

export default function GodPanel({
  lobby,
  code,
  playerId,
  playerRoles
}: GodPanelProps) {
  const [showEndGame, setShowEndGame] = useState(false);
  const [phaseTimer, setPhaseTimer] = useState("00:00");
  const [voteDuration, setVoteDuration] = useState(60);
  const [gameLog, setGameLog] = useState<GameLogEntry[]>([]);
  const [currentEvents, setCurrentEvents] = useState<string[]>([]);
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({
    night: true,
    mute: false,
    players: true,
    vote: false,
    log: false
  });
  const phaseTimerRef = useRef<NodeJS.Timeout | null>(null);

  const emit = (event: string, extra = {}) =>
    getSocket().emit(event, { code, playerId, ...extra });
  const toggleSection = (key: string) =>
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));

  // تایمر فاز
  useEffect(() => {
    const st = lobby.phaseStartTime || Date.now();
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
  }, [lobby.phase, lobby.round, lobby.phaseStartTime]);

  // لاگ
  const fetchLog = useCallback(() => {
    const socket = getSocket();
    socket.emit("get_game_log", { code, playerId });
    socket.once("game_log", ({ log, currentEvents: ce }: any) => {
      setGameLog(log);
      setCurrentEvents(ce);
    });
  }, [code, playerId]);

  useEffect(() => {
    if (expandedSections.log) fetchLog();
  }, [expandedSections.log, fetchLog]);

  const handleAction = (action: string, targetId: string) => {
    const map: Record<string, string> = {
      eliminate: "eliminate_player",
      toggle_mute: "toggle_mute",
      skip_vote: "skip_vote",
      reveal_role: "reveal_role",
      revive: "revive_player"
    };
    emit(map[action] || action, { targetId });
  };

  const nonGodPlayers = lobby.players.filter((p) => !p.isGod);
  const getPlayerRole = (id: string) =>
    playerRoles?.find((p) => p.id === id)?.role || null;
  const activeNightGroups = NIGHT_GROUPS.filter((g) => {
    if (g.id === "mafia")
      return nonGodPlayers.some(
        (p) =>
          p.isAlive && playerRoles?.find((r) => r.id === p.id)?.team === "mafia"
      );
    return nonGodPlayers.some((p) => p.isAlive && getPlayerRole(p.id) === g.id);
  });

  const SectionHeader = ({
    title,
    icon,
    sectionKey
  }: {
    title: string;
    icon: React.ReactNode;
    sectionKey: string;
  }) => (
    <button
      onClick={() => toggleSection(sectionKey)}
      className="flex items-center justify-between w-full text-white/50 text-xs mb-2 hover:text-white/70 transition-colors"
    >
      <span className="flex items-center gap-1">
        {icon}
        {title}
      </span>
      {expandedSections[sectionKey] ? (
        <ChevronUp className="w-3 h-3" />
      ) : (
        <ChevronDown className="w-3 h-3" />
      )}
    </button>
  );

  return (
    <div className="glass-dark rounded-2xl p-3 space-y-3 max-h-[85vh] overflow-y-auto text-sm">
      <h2 className="text-yellow-400 font-black flex items-center gap-2 text-base">
        👑 پنل گاد
      </h2>

      {/* تایمر + فاز */}
      <div className="flex items-center justify-between rounded-xl p-2 bg-white/5 border border-white/10">
        <div className="flex items-center gap-2">
          {lobby.phase === "day" ? (
            <Sun className="w-4 h-4 text-amber-400" />
          ) : (
            <Moon className="w-4 h-4 text-indigo-400" />
          )}
          <span className="text-white font-bold text-xs">
            {lobby.phase === "day" ? "روز" : "شب"} {lobby.round}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Clock className="w-3 h-3 text-white/50" />
          <span className="text-white font-mono font-bold">{phaseTimer}</span>
        </div>
      </div>

      {/* Phase Control */}
      <button
        onClick={() => emit("toggle_phase")}
        className={`w-full py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95 text-xs ${lobby.phase === "day" ? "bg-indigo-700 hover:bg-indigo-800 text-white" : "bg-amber-500 hover:bg-amber-600 text-white"}`}
      >
        {lobby.phase === "day" ? (
          <>
            <Moon className="w-4 h-4" />
            رفتن به شب
          </>
        ) : (
          <>
            <Sun className="w-4 h-4" />
            رفتن به روز
          </>
        )}
      </button>

      {/* گروه بیدار در شب */}
      {lobby.phase === "night" && (
        <div className="rounded-xl p-2 bg-white/5 border border-white/10">
          <SectionHeader
            title="بیدار کردن گروه"
            icon={<Crosshair className="w-3 h-3" />}
            sectionKey="night"
          />
          {expandedSections.night && (
            <div className="grid grid-cols-2 gap-1">
              {activeNightGroups.map((group) => {
                const isActive = lobby.awakeGroup === group.id;
                return (
                  <button
                    key={group.id}
                    onClick={() =>
                      emit("set_awake_group", {
                        group: isActive ? null : group.id
                      })
                    }
                    className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 ${!isActive ? "bg-white/5 hover:bg-white/10 text-white/70" : ""}`}
                    style={
                      isActive
                        ? {
                            backgroundColor: group.color + "30",
                            color: group.color,
                            outline: `2px solid ${group.color}`,
                            outlineOffset: "1px"
                          }
                        : {}
                    }
                  >
                    <span>{group.icon}</span>
                    {group.label}
                  </button>
                );
              })}
              {lobby.awakeGroup && (
                <button
                  onClick={() => emit("set_awake_group", { group: null })}
                  className="col-span-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 text-xs"
                >
                  همه بخوابند
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* کنترل صدا */}
      <div className="rounded-xl p-2 bg-white/5 border border-white/10">
        <SectionHeader
          title="کنترل صدا"
          icon={<Volume2 className="w-3 h-3" />}
          sectionKey="mute"
        />
        {expandedSections.mute && (
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => emit("mute_all", { mute: true })}
              className="py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/40 text-red-300 text-xs font-bold flex items-center justify-center gap-1"
            >
              <VolumeX className="w-3 h-3" />
              میوت همه
            </button>
            <button
              onClick={() => emit("mute_all", { mute: false })}
              className="py-1.5 rounded-lg bg-green-600/20 hover:bg-green-600/40 text-green-300 text-xs font-bold flex items-center justify-center gap-1"
            >
              <Volume2 className="w-3 h-3" />
              آنمیوت همه
            </button>
          </div>
        )}
      </div>

      {/* بازیکنان */}
      <div className="rounded-xl p-2 bg-white/5 border border-white/10">
        <SectionHeader
          title={`بازیکنان (${nonGodPlayers.filter((p) => p.isAlive).length}/${nonGodPlayers.length})`}
          icon={<Users className="w-3 h-3" />}
          sectionKey="players"
        />
        {expandedSections.players && (
          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {nonGodPlayers.map((player: Player) => {
              const role = getPlayerRole(player.id);
              return (
                <div
                  key={player.id}
                  className={`flex items-center justify-between rounded-lg p-1.5 transition-all ${!player.isAlive ? "opacity-40 bg-gray-800/50" : "bg-white/5 hover:bg-white/10"}`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${player.isAlive ? "bg-green-400" : "bg-gray-600"}`}
                    />
                    <div className="min-w-0">
                      <span className="text-white text-xs font-medium block truncate">
                        {player.name}
                      </span>
                      {role && (
                        <span className="text-white/40 text-[10px]">
                          {role}
                        </span>
                      )}
                    </div>
                    {!player.canVote && player.isAlive && (
                      <span className="text-orange-400 text-[10px] bg-orange-400/10 px-1 rounded-full">
                        بدون رای
                      </span>
                    )}
                    {!player.isAlive && (
                      <span className="text-gray-500 text-[10px]">☠️</span>
                    )}
                  </div>
                  <div className="flex gap-0.5 flex-shrink-0">
                    <button
                      onClick={() => handleAction("toggle_mute", player.id)}
                      className={`p-1 rounded transition-colors ${player.isMuted ? "bg-red-600/50 text-red-300" : "bg-white/10 text-white/60"}`}
                    >
                      {player.isMuted ? (
                        <MicOff className="w-3 h-3" />
                      ) : (
                        <Mic className="w-3 h-3" />
                      )}
                    </button>
                    <button
                      onClick={() => handleAction("skip_vote", player.id)}
                      className={`p-1 rounded transition-colors ${!player.canVote ? "bg-orange-600/50 text-orange-300" : "bg-white/10 text-white/60"}`}
                    >
                      <Shield className="w-3 h-3" />
                    </button>
                    {player.isAlive && (
                      <button
                        onClick={() => handleAction("reveal_role", player.id)}
                        className="p-1 rounded bg-purple-600/30 text-purple-300"
                      >
                        <Eye className="w-3 h-3" />
                      </button>
                    )}
                    {player.isAlive ? (
                      <button
                        onClick={() => handleAction("eliminate", player.id)}
                        className="p-1 rounded bg-red-600/30 text-red-300"
                      >
                        <Skull className="w-3 h-3" />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleAction("revive", player.id)}
                        className="p-1 rounded bg-green-600/30 text-green-300"
                      >
                        <Heart className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* رأی‌گیری */}
      {lobby.phase === "day" && (
        <div className="rounded-xl p-2 bg-white/5 border border-white/10">
          <SectionHeader
            title="رأی‌گیری / نظرسنجی"
            icon={<Vote className="w-3 h-3" />}
            sectionKey="vote"
          />
          {expandedSections.vote &&
            (lobby.votingActive ? (
              <div className="text-center">
                <p className="text-yellow-300 text-xs font-bold animate-pulse">
                  🗳️{" "}
                  {(lobby as any).votingType === "inquiry"
                    ? "نظرسنجی استعلام"
                    : "رأی‌گیری"}{" "}
                  در جریان...
                </p>
                <p className="text-white/40 text-xs mt-1">
                  {Object.keys(lobby.votes || {}).length} رأی ثبت شده
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-white/50 text-xs">مدت:</span>
                  <input
                    type="number"
                    value={voteDuration}
                    onChange={(e) => setVoteDuration(Number(e.target.value))}
                    min={10}
                    max={300}
                    className="bg-white/10 border border-white/20 text-white rounded-lg px-2 py-1 text-xs w-16 text-center"
                  />
                  <span className="text-white/50 text-xs">ثانیه</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() =>
                      emit("start_vote", {
                        duration: voteDuration,
                        type: "eliminate"
                      })
                    }
                    className="py-2 rounded-lg bg-red-600/80 hover:bg-red-600 text-white text-xs font-bold flex items-center justify-center gap-1"
                  >
                    <Vote className="w-3 h-3" />
                    اخراج
                  </button>
                  <button
                    onClick={() =>
                      emit("start_vote", {
                        duration: voteDuration,
                        type: "inquiry"
                      })
                    }
                    className="py-2 rounded-lg bg-blue-600/80 hover:bg-blue-600 text-white text-xs font-bold flex items-center justify-center gap-1"
                  >
                    <Search className="w-3 h-3" />
                    استعلام وضعیت
                  </button>
                </div>
                <p className="text-white/30 text-xs text-center">
                  حد نصاب اخراج:{" "}
                  {Math.floor(
                    nonGodPlayers.filter((p) => p.isAlive).length / 2
                  ) + 1}{" "}
                  رأی
                </p>
              </div>
            ))}
        </div>
      )}

      {/* لاگ بازی */}
      <div className="rounded-xl p-2 bg-white/5 border border-white/10">
        <SectionHeader
          title="لاگ بازی"
          icon={<FileText className="w-3 h-3" />}
          sectionKey="log"
        />
        {expandedSections.log && (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            <button
              onClick={fetchLog}
              className="w-full py-1 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 text-[10px]"
            >
              بروزرسانی لاگ
            </button>
            {currentEvents.length > 0 && (
              <div className="border-r-2 border-yellow-400 pr-2">
                <p className="text-yellow-400 text-[10px] font-bold">
                  فاز فعلی:
                </p>
                {currentEvents.map((e, i) => (
                  <p key={i} className="text-white/60 text-[10px]">
                    • {e}
                  </p>
                ))}
              </div>
            )}
            {[...gameLog].reverse().map((entry, idx) => {
              const duration =
                entry.endTime && entry.startTime
                  ? Math.floor((entry.endTime - entry.startTime) / 1000)
                  : 0;
              return (
                <div key={idx} className="border-r-2 border-white/20 pr-2">
                  <p className="text-white/60 text-[10px] font-bold">
                    {entry.phase === "day" ? "☀️" : "🌙"}{" "}
                    {entry.phase === "day" ? "روز" : "شب"} {entry.round}
                    <span className="text-white/30 mr-1">
                      ({duration} ثانیه)
                    </span>
                  </p>
                  {entry.eliminated.length > 0 && (
                    <p className="text-red-400 text-[10px]">
                      ☠️ حذف: {entry.eliminated.join("، ")}
                    </p>
                  )}
                  {entry.saved.length > 0 && (
                    <p className="text-green-400 text-[10px]">
                      💚 نجات: {entry.saved.join("، ")}
                    </p>
                  )}
                  {entry.events.map((e, i) => (
                    <p key={i} className="text-white/40 text-[10px]">
                      • {e}
                    </p>
                  ))}
                </div>
              );
            })}
            {gameLog.length === 0 && currentEvents.length === 0 && (
              <p className="text-white/30 text-[10px] text-center">
                لاگی ثبت نشده
              </p>
            )}
          </div>
        )}
      </div>

      {/* End Game */}
      <div className="border-t border-white/10 pt-2">
        {!showEndGame ? (
          <button
            onClick={() => setShowEndGame(true)}
            className="w-full py-1.5 rounded-xl bg-gray-700 hover:bg-gray-600 text-white/70 text-xs flex items-center justify-center gap-1"
          >
            <StopCircle className="w-3 h-3" />
            پایان بازی
          </button>
        ) : (
          <div className="space-y-1.5">
            <p className="text-white/60 text-[10px] text-center">برنده:</p>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => {
                  emit("end_game", { winner: "مافیا" });
                  setShowEndGame(false);
                }}
                className="py-1.5 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-bold"
              >
                🔫 مافیا
              </button>
              <button
                onClick={() => {
                  emit("end_game", { winner: "شهروندان" });
                  setShowEndGame(false);
                }}
                className="py-1.5 rounded-xl bg-green-700 hover:bg-green-600 text-white text-xs font-bold"
              >
                👥 شهروند
              </button>
            </div>
            <button
              onClick={() => setShowEndGame(false)}
              className="w-full py-1 rounded-xl bg-white/5 text-white/40 text-[10px]"
            >
              انصراف
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
