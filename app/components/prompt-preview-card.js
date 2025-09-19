"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";
import { palette, radius, surfaceStyles, transitions } from "@/app/lib/theme";

export function PromptPreviewCard({ prompt, onChange, dirty, onReset }) {
  const [expanded, setExpanded] = useState(true);
  const styles = surfaceStyles();

  return (
    <section className="flex flex-col gap-3" style={styles}>
      <header
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: palette.cardBorder }}
      >
        <div>
          <h3 className="text-sm font-semibold" style={{ color: palette.textPrimary }}>
            Prompt preview
          </h3>
          <p className="text-xs mt-1" style={{ color: palette.textSecondary }}>
            Live snapshot of what we send to Gemini. Override when you need something bespoke.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <button
              type="button"
              onClick={onReset}
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: palette.accent }}
            >
              Reset
            </button>
          )}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: palette.textSecondary, transition: transitions.base }}
          >
            {expanded ? "Hide" : "Show"}
          </button>
        </div>
      </header>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="prompt-body"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="px-4 pb-4"
          >
            <textarea
              value={prompt}
              onChange={(e) => onChange?.(e.target.value)}
              className={clsx(
                "w-full min-h-[160px] text-sm leading-relaxed resize-y focus:outline-none p-4",
                "border rounded-lg focus:ring-2 focus:ring-[rgba(0,119,130,0.28)]"
              )}
              style={{
                color: palette.textPrimary,
                borderRadius: radius.md,
                borderColor: palette.cardBorder,
                backgroundColor: palette.background,
                transition: transitions.base,
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
