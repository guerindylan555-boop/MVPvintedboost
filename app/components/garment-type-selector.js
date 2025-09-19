"use client";

import { InfoTooltip } from "./info-tooltip";

const TYPES = ["top", "bottom", "full"];

export function GarmentTypeSelector({ value, onChange }) {
  return (
    <div className="mt-4">
      <label className="inline-flex items-center gap-2 text-xs font-medium text-foreground/80">
        Garment type
        <InfoTooltip
          label="Garment type"
          description="Set to Top/Bottom/Full if you know it. Leave empty to auto-detect once and cache on the listing."
        />
      </label>
      <div className="mt-2 grid grid-cols-3 overflow-hidden rounded-lg border border-foreground/15">
        {TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onChange(value === t ? null : t)}
            className={`h-10 text-xs font-medium uppercase tracking-wide transition ${
              value === t ? "bg-foreground text-background" : "text-foreground/70"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      {!value && <p className="mt-1 text-[11px] text-foreground/50">Auto-detect if not set.</p>}
    </div>
  );
}
