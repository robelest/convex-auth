export const colors = {
  accent: {
    300: "#e8a070",
    400: "#d4764a",
    500: "#c25d3a",
    600: "#a34a2a",
  },
  warm: {
    50: "#fdfcfa",
    100: "#faf8f5",
    200: "#f5f2ed",
    300: "#e8e2d8",
    400: "#b5aea3",
    500: "#8c8780",
    600: "#6b665f",
    700: "#4a453e",
    800: "#2d2a26",
    900: "#1a1816",
  },
  success: "#16a34a",
  urgent: "#991b1b",
  white: "#ffffff",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
} as const;

export const fontSize = {
  xs: 10,
  sm: 12,
  md: 14,
  lg: 16,
  xl: 18,
  "2xl": 22,
  "3xl": 28,
} as const;

export const lineHeight = {
  xs: 14,
  sm: 16,
  md: 20,
  lg: 22,
  xl: 24,
  "2xl": 28,
  "3xl": 34,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 999,
} as const;

export const shadows = {
  sm: { boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)" },
  md: { boxShadow: "0 4px 8px rgba(0, 0, 0, 0.08)" },
  lg: { boxShadow: "0 8px 16px rgba(0, 0, 0, 0.12)" },
  accent: { boxShadow: "0 8px 24px rgba(194, 93, 58, 0.28)" },
} as const;

export const priorityColors = {
  none: {
    bg: colors.warm[50],
    text: colors.warm[500],
    border: colors.warm[200],
  },
  urgent: { bg: "#fef2f2", text: "#7f1d1d", border: "#fecaca" },
  high: { bg: "#fff7ed", text: "#7c2d12", border: "#fed7aa" },
  medium: { bg: "#fffbeb", text: "#854d0e", border: "#fde68a" },
  low: {
    bg: colors.warm[100],
    text: colors.warm[600],
    border: colors.warm[300],
  },
} as const;

export const statusColors = {
  in_progress: colors.accent[500],
  todo: colors.warm[500],
  backlog: colors.warm[400],
  done: colors.success,
  cancelled: colors.warm[300],
} as const;

export const roleColors = {
  admin: colors.accent[500],
  member: colors.warm[500],
  viewer: colors.warm[400],
} as const;
