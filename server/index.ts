import { createServer } from "http";
import { Server } from "socket.io";
import { v4 } from "uuid";

const uuidv4 = v4 as () => string;

// ─── Types ───────────────────────────────────────────────────────────────────

interface Player {
  id: string;
  name: string;
  socketId: string;
  role: string | null;
  team: string | null;
  isAlive: boolean;
  isSelfMuted: boolean;
  isGodMuted: boolean;
  isReady: boolean;
  isGod: boolean;
  canVote: boolean;
  testament: string;
}

interface RoleAction {
  playerId: string;
  playerName: string;
  role: string;
  targetId: string;
  targetName: string;
  action: string;
  timestamp: number;
}

interface GameLogEntry {
  round: number;
  phase: "day" | "night";
  startTime: number;
  endTime: number;
  events: string[];
  eliminated: string[];
  saved: string[];
}

interface VoteSession {
  active: boolean;
  endTime: number;
  duration: number;
  votes: Record<string, string>;
  timer: NodeJS.Timeout | null;
  type: "eliminate" | "inquiry";
}

interface Lobby {
  code: string;
  godId: string;
  players: Player[];
  roles: RoleConfig[];
  maxPlayers: number;
  status: "waiting" | "starting" | "playing" | "ended";
  phase: "day" | "night";
  round: number;
  skipVote: string[];
  phaseStartTime: number;
  awakeGroup: string | null;
  nightActions: RoleAction[];
  gameLog: GameLogEntry[];
  currentLogEvents: string[];
  currentEliminated: string[];
  currentSaved: string[];
  voteSession: VoteSession;
}

interface RoleConfig {
  name: string;
  team: "mafia" | "citizen" | "independent";
  count: number;
}

// ─── State ────────────────────────────────────────────────────────────────────

const lobbies = new Map<string, Lobby>();
const disconnectTimers = new Map<string, NodeJS.Timeout>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateLobbyCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  if (lobbies.has(code)) return generateLobbyCode();
  return code;
}

function assignRoles(players: Player[], roles: RoleConfig[]): Player[] {
  const roleList: { name: string; team: string }[] = [];
  roles.forEach((r) => {
    for (let i = 0; i < r.count; i++) roleList.push({ name: r.name, team: r.team });
  });
  while (roleList.length < players.length) roleList.push({ name: "شهروند ساده", team: "citizen" });
  for (let i = roleList.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roleList[i], roleList[j]] = [roleList[j], roleList[i]];
  }
  return players.map((p, idx) => ({
    ...p,
    role: roleList[idx]?.name ?? "شهروند ساده",
    team: roleList[idx]?.team ?? "citizen",
  }));
}

function getVoteThreshold(alivePlayers: number): number {
  return Math.floor(alivePlayers / 2) + 1;
}

function getLobbyPublicData(lobby: Lobby) {
  return {
    code: lobby.code,
    status: lobby.status,
    phase: lobby.phase,
    round: lobby.round,
    maxPlayers: lobby.maxPlayers,
    roles: lobby.roles,
    phaseStartTime: lobby.phaseStartTime,
    awakeGroup: lobby.awakeGroup,
    votingActive: lobby.voteSession.active,
    votingEndTime: lobby.voteSession.endTime,
    votingType: lobby.voteSession.type,
    votes: lobby.voteSession.votes,
    players: lobby.players.map((p) => ({
      id: p.id,
      name: p.name,
      socketId: p.socketId,
      isAlive: p.isAlive,
      isMuted: p.isGodMuted || p.isSelfMuted,
      isReady: p.isReady,
      isGod: p.id === lobby.godId,
      canVote: p.canVote,
    })),
  };
}

function canPlayerChat(lobby: Lobby, player: Player): boolean {
  if (player.isGod) return true;
  if (!player.isAlive) return false;
  if (player.isGodMuted) return false;
  if (lobby.phase === "day") return true;
  if (!lobby.awakeGroup) return false;
  if (lobby.awakeGroup === "mafia") return player.team === "mafia";
  return player.role === lobby.awakeGroup;
}

function addLogEvent(lobby: Lobby, event: string) {
  lobby.currentLogEvents.push(event);
}

function savePhaseLog(lobby: Lobby) {
  lobby.gameLog.push({
    round: lobby.round,
    phase: lobby.phase,
    startTime: lobby.phaseStartTime,
    endTime: Date.now(),
    events: [...lobby.currentLogEvents],
    eliminated: [...lobby.currentEliminated],
    saved: [...lobby.currentSaved],
  });
  lobby.currentLogEvents = [];
  lobby.currentEliminated = [];
  lobby.currentSaved = [];
}

function createPlayer(id: string, name: string, socketId: string, isGod: boolean): Player {
  return {
    id, name, socketId, role: null, team: null,
    isAlive: true, isSelfMuted: false, isGodMuted: false,
    isReady: isGod, isGod, canVote: true, testament: "",
  };
}

function createDefaultVoteSession(): VoteSession {
  return { active: false, endTime: 0, duration: 0, votes: {}, timer: null, type: "eliminate" };
}

