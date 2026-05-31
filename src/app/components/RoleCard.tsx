"use client";

import { useEffect, useState } from "react";
import { DEFAULT_ROLES } from "@/app/lib/roles";

interface RoleCardProps {
  role: string;
  onClose: () => void;
}

export default function RoleCard({ role, onClose }: RoleCardProps) {
  const [visible, setVisible] = useState(false);
  const roleInfo = DEFAULT_ROLES.find((r) => r.name === role);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm cursor-pointer"
      onClick={onClose}
    >
      <div
        className={`transition-all duration-500 ${
          visible ? "scale-100 opacity-100" : "scale-75 opacity-0"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="relative w-64 h-96 rounded-3xl overflow-hidden shadow-2xl border-2"
          style={{
            borderColor: roleInfo?.color || "#6b7280",
            boxShadow: `0 0 40px ${roleInfo?.color || "#6b7280"}40`,
          }}
        >
          {/* Background */}
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(circle at center, ${
                roleInfo?.color || "#6b7280"
              }20 0%, #0d0d0d 70%)`,
            }}
          />

          {/* Content */}
          <div className="relative z-10 flex flex-col items-center justify-center h-full p-6 text-center">
            {/* Icon */}
            <div
              className="text-7xl mb-6"
              style={{ animation: "bounce 2s infinite" }}
            >
              {roleInfo?.icon || "👤"}
            </div>

            {/* Role Name */}
            <h2
              className="text-3xl font-black mb-2"
              style={{ color: roleInfo?.color || "#ffffff" }}
            >
              {role}
            </h2>

            {/* Team */}
            <div
              className="text-sm px-3 py-1 rounded-full mb-4 font-medium"
              style={{
                backgroundColor: `${roleInfo?.color || "#6b7280"}20`,
                color: roleInfo?.color || "#6b7280",
                border: `1px solid ${roleInfo?.color || "#6b7280"}40`,
              }}
            >
              {roleInfo?.team === "mafia"
                ? "تیم مافیا"
                : roleInfo?.team === "citizen"
                ? "تیم شهروند"
                : "مستقل"}
            </div>

            {/* Description */}
            <p className="text-white/60 text-sm leading-relaxed">
              {roleInfo?.description || "نقش بازی"}
            </p>

            {/* Glow line */}
            <div
              className="absolute bottom-0 left-0 right-0 h-1"
              style={{
                background: `linear-gradient(to right, transparent, ${
                  roleInfo?.color || "#6b7280"
                }, transparent)`,
              }}
            />
          </div>
        </div>

        <p className="text-white/30 text-sm text-center mt-4 animate-pulse">
          برای بستن کلیک کن
        </p>
      </div>
    </div>
  );
}
