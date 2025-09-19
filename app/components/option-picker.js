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
            <div className="text-sm font-semibold" style={{ color: palette.textPrimary }}>
              {label}
            </div>
          )}
          {description && (
            <p className="text-xs mt-1" style={{ color: palette.textSecondary }}>
              {description}
            </p>
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
                "text-left px-4 py-3 rounded-lg border transition flex flex-col gap-1",
                selected && "shadow-[0_18px_45px_rgba(0,119,130,0.18)]"
              )}
              style={{
                backgroundColor: selected ? palette.accentSoft : palette.background,
                color: palette.textPrimary,
                borderRadius: radius.md,
                borderColor: selected ? palette.accent : palette.cardBorder,
                transition: transitions.base,
              }}
            >
              <span className="text-sm font-medium">{option.label}</span>
              {option.description && (
                <span className="text-xs leading-snug" style={{ color: palette.textSecondary }}>
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
