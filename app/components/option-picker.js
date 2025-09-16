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
          {label && <div className="text-sm font-semibold text-slate-100">{label}</div>}
          {description && <p className="text-xs text-slate-400 mt-1">{description}</p>}
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
                selected
                  ? "border-transparent"
                  : "border-white/10 hover:border-white/20"
              )}
              style={{
                backgroundColor: selected ? `${palette.accentSoft}` : "rgba(15,23,42,0.5)",
                color: palette.textPrimary,
                borderRadius: radius.md,
                transition: transitions.base,
              }}
            >
              <span className="text-sm font-medium">{option.label}</span>
              {option.description && (
                <span className="text-xs text-slate-400 leading-snug">{option.description}</span>
              )}
              {option.badge && (
                <span
                  className="text-[10px] uppercase tracking-wide mt-1 inline-flex self-start rounded-full px-2 py-0.5"
                  style={{
                    backgroundColor: `${palette.accent}22`,
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
