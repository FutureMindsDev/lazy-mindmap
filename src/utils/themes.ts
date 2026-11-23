import type { ThemeId } from "../types/mindmap";

export interface MindTheme {
  id: ThemeId;
  name: string;
  rootBg: string;
  rootText: string;
  branchColors: string[];
}

export const MIND_THEMES: Record<ThemeId, MindTheme> = {
  ocean: {
    id: "ocean",
    name: "Ocean Breeze",
    rootBg: "#2563eb",
    rootText: "#ffffff",
    branchColors: ["#0891b2", "#7c3aed", "#059669", "#d97706", "#e11d48", "#4f46e5"],
  },
  midnight: {
    id: "midnight",
    name: "Midnight Neon",
    rootBg: "#6366f1",
    rootText: "#ffffff",
    branchColors: ["#38bdf8", "#a855f7", "#34d399", "#fbbf24", "#fb7185", "#2dd4bf"],
  },
  pastel: {
    id: "pastel",
    name: "Soft Pastel",
    rootBg: "#ec4899",
    rootText: "#ffffff",
    branchColors: ["#0ea5e9", "#10b981", "#8b5cf6", "#f59e0b", "#f43f5e", "#14b8a6"],
  },
  solarized: {
    id: "solarized",
    name: "Solarized Pro",
    rootBg: "#b58900",
    rootText: "#ffffff",
    branchColors: ["#268bd2", "#2aa198", "#859900", "#cb4b16", "#d33682", "#6c71c4"],
  },
  emerald: {
    id: "emerald",
    name: "Emerald Studio",
    rootBg: "#059669",
    rootText: "#ffffff",
    branchColors: ["#0284c7", "#65a30d", "#d97706", "#dc2626", "#9333ea", "#0d9488"],
  },
};

export const THEME_ORDER: ThemeId[] = ["ocean", "midnight", "pastel", "solarized", "emerald"];

export const NODE_COLOR_SWATCHES = [
  "#2563eb",
  "#0891b2",
  "#059669",
  "#65a30d",
  "#d97706",
  "#dc2626",
  "#e11d48",
  "#7c3aed",
  "#334155",
  "#dbeafe",
  "#cffafe",
  "#d1fae5",
  "#fef3c7",
  "#ffe4e6",
  "#ede9fe",
];

export const NODE_PALETTE_SWATCHES = NODE_COLOR_SWATCHES.filter((c) => c !== "#ede9fe");

export const FONT_SIZE_PRESETS = [
  { label: "Small", size: 12 },
  { label: "Medium", size: 14 },
  { label: "Large", size: 18 },
  { label: "XL", size: 22 },
];

/**
 * Computes accessible dark or white foreground text color for a given hex background.
 */
export function getContrastTextColor(hex: string): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return "#ffffff";
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.62 ? "#0f172a" : "#ffffff";
}

export const STICKER_PRESETS = [
  "⭐",
  "🔥",
  "💡",
  "🚀",
  "✅",
  "⚠️",
  "📌",
  "🧮",
  "💻",
  "📸",
  "🎯",
  "🧠",
  "1️⃣",
  "2️⃣",
  "3️⃣",
];
