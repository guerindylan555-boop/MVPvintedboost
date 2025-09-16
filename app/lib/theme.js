export const spacing = {
  xs: "0.5rem",
  sm: "0.75rem",
  md: "1rem",
  lg: "1.5rem",
  xl: "2rem",
};

export const radius = {
  sm: "0.5rem",
  md: "0.75rem",
  lg: "1rem",
};

export const palette = {
  background: "#0f172a",
  card: "rgba(15, 23, 42, 0.8)",
  cardBorder: "rgba(148, 163, 184, 0.2)",
  accent: "#38bdf8",
  accentSoft: "rgba(56, 189, 248, 0.2)",
  positive: "#22c55e",
  warning: "#f97316",
  danger: "#ef4444",
  textPrimary: "#f8fafc",
  textSecondary: "#cbd5f5",
};

export const shadows = {
  soft: "0 10px 50px rgba(15, 23, 42, 0.35)",
};

export const transitions = {
  base: "all 0.2s ease",
};

export function surfaceStyles() {
  return {
    borderRadius: radius.lg,
    border: `1px solid ${palette.cardBorder}`,
    background: palette.card,
    backdropFilter: "blur(16px)",
    boxShadow: shadows.soft,
  };
}
