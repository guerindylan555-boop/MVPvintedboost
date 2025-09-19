import { forwardRef } from "react";
import { twMerge } from "tailwind-merge";

export const Textarea = forwardRef(function Textarea({
  helperText,
  className,
  value,
  maxLength,
  ...props
}, ref) {
  const count = typeof value === "string" ? value.length : 0;
  return (
    <div className="space-y-2">
      <div className="relative">
        <textarea
          ref={ref}
          className={twMerge(
            "w-full rounded-xl border border-foreground/15 bg-background/60 px-4 py-3 text-sm text-foreground shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
            className
          )}
          value={value}
          maxLength={maxLength}
          {...props}
        />
        {maxLength ? (
          <span className="pointer-events-none absolute bottom-2 right-3 text-[11px] text-foreground/50">
            {count}/{maxLength}
          </span>
        ) : null}
      </div>
      {helperText ? <p className="text-xs text-foreground/60">{helperText}</p> : null}
    </div>
  );
});
