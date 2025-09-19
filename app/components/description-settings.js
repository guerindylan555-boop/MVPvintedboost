"use client";

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
    <div className="mt-4 space-y-3 rounded-xl border border-foreground/15 bg-background/40 p-4">
      <div className="flex items-center justify-between text-xs text-foreground/70">
        <span>Generate product description</span>
        <button
          type="button"
          onClick={() => onToggle(!enabled)}
          className={`relative inline-flex h-6 w-12 items-center rounded-full transition ${
            enabled ? "bg-foreground" : "bg-foreground/30"
          }`}
          aria-pressed={enabled}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-background transition ${
              enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>
      {enabled && (
        <div className="grid grid-cols-2 gap-2 text-sm">
          <input
            type="text"
            className="col-span-2 h-9 rounded-lg border border-foreground/15 bg-background/40 px-3"
            placeholder="Brand (e.g., Nike, Zara)"
            value={desc.brand}
            onChange={(e) => onDescFieldChange("brand", e.target.value)}
          />
          <input
            type="text"
            className="col-span-2 h-9 rounded-lg border border-foreground/15 bg-background/40 px-3"
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
                  className={`h-8 rounded-full border px-3 text-xs ${
                    productCondition === condition ? "border-foreground" : "border-foreground/20"
                  }`}
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
                  className={`h-8 rounded-full border px-3 text-xs uppercase ${
                    desc.size === size ? "border-foreground" : "border-foreground/20"
                  }`}
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
