"use client";

import { useState } from "react";
import { useFloating, offset, flip, shift, arrow, autoUpdate } from "@floating-ui/react";
import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";
import { palette, radius, shadows, transitions } from "@/app/lib/theme";

export function InfoTooltip({ label, description, className, side = "top", children }) {
  const [open, setOpen] = useState(false);
  const [arrowEl, setArrowEl] = useState(null);
  const { refs, floatingStyles, middlewareData } = useFloating({
    placement: side,
    open,
    onOpenChange: setOpen,
    middleware: [offset(8), flip(), shift({ padding: 8 }), arrow({ element: arrowEl })],
    whileElementsMounted: autoUpdate,
  });

  return (
    <div
      className={clsx("inline-flex items-center", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button
        type="button"
        ref={refs.setReference}
        className="h-5 w-5 rounded-full text-xs font-semibold flex items-center justify-center"
        style={{
          backgroundColor: palette.accentSoft,
          color: palette.accent,
          transition: transitions.base,
        }}
      >
        {children || "?"}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            ref={refs.setFloating}
            style={floatingStyles}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="z-50 max-w-xs text-left"
          >
            <div
              className="p-3"
              style={{
                borderRadius: radius.md,
                background: palette.card,
                color: palette.textPrimary,
                border: `1px solid ${palette.cardBorder}`,
                boxShadow: shadows.soft,
              }}
            >
              <p className="text-sm font-semibold mb-1">{label}</p>
              {description && (
                <p className="text-xs leading-snug text-[color:var(--color-text-secondary)]">{description}</p>
              )}
            </div>
            <div
              ref={setArrowEl}
              className="absolute h-2 w-2 rotate-45"
              style={{
                background: palette.card,
                borderLeft: `1px solid ${palette.cardBorder}`,
                borderTop: `1px solid ${palette.cardBorder}`,
                left: middlewareData.arrow?.x != null ? middlewareData.arrow.x : "",
                top: middlewareData.arrow?.y != null ? middlewareData.arrow.y : "",
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
