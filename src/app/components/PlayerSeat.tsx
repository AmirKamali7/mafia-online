"use client";

import { Player } from "@/app/lib/types";
import { Mic, MicOff, Crown, Skull, Shield, Heart, Eye } from "lucide-react";

interface PlayerSeatProps {
  player: Player;
  isMe: boolean;
  isGodView: boolean;
  onAction?: (action: string, playerId: string) => void;
  showActions?: boolean;
  isSpeaking?: boolean; // ← فیچر ۶: نشانگر صحبت کردن
}

export default function PlayerSeat({
  player,
  isMe,
  isGodView,
  onAction,
  showActions = false,
  isSpeaking = false,
}: PlayerSeatProps) {
  if (player.isGod) {
    return (
      <div className="flex flex-col items-center gap-2">
        <div
          className={`relative w-16 h-16 rounded-full bg-yellow-500/20 border-2 border-yellow-500/50 flex items-center justify-center ${
            isSpeaking ? "speaking-ring" : ""
          }`}
        >
          <Crown className="w-7 h-7 text-yellow-400" />
        </div>
        <div className="text-center">
          <p className="text-yellow-400 text-xs font-bold">{player.name}</p>
          <p className="text-yellow-400/50 text-xs">گاد</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 group">
      {/* Avatar */}
      <div
        className={`relative w-16 h-16 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
          !player.isAlive
            ? "opacity-40 grayscale border-gray-600 bg-gray-800"
            : isSpeaking
            ? "speaking-ring border-green-400 bg-green-500/20"
            : isMe
            ? "border-red-500 bg-red-500/20 glow-red"
            : "border-white/20 bg-white/10"
        }`}
      >
        <span
          className={`text-xl font-black ${
            !player.isAlive ? "text-gray-500" : "text-white"
          }`}
        >
          {player.name.charAt(0)}
        </span>

        {/* Dead overlay */}
        {!player.isAlive && (
          <div className="absolute inset-0 rounded-full flex items-center justify-center bg-black/50">
            <Skull className="w-6 h-6 text-gray-500" />
          </div>
        )}

        {/* Mic indicator — فیچر ۱: سبز=روشن، قرمز=خاموش */}
        <div
          className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center border border-gray-800 ${
            player.isMuted ? "bg-red-900" : "bg-green-900"
          }`}
        >
          {player.isMuted ? (
            <MicOff className="w-2.5 h-2.5 text-red-400" />
          ) : (
            <Mic className="w-2.5 h-2.5 text-green-400" />
          )}
        </div>

        {/* No vote indicator */}
        {!player.canVote && player.isAlive && (
          <div className="absolute -top-1 -left-1 w-5 h-5 rounded-full bg-orange-900 border border-gray-800 flex items-center justify-center">
            <Shield className="w-2.5 h-2.5 text-orange-400" />
          </div>
        )}
      </div>

      {/* Name */}
      <div className="text-center">
        <p
          className={`text-xs font-bold truncate max-w-[70px] ${
            !player.isAlive
              ? "text-gray-600 line-through"
              : isMe
              ? "text-red-300"
              : "text-white/80"
          }`}
        >
          {player.name}
        </p>
        {player.isReady && player.isAlive && !isGodView && (
          <p className="text-green-400 text-xs">آماده</p>
        )}
      </div>

      {/* God Actions - hover */}
      {isGodView && showActions && (
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {player.isAlive ? (
            <>
              <button
                onClick={() => onAction?.("eliminate", player.id)}
                className="text-xs bg-red-600/80 hover:bg-red-600 text-white p-1.5 rounded-lg transition-colors"
                title="حذف"
              >
                <Skull className="w-3 h-3" />
              </button>
              <button
                onClick={() => onAction?.("toggle_mute", player.id)}
                className="text-xs bg-gray-600/80 hover:bg-gray-600 text-white p-1.5 rounded-lg transition-colors"
                title="میوت"
              >
                {player.isMuted ? (
                  <Mic className="w-3 h-3" />
                ) : (
                  <MicOff className="w-3 h-3" />
                )}
              </button>
              <button
                onClick={() => onAction?.("skip_vote", player.id)}
                className="text-xs bg-orange-600/80 hover:bg-orange-600 text-white p-1.5 rounded-lg transition-colors"
                title="رای نده"
              >
                <Shield className="w-3 h-3" />
              </button>
              <button
                onClick={() => onAction?.("reveal_role", player.id)}
                className="text-xs bg-purple-600/80 hover:bg-purple-600 text-white p-1.5 rounded-lg transition-colors"
                title="نقش"
              >
                <Eye className="w-3 h-3" />
              </button>
            </>
          ) : (
            <button
              onClick={() => onAction?.("revive", player.id)}
              className="text-xs bg-green-600/80 hover:bg-green-600 text-white p-1.5 rounded-lg transition-colors"
              title="احیا"
            >
              <Heart className="w-3 h-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