// ★ منطق شب: پردازش اکشن‌ها وقتی فاز به روز عوض میشه
function resolveNightActions(lobby: Lobby, ioServer: Server, code: string) {
  const actions = lobby.nightActions;
  if (actions.length === 0) return;

  const shootActions = actions.filter((a) =>
    a.action === "shoot" || a.action === "snipe" || a.action === "kill" || a.action === "execute"
  );
  const healAction = actions.find((a) => a.action === "heal");
  const investigateAction = actions.find((a) => a.action === "investigate");
  const guardAction = actions.find((a) => a.action === "guard");
  const blockAction = actions.find((a) => a.action === "block");
  const poisonAction = actions.find((a) => a.action === "poison");
  const trackAction = actions.find((a) => a.action === "track");

  // چشم‌بند: اکشن بازیکن blocked رو لغو کن (تیر مافیا لغو نمیشه)
  if (blockAction) {
    const blockedId = blockAction.targetId;
    lobby.nightActions = actions.filter(
      (a) => a.playerId !== blockedId || a.action === "shoot"
    );
    const blockedName = lobby.players.find((p) => p.id === blockedId)?.name || "";
    addLogEvent(lobby, `${blockAction.playerName} اکشن ${blockedName} رو خنثی کرد`);

    const god = lobby.players.find((p) => p.id === lobby.godId);
    if (god) {
      const gs = ioServer.sockets.sockets.get(god.socketId);
      if (gs) {
        gs.emit("god_notification", {
          text: `🙈 ${blockAction.playerName} اکشن ${blockedName} رو خنثی کرد`,
          type: "action", action: "block",
          playerName: blockAction.playerName,
          role: blockAction.role,
          targetName: blockedName,
        });
      }
    }
  }

  // هدف‌های تیر
  const killTargets = new Set<string>();
  shootActions.forEach((a) => killTargets.add(a.targetId));

  const healedId = healAction?.targetId;
  const guardedId = guardAction?.targetId;

  // پردازش کشتن
  killTargets.forEach((targetId) => {
    const target = lobby.players.find((p) => p.id === targetId);
    if (!target || !target.isAlive) return;

    const god = lobby.players.find((p) => p.id === lobby.godId);

    // نجات توسط دکتر
    if (targetId === healedId) {
      addLogEvent(lobby, `${target.name} توسط دکتر نجات یافت`);
      lobby.currentSaved.push(target.name);
      if (god) {
        const gs = ioServer.sockets.sockets.get(god.socketId);
        if (gs) {
          gs.emit("god_notification", {
            text: `💊 ${target.name} توسط دکتر نجات یافت`,
            type: "action", action: "heal_save",
            playerName: "دکتر", role: "دکتر",
            targetName: target.name,
          });
        }
      }
      return;
    }

    // محافظت نگهبان: نگهبان جای هدف میمیره
    if (targetId === guardedId && guardAction) {
      const guard = lobby.players.find((p) => p.id === guardAction.playerId);
      if (guard && guard.isAlive) {
        guard.isAlive = false;
        guard.isGodMuted = true;
        addLogEvent(lobby, `${guard.name} (نگهبان) جای ${target.name} کشته شد`);
        lobby.currentEliminated.push(guard.name);
        if (god) {
          const gs = ioServer.sockets.sockets.get(god.socketId);
          if (gs) {
            gs.emit("god_notification", {
              text: `💂 ${guard.name} جای ${target.name} کشته شد`,
              type: "action", action: "guard_die",
              playerName: guard.name, role: "نگهبان",
              targetName: target.name,
            });
          }
        }
        return;
      }
    }

    // کشته شد
    target.isAlive = false;
    target.isGodMuted = true;
    addLogEvent(lobby, `${target.name} در شب کشته شد`);
    lobby.currentEliminated.push(target.name);
  });

  // ساقی
  if (poisonAction) {
    const poisonedName = lobby.players.find((p) => p.id === poisonAction.targetId)?.name || "";
    addLogEvent(lobby, `${poisonAction.playerName} ${poisonedName} را مسموم کرد`);
  }

  // کارآگاه: نتیجه استعلام فقط به خودش
  if (investigateAction) {
    const target = lobby.players.find((p) => p.id === investigateAction.targetId);
    const investigator = lobby.players.find((p) => p.id === investigateAction.playerId);
    if (target && investigator) {
      let result = target.team === "mafia" ? "مافیا" : "شهروند";
      // پدرخوانده و جاسوس استعلام شهروند میخورن
      if (target.role === "پدرخوانده" || target.role === "جاسوس") result = "شهروند";
      // مأمور مخفی استعلام مافیا میخوره
      if (target.role === "مأمور مخفی") result = "مافیا";

      const invSocket = ioServer.sockets.sockets.get(investigator.socketId);
      if (invSocket) {
        invSocket.emit("investigate_result", { targetName: target.name, result });
      }
      addLogEvent(lobby, `${investigator.name} از ${target.name} استعلام گرفت → ${result}`);

      const god = lobby.players.find((p) => p.id === lobby.godId);
      if (god) {
        const gs = ioServer.sockets.sockets.get(god.socketId);
        if (gs) {
          gs.emit("god_notification", {
            text: `🔍 ${investigator.name} استعلام ${target.name} → ${result}`,
            type: "action", action: "investigate_result",
            playerName: investigator.name, role: "کارآگاه",
            targetName: target.name,
          });
        }
      }
    }
  }

  // ردیاب: نتیجه فقط به خودش
  if (trackAction) {
    const tracker = lobby.players.find((p) => p.id === trackAction.playerId);
    const tracked = lobby.players.find((p) => p.id === trackAction.targetId);
    if (tracker && tracked) {
      const trackedAction = actions.find(
        (a) => a.playerId === tracked.id && a.action !== "track"
      );
      const visitedName = trackedAction
        ? lobby.players.find((p) => p.id === trackedAction.targetId)?.name || "نامشخص"
        : "هیچ‌کس";
      const tSocket = ioServer.sockets.sockets.get(tracker.socketId);
      if (tSocket) {
        tSocket.emit("track_result", { targetName: tracked.name, visitedName });
      }
      addLogEvent(lobby, `${tracker.name} ردیابی کرد: ${tracked.name} → ${visitedName}`);
    }
  }
}

