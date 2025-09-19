"use client";

import clsx from "clsx";
import { palette, radius, transitions } from "@/app/lib/theme";

export function OptionPicker({
  label,
  description,
  options,
  value,
  onChange,
  multiple = false,
  maxSelections,
  renderExtra,
}) {
  function toggle(nextValue) {
    if (!multiple) {
      onChange?.(nextValue);
      return;
    }
    const current = Array.isArray(value) ? value : [];
    const exists = current.includes(nextValue);
    let next;
    if (exists) {
      next = current.filter((v) => v !== nextValue);
    } else {
      if (maxSelections && current.length >= maxSelections) return;
      next = [...current, nextValue];
    }
    onChange?.(next);
  }

  const isSelected = (optionValue) => {
    if (multiple) return Array.isArray(value) && value.includes(optionValue);
    return optionValue === value;
  };

  return (
    <div className="flex flex-col gap-3">
      {(label || description) && (
        <div>
          {label && (
            <div className="text-sm font-semibold text-[color:var(--color-foreground)]">{label}</div>
          )}
          {description && (
            <p className="mt-1 text-xs text-[color:var(--color-text-secondary)]">{description}</p>
          )}
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const selected = isSelected(option.value);
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => toggle(option.value)}
              className={clsx(
                "text-left px-4 py-3 rounded-lg border transition flex flex-col gap-1 ring-1",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]",
                "focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-background)]",
                selected
                  ? "border-transparent bg-[color:var(--color-accent)] text-[color:var(--color-accent-contrast)] ring-[color:var(--color-accent)] shadow-sm"
                  : "border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-foreground)] ring-[color:var(--color-border-muted)] hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-surface-strong)]"
              )}
              style={{
                color: selected ? palette.accentContrast : palette.textPrimary,
                borderRadius: radius.md,
                transition: transitions.base,
              }}
            >
              <span className="text-sm font-medium">{option.label}</span>
              {option.description && (
                <span
                  className={clsx(
                    "text-xs leading-snug",
                    selected
                      ? "text-[color:var(--color-accent-contrast)]/80"
                      : "text-[color:var(--color-text-secondary)]"
                  )}
                >
                  {option.description}
                </span>
              )}
              {option.badge && (
                <span
                  className="text-[10px] uppercase tracking-wide mt-1 inline-flex self-start rounded-full px-2 py-0.5"
                  style={{
                    backgroundColor: palette.accentSoft,
                    color: palette.accent,
                  }}
                >
                  {option.badge}
                </span>
              )}
              {renderExtra && <div className="mt-2">{renderExtra({ option, selected })}</div>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
