export interface Player {
  id: string;
  name: string;
  socketId?: string;
  isAlive: boolean;
  isMuted: boolean;
  isReady: boolean;
  isGod: boolean;
  canVote: boolean;
  role?: string;
  team?: string;
}

export interface RoleConfig {
  name: string;
  team: "mafia" | "citizen" | "independent";
  count: number;
  description: string;
  color: string;
  icon: string;
}

export interface LobbyData {
  code: string;
  status: "waiting" | "starting" | "playing" | "ended";
  phase: "day" | "night";
  round: number;
  maxPlayers: number;
  roles: RoleConfig[];
  players: Player[];
  phaseStartTime?: number;
  awakeGroup?: string | null;
  votingActive?: boolean;
  votingEndTime?: number;
  votes?: Record<string, string>;
}

export interface ChatMessage {
  playerName: string;
  message: string;
  isGod: boolean;
  isNightChat?: boolean;
  timestamp: number;
}

export interface SystemMessage {
  text: string;
  type:
    | "join"
    | "leave"
    | "phase"
    | "eliminate"
    | "revive"
    | "mute"
    | "vote"
    | "reveal"
    | "action"
    | "emoji";
}

export interface GameEndData {
  winner: string;
  players: {
    id: string;
    name: string;
    role: string | null;
    isAlive: boolean;
    isGod: boolean;
  }[];
}

export interface PlayerRole {
  id: string;
  name: string;
  role: string | null;
  team?: string | null;
}

export interface GodNotification {
  text: string;
  type: string;
  action: string;
  playerName: string;
  role: string | null;
  targetName: string;
}

export interface VoteData {
  active: boolean;
  endTime: number;
  votes: Record<string, string>;
  threshold: number;
}

export interface EmojiReaction {
  fromId: string;
  fromName: string;
  toId: string;
  emoji: "like" | "dislike";
  timestamp: number;
}

export interface Testament {
  playerId: string;
  playerName: string;
  text: string;
  timestamp: number;
}

// ★ این باید با سرور یکسان باشه — startTime و endTime نه duration
export interface GameLogEntry {
  round: number;
  phase: "day" | "night";
  startTime: number;
  endTime: number;
  events: string[];
  eliminated: string[];
  saved: string[];
}
