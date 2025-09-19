"use client";

import clsx from "clsx";

import { InfoTooltip } from "./info-tooltip";

const TYPES = ["top", "bottom", "full"];

export function GarmentTypeSelector({ value, onChange }) {
  return (
    <div className="mt-4">
      <label className="inline-flex items-center gap-2 text-xs font-medium text-[color:var(--color-text-secondary)]">
        Garment type
        <InfoTooltip
          label="Garment type"
          description="Set to Top/Bottom/Full if you know it. Leave empty to auto-detect once and cache on the listing."
        />
      </label>
      <div className="mt-2 grid grid-cols-3 overflow-hidden rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
        {TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onChange(value === t ? null : t)}
            className={clsx(
              "h-10 text-xs font-medium uppercase tracking-wide transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-background)]",
              value === t
                ? "bg-[color:var(--color-accent)] text-[color:var(--color-accent-contrast)]"
                : "text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-surface-strong)]"
            )}
          >
            {t}
          </button>
        ))}
      </div>
      {!value && <p className="mt-1 text-[11px] text-[color:var(--color-text-tertiary)]">Auto-detect if not set.</p>}
    </div>
  );
}