// ★ پایان رأی‌گیری
function finishVote(lobby: Lobby, code: string, ioServer: Server) {
  lobby.voteSession.active = false;

  const counts: Record<string, number> = {};
  Object.values(lobby.voteSession.votes).forEach((t) => {
    counts[t] = (counts[t] || 0) + 1;
  });

  const alive = lobby.players.filter((p) => p.isAlive && !p.isGod).length;
  const threshold = getVoteThreshold(alive);

  if (lobby.voteSession.type === "inquiry") {
    // ★ استعلام: بله/خیر
    const yesCount = counts["yes"] || 0;
    const noCount = counts["no"] || 0;
    const passed = yesCount >= threshold;
    let roleList = "";

    if (passed) {
      // نمایش نقش‌های باقیمانده (بدون اسم بازیکن)
      const remainingRoles: Record<string, number> = {};
      lobby.players.filter((p) => p.isAlive && !p.isGod).forEach((p) => {
        if (p.role) remainingRoles[p.role] = (remainingRoles[p.role] || 0) + 1;
      });
      roleList = Object.entries(remainingRoles)
        .map(([role, count]) => `${role}: ${count}`)
        .join(" | ");

      ioServer.to(code).emit("system_message", {
        text: `🔍 نقش‌های باقی‌مانده: ${roleList}`,
        type: "reveal",
      });
      addLogEvent(lobby, `نظرسنجی استعلام تصویب شد: ${roleList}`);
    } else {
      ioServer.to(code).emit("system_message", {
        text: `🔍 نظرسنجی استعلام رد شد (بله: ${yesCount} / خیر: ${noCount})`,
        type: "vote",
      });
      addLogEvent(lobby, `نظرسنجی استعلام رد شد (بله: ${yesCount} / خیر: ${noCount})`);
    }

    ioServer.to(code).emit("vote_result", {
      eliminated: null,
      votes: counts,
      threshold,
      passed,
      type: "inquiry",
      roleList,
    });
  } else {
    // ★ اخراج: بازیکن با بیشترین رأی
    let eliminatedId: string | null = null;
    let maxVotes = 0;

    for (const [tid, count] of Object.entries(counts)) {
      if (count > maxVotes) {
        maxVotes = count;
        eliminatedId = tid;
      }
    }

    if (eliminatedId && maxVotes >= threshold) {
      const target = lobby.players.find((p) => p.id === eliminatedId);
      if (target) {
        target.isAlive = false;
        target.isGodMuted = true;
        lobby.currentEliminated.push(target.name);

        ioServer.to(code).emit("vote_result", {
          eliminated: target.id,
          eliminatedName: target.name,
          votes: counts,
          threshold,
          passed: true,
          type: "eliminate",
        });
        ioServer.to(code).emit("player_eliminated", {
          playerId: target.id,
          playerName: target.name,
          lobby: getLobbyPublicData(lobby),
        });
        ioServer.to(code).emit("system_message", {
          text: `🗳️ ${target.name} با ${maxVotes} رأی از بازی حذف شد`,
          type: "eliminate",
        });

        // وصیت‌نامه
        if (target.testament) {
          ioServer.to(code).emit("system_message", {
            text: `📜 وصیت ${target.name}: ${target.testament}`,
            type: "reveal",
          });
        }
        addLogEvent(lobby, `${target.name} با ${maxVotes} رأی حذف شد`);
      }
    } else {
      ioServer.to(code).emit("vote_result", {
        eliminated: null,
        votes: counts,
        threshold,
        passed: false,
        type: "eliminate",
      });
      ioServer.to(code).emit("system_message", {
        text: "🗳️ رأی‌گیری به نتیجه نرسید",
        type: "vote",
      });
      addLogEvent(lobby, "رأی‌گیری به نتیجه نرسید");
    }
  }

  lobby.voteSession = createDefaultVoteSession();
  ioServer.to(code).emit("lobby_updated", getLobbyPublicData(lobby));
}

// ─── Server ───────────────────────────────────────────────────────────────────

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

