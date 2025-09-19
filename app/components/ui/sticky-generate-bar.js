"use client";

import { useEffect } from "react";
import { Button, Chip } from "@heroui/react";
import { twMerge } from "tailwind-merge";

export function StickyGenerateBar({
  items,
  onGenerate,
  disabled,
  isGenerating,
  className,
}) {
  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const previous = document.body.style.getPropertyValue("--nav-offset");
    document.body.style.setProperty("--nav-offset", "7.5rem");
    return () => {
      if (previous) {
        document.body.style.setProperty("--nav-offset", previous);
      } else {
        document.body.style.removeProperty("--nav-offset");
      }
    };
  }, []);

  return (
    <div className={twMerge("pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4", className)}>
      <div className="pointer-events-auto w-full max-w-5xl rounded-3xl border border-foreground/10 bg-background/95 px-4 py-3 shadow-2xl shadow-black/10 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {items.map((item) => (
              <Chip
                key={item.label}
                radius="sm"
                variant={item.complete ? "solid" : "bordered"}
                color={item.complete ? "success" : "default"}
                className="h-8 border-foreground/20 bg-foreground/5 px-3 text-xs font-medium text-foreground"
              >
                {item.complete ? `${item.label}: ${item.value}` : `${item.label}: ${item.placeholder || "Select"}`}
              </Chip>
            ))}
          </div>
          <Button
            color="primary"
            variant="solid"
            radius="lg"
            size="md"
            className="h-11 min-w-[160px] text-sm font-semibold"
            isDisabled={disabled}
            isLoading={isGenerating}
            onPress={onGenerate}
          >
            {isGenerating ? "Generating…" : "Generate"}
          </Button>
        </div>
      </div>
    </div>
  );
}
