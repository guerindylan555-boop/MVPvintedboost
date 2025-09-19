export const radius = {
  sm: "0.5rem",
  md: "0.75rem",
  lg: "1rem",
};

export const palette = {
  background: "var(--color-surface-strong)",
  card: "var(--color-surface-strong)",
  cardBorder: "var(--color-border)",
  accent: "var(--color-accent)",
  accentSoft: "var(--color-accent-soft)",
  accentContrast: "var(--color-accent-contrast)",
  positive: "var(--color-positive)",
  warning: "var(--color-warning)",
  danger: "var(--color-danger)",
  textPrimary: "var(--color-foreground)",
  textSecondary: "var(--color-text-secondary)",
};

export const shadows = {
  soft: "var(--shadow-soft)",
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