io.on("connection", (socket) => {
  console.log(`[+] connected: ${socket.id}`);

  // ── CREATE LOBBY ──────────────────────────────────────────────────────────
  socket.on("create_lobby", ({ playerName }: { playerName: string }) => {
    const code = generateLobbyCode();
    const playerId = uuidv4();
    const god = createPlayer(playerId, playerName, socket.id, true);

    const lobby: Lobby = {
      code,
      godId: playerId,
      players: [god],
      roles: [
        { name: "مافیا ساده", team: "mafia", count: 1 },
        { name: "شهروند ساده", team: "citizen", count: 2 },
      ],
      maxPlayers: 8,
      status: "waiting",
      phase: "day",
      round: 1,
      skipVote: [],
      phaseStartTime: Date.now(),
      awakeGroup: null,
      nightActions: [],
      gameLog: [],
      currentLogEvents: [],
      currentEliminated: [],
      currentSaved: [],
      voteSession: createDefaultVoteSession(),
    };

    lobbies.set(code, lobby);
    socket.join(code);
    socket.emit("lobby_created", {
      code,
      playerId,
      lobby: getLobbyPublicData(lobby),
    });
    console.log(`[LOBBY] created: ${code} by ${playerName}`);
  });

  // ── JOIN LOBBY ────────────────────────────────────────────────────────────
  socket.on("join_lobby", ({ code, playerName }: { code: string; playerName: string }) => {
    const lobby = lobbies.get(code.toUpperCase());
    if (!lobby) {
      socket.emit("error", { message: "لابی پیدا نشد!" });
      return;
    }
    if (lobby.status !== "waiting") {
      socket.emit("error", { message: "بازی شروع شده!" });
      return;
    }
    // گاد حساب نمیشه در تعداد
    if (lobby.players.filter((p) => !p.isGod).length >= lobby.maxPlayers) {
      socket.emit("error", { message: "لابی پر است!" });
      return;
    }

    const playerId = uuidv4();
    lobby.players.push(createPlayer(playerId, playerName, socket.id, false));
    socket.join(code);

    socket.emit("lobby_joined", {
      code,
      playerId,
      lobby: getLobbyPublicData(lobby),
    });
    io.to(code).emit("lobby_updated", getLobbyPublicData(lobby));
    io.to(code).emit("system_message", {
      text: `${playerName} وارد لابی شد`,
      type: "join",
    });
    console.log(`[LOBBY] ${playerName} joined: ${code}`);
  });

  // ── UPDATE SETTINGS (GOD) ────────────────────────────────────────────────
  socket.on("update_settings", ({ code, playerId, roles, maxPlayers }: any) => {
    const lobby = lobbies.get(code);
    if (!lobby || lobby.godId !== playerId) return;
    lobby.roles = roles;
    lobby.maxPlayers = maxPlayers;
    io.to(code).emit("lobby_updated", getLobbyPublicData(lobby));
  });

  // ── PLAYER READY ──────────────────────────────────────────────────────────
  socket.on("player_ready", ({ code, playerId }: any) => {
    const lobby = lobbies.get(code);
    if (!lobby) return;
    const p = lobby.players.find((x) => x.id === playerId);
    if (p) {
      p.isReady = !p.isReady;
      io.to(code).emit("lobby_updated", getLobbyPublicData(lobby));
    }
  });

  // ── START GAME (GOD) ─────────────────────────────────────────────────────
  socket.on("start_game", ({ code, playerId }: any) => {
    const lobby = lobbies.get(code);
    if (!lobby || lobby.godId !== playerId) return;
    const nonGod = lobby.players.filter((p) => !p.isGod);
    if (nonGod.length < 2) {
      socket.emit("error", { message: "حداقل ۲ بازیکن نیاز است!" });
      return;
    }

    const assigned = assignRoles(nonGod, lobby.roles);
    const god = lobby.players.find((p) => p.isGod)!;
    lobby.players = [god, ...assigned];
    lobby.status = "starting";
    lobby.phaseStartTime = Date.now();

    // نقش هر بازیکن فقط به خودش
    lobby.players.forEach((p) => {
      if (!p.isGod && p.role) {
        const s = io.sockets.sockets.get(p.socketId);
        if (s) s.emit("your_role", { role: p.role, team: p.team });
      }
    });

    // لیست کامل نقش‌ها فقط به گاد
    const gs = io.sockets.sockets.get(god.socketId);
    if (gs) {
      gs.emit("all_roles", {
        players: lobby.players
          .filter((p) => !p.isGod)
          .map((p) => ({ id: p.id, name: p.name, role: p.role, team: p.team })),
      });
    }

    io.to(code).emit("game_starting", {
      lobby: getLobbyPublicData(lobby),
      countdown: 30,
    });

    setTimeout(() => {
      lobby.status = "playing";
      lobby.phase = "day";
      lobby.round = 1;
      lobby.phaseStartTime = Date.now();
      io.to(code).emit("game_started", getLobbyPublicData(lobby));
    }, 30000);

    addLogEvent(lobby, `بازی شروع شد با ${nonGod.length} بازیکن`);
    console.log(`[GAME] started: ${code}`);
  });

  // ── TOGGLE PHASE (GOD) ────────────────────────────────────────────────────
  socket.on("toggle_phase", ({ code, playerId }: any) => {
    const lobby = lobbies.get(code);
    if (!lobby || lobby.godId !== playerId) return;

    // ★ شب → روز: پردازش اکشن‌های شبانه
    if (lobby.phase === "night") {
      resolveNightActions(lobby, io, code);

      const eliminated = lobby.currentEliminated;
      if (eliminated.length > 0) {
        io.to(code).emit("system_message", {
          text: `☀️ صبح شد. ${eliminated.join("، ")} دیشب از دنیا رفتند`,
          type: "eliminate",
        });
        // وصیت‌نامه حذف‌شده‌ها
        eliminated.forEach((name) => {
          const player = lobby.players.find((p) => p.name === name);
          if (player && player.testament) {
            io.to(code).emit("system_message", {
              text: `📜 وصیت ${player.name}: ${player.testament}`,
              type: "reveal",
            });
          }
        });
        io.to(code).emit("lobby_updated", getLobbyPublicData(lobby));
      } else {
        io.to(code).emit("system_message", {
          text: "☀️ صبح شد. دیشب کسی نمرد!",
          type: "phase",
        });
      }
    }

    savePhaseLog(lobby);

    lobby.phase = lobby.phase === "day" ? "night" : "day";
    if (lobby.phase === "day") lobby.round += 1;
    lobby.phaseStartTime = Date.now();
    lobby.awakeGroup = null;
    lobby.nightActions = [];

    // ریست رأی‌گیری
    if (lobby.voteSession.timer) clearTimeout(lobby.voteSession.timer);
    lobby.voteSession = createDefaultVoteSession();

    io.to(code).emit("phase_changed", {
      phase: lobby.phase,
      round: lobby.round,
      phaseStartTime: lobby.phaseStartTime,
    });

    const phaseText = lobby.phase === "day"
      ? `☀️ روز ${lobby.round} شروع شد`
      : `🌙 شب ${lobby.round} شروع شد`;
    io.to(code).emit("system_message", { text: phaseText, type: "phase" });

    // آپدیت دسترسی چت
    lobby.players.forEach((p) => {
      const s = io.sockets.sockets.get(p.socketId);
      if (s) {
        s.emit("chat_permission_changed", {
          phase: lobby.phase,
          awakeGroup: null,
          canChat: canPlayerChat(lobby, p),
        });
      }
    });

    addLogEvent(lobby, phaseText);
  });

  // ── SET AWAKE GROUP (GOD) ─────────────────────────────────────────────────
  socket.on("set_awake_group", ({ code, playerId, group }: any) => {
    const lobby = lobbies.get(code);
    if (!lobby || lobby.godId !== playerId) return;

    lobby.awakeGroup = group;
    io.to(code).emit("awake_group_changed", { group });

    // آپدیت دسترسی چت هر بازیکن
    lobby.players.forEach((p) => {
      const s = io.sockets.sockets.get(p.socketId);
      if (s) {
        s.emit("chat_permission_changed", {
          phase: lobby.phase,
          awakeGroup: group,
          canChat: canPlayerChat(lobby, p),
        });
      }
    });

    if (group) {
      io.to(code).emit("system_message", {
        text: `${group} بیدار شد`,
        type: "phase",
      });
      addLogEvent(lobby, `${group} بیدار شد`);
    } else {
      io.to(code).emit("system_message", {
        text: "همه خوابیدند",
        type: "phase",
      });
    }
  });

  // ── ROLE ACTION (PLAYER) ──────────────────────────────────────────────────
  socket.on("role_action", ({ code, playerId, targetId, action }: any) => {
    const lobby = lobbies.get(code);
    if (!lobby || lobby.phase !== "night") return;

    const player = lobby.players.find((p) => p.id === playerId);
    const target = lobby.players.find((p) => p.id === targetId);
    if (!player || !target || !player.isAlive) return;

    // جایگزین اکشن قبلی
    lobby.nightActions = lobby.nightActions.filter((a) => a.playerId !== player.id);
    lobby.nightActions.push({
      playerId: player.id,
      playerName: player.name,
      role: player.role || "",
      targetId: target.id,
      targetName: target.name,
      action,
      timestamp: Date.now(),
    });

    socket.emit("action_confirmed", { action, targetName: target.name });

    const actionLabels: Record<string, string> = {
      shoot: "🔫 تیر زد به",
      heal: "💊 شفا داد به",
      investigate: "🔍 استعلام گرفت از",
      snipe: "🎯 اسنایپ کرد",
      guard: "💂 محافظت کرد از",
      block: "🙈 کور کرد",
      track: "📡 ردیابی کرد",
      kill: "🔪 کشت",
      poison: "🍷 مسموم کرد",
      mark: "🔥 علامت زد",
      execute: "⚔️ اعدام کرد",
      trap: "🪤 تله گذاشت",
      revive: "✝️ احیا کرد",
      choose_love: "💕 عاشق شد",
      gamble: "🎰 حدس زد",
      swap: "🎭 تعویض کرد با",
      spy: "🕵️ شنود کرد",
      copy: "🪞 تقلید کرد",
      control: "🎪 کنترل کرد",
      fortune: "🔮 پیشگویی کرد",
      hostage: "🪢 گروگان گرفت",
      deceive: "🃏 فریب داد",
      compare: "📰 مقایسه کرد",
    };
    const label = actionLabels[action] || action;

    // فقط به گاد اطلاع بده
    const god = lobby.players.find((p) => p.id === lobby.godId);
    if (god) {
      const gs = io.sockets.sockets.get(god.socketId);
      if (gs) {
        gs.emit("god_notification", {
          text: `${player.name} (${player.role}) ${label} ${target.name}`,
          type: "action",
          action,
          playerName: player.name,
          role: player.role,
          targetName: target.name,
        });
      }
    }

    addLogEvent(lobby, `${player.name} (${player.role}) ${label} ${target.name}`);
  });

  // ── START VOTE (GOD) ──────────────────────────────────────────────────────
  socket.on("start_vote", ({ code, playerId, duration, type }: {
    code: string;
    playerId: string;
    duration: number;
    type?: string;
  }) => {
    const lobby = lobbies.get(code);
    if (!lobby || lobby.godId !== playerId || lobby.phase !== "day") return;

    const voteType = type === "inquiry" ? "inquiry" : "eliminate";
    const endTime = Date.now() + duration * 1000;

    lobby.voteSession = {
      active: true,
      endTime,
      duration,
      votes: {},
      timer: null,
      type: voteType as "eliminate" | "inquiry",
    };

    lobby.voteSession.timer = setTimeout(() => {
      finishVote(lobby, code, io);
    }, duration * 1000);

    io.to(code).emit("vote_started", { endTime, duration, type: voteType });

    const voteText = voteType === "inquiry"
      ? `🔍 نظرسنجی استعلام شروع شد (${duration} ثانیه)`
      : `🗳️ رأی‌گیری شروع شد (${duration} ثانیه)`;
    io.to(code).emit("system_message", { text: voteText, type: "vote" });
    addLogEvent(lobby, voteText);
  });

  // ── CAST VOTE (PLAYER) ────────────────────────────────────────────────────
  socket.on("cast_vote", ({ code, playerId, targetId }: any) => {
    const lobby = lobbies.get(code);
    if (!lobby || !lobby.voteSession.active) return;

    const player = lobby.players.find((p) => p.id === playerId);
    if (!player || !player.isAlive || !player.canVote || player.isGod) return;

    lobby.voteSession.votes[playerId] = targetId;
    io.to(code).emit("vote_updated", { votes: lobby.voteSession.votes });

    // حد نصاب فوری فقط برای eliminate
    if (lobby.voteSession.type === "eliminate") {
      const alive = lobby.players.filter((p) => p.isAlive && !p.isGod).length;
      const threshold = getVoteThreshold(alive);
      const counts: Record<string, number> = {};
      Object.values(lobby.voteSession.votes).forEach((t) => {
        counts[t] = (counts[t] || 0) + 1;
      });

      for (const [, count] of Object.entries(counts)) {
        if (count >= threshold) {
          if (lobby.voteSession.timer) clearTimeout(lobby.voteSession.timer);
          finishVote(lobby, code, io);
          return;
        }
      }
    }
  });

  // ── EMOJI ─────────────────────────────────────────────────────────────────
  socket.on("send_emoji", ({ code, playerId, targetId, emoji }: {
    code: string;
    playerId: string;
    targetId: string;
    emoji: string;
  }) => {
    const lobby = lobbies.get(code);
    if (!lobby) return;
    const from = lobby.players.find((p) => p.id === playerId);
    if (!from) return;
    io.to(code).emit("emoji_received", {
      fromName: from.name,
      targetId,
      emoji,
    });
  });

  // ── TESTAMENT ─────────────────────────────────────────────────────────────
  socket.on("save_testament", ({ code, playerId, text }: any) => {
    const lobby = lobbies.get(code);
    if (!lobby) return;
    const p = lobby.players.find((x) => x.id === playerId);
    if (p) {
      p.testament = text;
      socket.emit("testament_saved");
    }
  });

  // ── GET GAME LOG (GOD) ────────────────────────────────────────────────────
  socket.on("get_game_log", ({ code, playerId }: any) => {
    const lobby = lobbies.get(code);
    if (!lobby || lobby.godId !== playerId) return;
    socket.emit("game_log", {
      log: lobby.gameLog,
      currentEvents: lobby.currentLogEvents,
    });
  });

  // ── ELIMINATE PLAYER (GOD) ────────────────────────────────────────────────
  socket.on("eliminate_player", ({ code, playerId, targetId }: any) => {
    const lobby = lobbies.get(code);
    if (!lobby || lobby.godId !== playerId) return;
    const target = lobby.players.find((p) => p.id === targetId);
    if (target) {
      target.isAlive = false;
      target.isGodMuted = true;
      lobby.currentEliminated.push(target.name);

      io.to(code).emit("player_eliminated", {
        playerId: targetId,
        playerName: target.name,
        lobby: getLobbyPublicData(lobby),
      });
      io.to(code).emit("system_message", {
        text: `${target.name} از بازی حذف شد`,
        type: "eliminate",
      });

      if (target.testament) {
        io.to(code).emit("system_message", {
          text: `📜 وصیت ${target.name}: ${target.testament}`,
          type: "reveal",
        });
      }
      addLogEvent(lobby, `${target.name} حذف شد (توسط گاد)`);
    }
  });

  // ── REVIVE PLAYER (GOD) ───────────────────────────────────────────────────
  socket.on("revive_player", ({ code, playerId, targetId }: any) => {
    const lobby = lobbies.get(code);
    if (!lobby || lobby.godId !== playerId) return;
    const target = lobby.players.find((p) => p.id === targetId);
    if (target) {
      target.isAlive = true;
      target.isGodMuted = false;
      lobby.currentSaved.push(target.name);
      io.to(code).emit("lobby_updated", getLobbyPublicData(lobby));
      io.to(code).emit("system_message", {
        text: `${target.name} به بازی برگشت`,
        type: "revive",
      });
      addLogEvent(lobby, `${target.name} احیا شد`);
    }
  });

  // ── TOGGLE MUTE (GOD) ────────────────────────────────────────────────────
  socket.on("toggle_mute", ({ code, playerId, targetId }: any) => {
    const lobby = lobbies.get(code);
    if (!lobby || lobby.godId !== playerId) return;
    const target = lobby.players.find((p) => p.id === targetId);
    if (target) {
      target.isGodMuted = !target.isGodMuted;
      const s = io.sockets.sockets.get(target.socketId);
      if (s) {
        s.emit("mute_changed", {
          isMuted: target.isGodMuted || target.isSelfMuted,
          isGodMuted: target.isGodMuted,
          isSelfMuted: target.isSelfMuted,
        });
      }
      io.to(code).emit("lobby_updated", getLobbyPublicData(lobby));
    }
  });

  // ── MUTE ALL (GOD) ───────────────────────────────────────────────────────
  socket.on("mute_all", ({ code, playerId, mute }: any) => {
    const lobby = lobbies.get(code);
    if (!lobby || lobby.godId !== playerId) return;
    lobby.players.forEach((p) => {
      if (!p.isGod) {
        p.isGodMuted = mute;
        const s = io.sockets.sockets.get(p.socketId);
        if (s) {
          s.emit("mute_changed", {
            isMuted: p.isGodMuted || p.isSelfMuted,
            isGodMuted: p.isGodMuted,
            isSelfMuted: p.isSelfMuted,
          });
        }
      }
    });
    io.to(code).emit("lobby_updated", getLobbyPublicData(lobby));
  });

  // ── SELF MUTE (PLAYER) ───────────────────────────────────────────────────
  socket.on("self_mute", ({ code, playerId }: any) => {
    const lobby = lobbies.get(code);
    if (!lobby) return;
    const p = lobby.players.find((x) => x.id === playerId);
    if (p && !p.isGod) {
      p.isSelfMuted = !p.isSelfMuted;
      socket.emit("mute_changed", {
        isMuted: p.isGodMuted || p.isSelfMuted,
        isGodMuted: p.isGodMuted,
        isSelfMuted: p.isSelfMuted,
      });
      io.to(code).emit("lobby_updated", getLobbyPublicData(lobby));
    }
  });

  // ── SKIP VOTE (GOD) ──────────────────────────────────────────────────────
  socket.on("skip_vote", ({ code, playerId, targetId }: any) => {
    const lobby = lobbies.get(code);
    if (!lobby || lobby.godId !== playerId) return;
    const t = lobby.players.find((p) => p.id === targetId);
    if (t) {
      t.canVote = !t.canVote;
      io.to(code).emit("lobby_updated", getLobbyPublicData(lobby));
    }
  });

  // ── REVEAL ROLE (GOD) ────────────────────────────────────────────────────
  socket.on("reveal_role", ({ code, playerId, targetId }: any) => {
    const lobby = lobbies.get(code);
    if (!lobby || lobby.godId !== playerId) return;
    const t = lobby.players.find((p) => p.id === targetId);
    if (t) {
      io.to(code).emit("role_revealed", { playerName: t.name, role: t.role });
      io.to(code).emit("system_message", {
        text: `نقش ${t.name} فاش شد: ${t.role}`,
        type: "reveal",
      });
    }
  });

  // ── PLAY SOUND (GOD) ─────────────────────────────────────────────────────
  socket.on("play_sound", ({ code, playerId, sound }: any) => {
    const lobby = lobbies.get(code);
    if (!lobby || lobby.godId !== playerId) return;
    io.to(code).emit("play_sound", { sound });
  });

  // ── END GAME (GOD) ───────────────────────────────────────────────────────
  socket.on("end_game", ({ code, playerId, winner }: any) => {
    const lobby = lobbies.get(code);
    if (!lobby || lobby.godId !== playerId) return;
    savePhaseLog(lobby);
    lobby.status = "ended";
    io.to(code).emit("game_ended", {
      winner,
      players: lobby.players.map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        isAlive: p.isAlive,
        isGod: p.isGod,
      })),
    });
  });

  // ── CHAT MESSAGE ──────────────────────────────────────────────────────────
  socket.on("chat_message", ({ code, playerId, message }: any) => {
    const lobby = lobbies.get(code);
    if (!lobby) return;
    const player = lobby.players.find((p) => p.id === playerId);
    if (!player || !canPlayerChat(lobby, player)) return;

    if (lobby.phase === "night" && !player.isGod) {
      // شب: فقط هم‌گروهی + گاد
      lobby.players.forEach((p) => {
        const shouldReceive =
          p.id === lobby.godId ||
          p.id === player.id ||
          (lobby.awakeGroup === "mafia" && p.team === "mafia") ||
          (lobby.awakeGroup !== "mafia" && p.role === lobby.awakeGroup);

        if (shouldReceive) {
          const s = io.sockets.sockets.get(p.socketId);
          if (s) {
            s.emit("chat_message", {
              playerName: player.name,
              message,
              isGod: false,
              isNightChat: true,
              timestamp: Date.now(),
            });
          }
        }
      });
    } else {
      // روز: همه
      io.to(code).emit("chat_message", {
        playerName: player.name,
        message,
        isGod: player.isGod,
        isNightChat: false,
        timestamp: Date.now(),
      });
    }
  });

  // ── GET LOBBY ─────────────────────────────────────────────────────────────
  socket.on("get_lobby", ({ code, playerId }: any) => {
    const lobby = lobbies.get(code);
    if (!lobby) {
      socket.emit("error", { message: "لابی پیدا نشد!" });
      return;
    }

    // کنسل تایمر disconnect (reconnect)
    if (playerId && disconnectTimers.has(playerId)) {
      clearTimeout(disconnectTimers.get(playerId)!);
      disconnectTimers.delete(playerId);
      console.log(`[RECONNECT] ${playerId}`);
    }

    socket.join(code);

    const p = lobby.players.find((x) => x.id === playerId);
    if (p) {
      p.socketId = socket.id;
      console.log(`[GET_LOBBY] ${p.name}, isGod: ${p.id === lobby.godId}`);
    }

    socket.emit("lobby_data", getLobbyPublicData(lobby));

    // نقش فقط به خود بازیکن
    if (p && !p.isGod && p.role) {
      socket.emit("your_role", { role: p.role, team: p.team });
    }

    // لیست نقش‌ها فقط به گاد
    if (p && p.id === lobby.godId) {
      socket.emit("all_roles", {
        players: lobby.players
          .filter((x) => !x.isGod)
          .map((x) => ({ id: x.id, name: x.name, role: x.role, team: x.team })),
      });
    }

    // دسترسی چت
    if (p) {
      socket.emit("chat_permission_changed", {
        phase: lobby.phase,
        awakeGroup: lobby.awakeGroup,
        canChat: canPlayerChat(lobby, p),
      });
    }
  });

  // ── VOICE SIGNALING ───────────────────────────────────────────────────────
  socket.on("voice_ready", ({ code }: any) => {
    socket.to(code).emit("voice_user_joined", { userId: socket.id });
  });

  socket.on("voice_offer", ({ code, targetId, offer }: any) => {
    const lobby = lobbies.get(code);
    if (!lobby) return;
    const t = lobby.players.find((p) => p.id === targetId);
    if (t) {
      const s = io.sockets.sockets.get(t.socketId);
      if (s) s.emit("voice_offer", { fromId: socket.id, offer });
    }
  });

  socket.on("voice_answer", ({ code, targetId, answer }: any) => {
    const lobby = lobbies.get(code);
    if (!lobby) return;
    const t = lobby.players.find((p) => p.id === targetId);
    if (t) {
      const s = io.sockets.sockets.get(t.socketId);
      if (s) s.emit("voice_answer", { fromId: socket.id, answer });
    }
  });

  socket.on("voice_ice", ({ code, targetId, candidate }: any) => {
    const lobby = lobbies.get(code);
    if (!lobby) return;
    const t = lobby.players.find((p) => p.id === targetId);
    if (t) {
      const s = io.sockets.sockets.get(t.socketId);
      if (s) s.emit("voice_ice", { fromId: socket.id, candidate });
    }
  });

  // ── DISCONNECT ────────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    console.log(`[-] disconnected: ${socket.id}`);

    lobbies.forEach((lobby, code) => {
      const p = lobby.players.find((x) => x.socketId === socket.id);
      if (!p) return;

      if (lobby.status === "playing" || lobby.status === "starting") {
        // بازی در جریان: ۱۵ ثانیه صبر برای reconnect
        const timer = setTimeout(() => {
          io.to(code).emit("system_message", {
            text: `${p.name} قطع شد`,
            type: "leave",
          });
          disconnectTimers.delete(p.id);
        }, 15000);
        disconnectTimers.set(p.id, timer);
      } else {
        // لابی: حذف فوری
        const idx = lobby.players.findIndex((x) => x.id === p.id);
        if (idx !== -1) {
          lobby.players.splice(idx, 1);
          io.to(code).emit("lobby_updated", getLobbyPublicData(lobby));
          io.to(code).emit("system_message", {
            text: `${p.name} خارج شد`,
            type: "leave",
          });
          if (lobby.players.length === 0) {
            lobbies.delete(code);
            console.log(`[LOBBY] deleted: ${code}`);
          }
        }
      }
    });
  });
});

const PORT = 3001;
httpServer.listen(PORT, () => {
  console.log(`🚀 Socket.IO server running on port ${PORT}`);
});
