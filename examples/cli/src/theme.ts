/**
 * Gruvbox Dark theme for the CLI chat TUI.
 *
 * Palette adapted from https://github.com/morhetz/gruvbox
 * with styled text helpers using OpenTUI template literals.
 */

import { t, bold, dim, fg, italic } from "@opentui/core";

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

export const colors = {
  // Backgrounds
  bg: "#282828", // bg0
  bg1: "#3c3836", // bg1 (sidebar, panels)
  bg2: "#504945", // bg2 (active items, borders)
  bg3: "#665c54", // bg3 (hover states)

  // Foregrounds
  fg: "#ebdbb2", // fg0 (main text)
  fg2: "#d5c4a1", // fg2 (secondary text)
  fg3: "#bdae93", // fg3 (muted text)
  fg4: "#a89984", // fg4 (very muted)

  // Grays
  gray: "#928374", // gray

  // Accents
  red: "#fb4934", // bright red
  green: "#b8bb26", // bright green
  yellow: "#fabd2f", // bright yellow
  blue: "#83a598", // bright blue
  purple: "#d3869b", // bright purple
  aqua: "#8ec07c", // bright aqua
  orange: "#fe8019", // bright orange
} as const;

// ---------------------------------------------------------------------------
// Border presets
// ---------------------------------------------------------------------------

export const borders = {
  sidebar: {
    border: true,
    borderStyle: "rounded" as const,
    borderColor: colors.bg2,
  },
  input: {
    border: true,
    borderStyle: "rounded" as const,
    borderColor: colors.bg3,
  },
  dialog: {
    border: true,
    borderStyle: "rounded" as const,
    borderColor: colors.bg3,
  },
  panel: {
    border: true,
    borderStyle: "single" as const,
    borderColor: colors.bg2,
  },
};

// ---------------------------------------------------------------------------
// Styled text helpers
// ---------------------------------------------------------------------------

export const styled = {
  /** Channel name in sidebar. */
  channel: (name: string, active: boolean) =>
    active
      ? t`${bold(fg(colors.aqua)(`  # ${name}`))}`
      : t`  ${fg(colors.fg2)(`# ${name}`)}`,

  /** Active channel indicator. */
  channelActive: (name: string) =>
    t`${fg(colors.orange)(">")} ${bold(fg(colors.aqua)(`# ${name}`))}`,

  /** Message author name. */
  author: (name: string, isOwn: boolean) =>
    isOwn
      ? t`${bold(fg(colors.green)(name))}`
      : t`${bold(fg(colors.purple)(name))}`,

  /** Message timestamp. */
  timestamp: (time: string) => t`${dim(fg(colors.gray)(time))}`,

  /** Message body. */
  message: (body: string, isOwn: boolean) =>
    isOwn ? t`${fg(colors.fg2)(body)}` : t`${fg(colors.fg)(body)}`,

  /** Error text. */
  error: (msg: string) => t`${bold(fg(colors.red)(msg))}`,

  /** Success text. */
  success: (msg: string) => t`${fg(colors.green)(msg)}`,

  /** Muted / help text. */
  muted: (msg: string) => t`${fg(colors.gray)(msg)}`,

  /** Accent text (yellow). */
  accent: (msg: string) => t`${bold(fg(colors.yellow)(msg))}`,

  /** Section title. */
  title: (msg: string) => t`${bold(fg(colors.orange)(msg))}`,

  /** Key hint (e.g. "C" in "C:new"). */
  keyhint: (key: string, label: string) =>
    t`${fg(colors.yellow)(key)}${fg(colors.gray)(`:${label}`)}`,

  /** Italic muted text. */
  empty: (msg: string) => t`${italic(fg(colors.fg4)(msg))}`,
};
