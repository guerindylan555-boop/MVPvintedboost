"use client";

import clsx from "clsx";

const CONDITIONS = ["Brand new", "Very good", "Good"];
const SIZES = ["xs", "s", "m", "l", "xl"];

export function DescriptionSettings({
  enabled,
  onToggle,
  desc,
  onDescFieldChange,
  productCondition,
  onConditionChange,
}) {
  return (
    <div className="mt-4 space-y-3 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-strong)] p-4">
      <div className="flex items-center justify-between text-xs text-[color:var(--color-text-secondary)]">
        <span>Generate product description</span>
        <button
          type="button"
          onClick={() => onToggle(!enabled)}
          className={clsx(
            "relative inline-flex h-6 w-12 items-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-background)]",
            enabled
              ? "border-transparent bg-[color:var(--color-accent)]"
              : "border-[color:var(--color-border)] bg-[color:var(--color-surface)]"
          )}
          aria-pressed={enabled}
        >
          <span
            className={clsx(
              "inline-block h-5 w-5 transform rounded-full bg-[color:var(--color-background)] shadow transition",
              enabled ? "translate-x-6" : "translate-x-1"
            )}
          />
        </button>
      </div>
      {enabled && (
        <div className="grid grid-cols-2 gap-2 text-sm">
          <input
            type="text"
            className="col-span-2 h-9 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent)] focus:ring-offset-2 focus:ring-offset-[color:var(--color-background)]"
            placeholder="Brand (e.g., Nike, Zara)"
            value={desc.brand}
            onChange={(e) => onDescFieldChange("brand", e.target.value)}
          />
          <input
            type="text"
            className="col-span-2 h-9 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent)] focus:ring-offset-2 focus:ring-offset-[color:var(--color-background)]"
            placeholder="Model (e.g., Air Max 90)"
            value={desc.productModel}
            onChange={(e) => onDescFieldChange("productModel", e.target.value)}
          />
          <div className="col-span-2">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Condition">
              {CONDITIONS.map((condition) => (
                <button
                  key={condition}
                  type="button"
                  onClick={() => onConditionChange(condition)}
                  className={clsx(
                    "h-8 rounded-full border px-3 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-background)]",
                    productCondition === condition
                      ? "border-transparent bg-[color:var(--color-accent)] text-[color:var(--color-accent-contrast)]"
                      : "border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-text-secondary)] hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-surface-strong)]"
                  )}
                  aria-pressed={productCondition === condition}
                >
                  {condition}
                </button>
              ))}
            </div>
          </div>
          <div className="col-span-2">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Size">
              {SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => onDescFieldChange("size", size)}
                  className={clsx(
                    "h-8 rounded-full border px-3 text-xs uppercase transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-background)]",
                    desc.size === size
                      ? "border-transparent bg-[color:var(--color-accent)] text-[color:var(--color-accent-contrast)]"
                      : "border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-text-secondary)] hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-surface-strong)]"
                  )}
                  aria-pressed={desc.size === size}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
