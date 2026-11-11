import type { PluginTheme } from "@getpaseo/plugin";
import type { TabStatus } from "../shared/tabs";

export type Theme = PluginTheme;

/** herdr's `status_indicators = "symbols"` set. */
export const SYMBOL: Record<TabStatus, string> = {
  blocked: "×",
  working: "◐",
  done: "✓",
  idle: "○",
  unknown: "·",
};

export const SHELL_SYMBOL = "›";

/** The check mark draws larger than the other symbols in most fonts. */
export const SYMBOL_SCALE: Record<TabStatus, number> = { blocked: 1, working: 1, done: 0.8, idle: 1, unknown: 1 };

// herdr's state colors in catppuccin (latte for light themes, mocha for dark ones).
const LATTE: Record<TabStatus, string> = {
  blocked: "#d20f39",
  working: "#df8e1d",
  done: "#179299",
  idle: "#40a02b",
  // overlay2: overlay0 was hard to read as text.
  unknown: "#7c7f93",
};
const MOCHA: Record<TabStatus, string> = {
  blocked: "#f38ba8",
  working: "#f9e2af",
  done: "#94e2d5",
  idle: "#a6e3a1",
  unknown: "#9399b2",
};

function luminance(color: string): number | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (hex?.[1]) {
    const value = parseInt(hex[1], 16);
    return (0.299 * ((value >> 16) & 255) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255)) / 255;
  }
  const rgb = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(color);
  if (rgb) return (0.299 * Number(rgb[1]) + 0.587 * Number(rgb[2]) + 0.114 * Number(rgb[3])) / 255;
  return null;
}

export function statusColor(status: TabStatus, theme: Theme): string {
  const dark = (luminance(theme.colors.surface0) ?? 1) < 0.5;
  return (dark ? MOCHA : LATTE)[status];
}

// Paseo's project colors (its "identity colors"): the same project gets the same color as in Paseo's own
// project list. The hash and the palette follow the Paseo app.
const IDENTITY_COLORS = ["#7a6aa8", "#3d7ea6", "#388068", "#a4673a", "#b05c80", "#6a70b8", "#368080", "#b06260", "#8f7838", "#5179b0"];

function identityHash(text: string): number {
  let hash = 0;
  for (const char of text) hash = (31 * hash + char.charCodeAt(0)) >>> 0;
  return hash;
}

export function projectColor(colorKey: string): string {
  return IDENTITY_COLORS[identityHash(colorKey) % IDENTITY_COLORS.length]!;
}
