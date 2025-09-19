export const radius = {
  sm: "0.5rem",
  md: "0.75rem",
  lg: "1rem",
};

export const palette = {
  background: "var(--color-surface)",
  card: "var(--color-surface-strong)",
  cardBorder: "var(--color-border-subtle)",
  accent: "#007782",
  accentSoft: "var(--color-accent-soft)",
  positive: "#22c55e",
  warning: "#f97316",
  danger: "#ef4444",
  textPrimary: "var(--color-foreground)",
  textSecondary: "var(--color-foreground-muted)",
};

export const shadows = {
  soft: "var(--shadow-surface)",
};

export const transitions = {
  base: "all 0.2s ease",
};

export function surfaceStyles() {
  return {
    borderRadius: radius.lg,
    border: `1px solid ${palette.cardBorder}`,
    background: palette.card,
    backdropFilter: "blur(var(--blur-surface))",
    WebkitBackdropFilter: "blur(var(--blur-surface))",
    boxShadow: shadows.soft,
  };
}
