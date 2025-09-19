import { twMerge } from "tailwind-merge";

export function SegmentedControl({
  options,
  value,
  onChange,
  label,
  helperText,
  error,
  name,
}) {
  return (
    <div className="space-y-2">
      {label ? (
        <p className="text-sm font-medium text-foreground/80">{label}</p>
      ) : null}
      <div className={twMerge(
        "grid grid-cols-3 overflow-hidden rounded-xl border",
        error ? "border-red-500/60" : "border-foreground/15"
      )}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              name={name}
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
              className={twMerge(
                "flex h-11 items-center justify-center px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
                selected
                  ? "bg-foreground text-background"
                  : "bg-background/70 text-foreground/70 hover:bg-foreground/5"
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {helperText ? (
        <p className={twMerge("text-xs", error ? "text-red-500" : "text-foreground/60")}>{helperText}</p>
      ) : null}
    </div>
  );
}
