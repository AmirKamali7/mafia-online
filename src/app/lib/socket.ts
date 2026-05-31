import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

function getSocketUrl(): string {
  if (typeof window === "undefined") return "http://localhost:3001";
  // اگر env variable ست شده (production) از اون استفاده کن
  // وگرنه localhost
  return process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";
}

export function getSocket(): Socket {
  if (!socket) {
    const url = getSocketUrl();
    console.log("[SOCKET] connecting to:", url);
    socket = io(url, {
      transports: ["websocket", "polling"],
      autoConnect: true,
    });

    socket.on("connect", () => {
      console.log("[SOCKET] ✅ connected:", socket?.id);
    });

    socket.on("connect_error", (err) => {
      console.error("[SOCKET] ❌ connection error:", err.message);
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function getPlayerId(): string {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem("playerId") || "";
}

export function setPlayerId(id: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem("playerId", id);
}

export function setPlayerName(name: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem("playerName", name);
}

export function setLobbyCode(code: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem("lobbyCode", code);
}
