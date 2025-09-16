"use client";

import { motion } from "framer-motion";
import clsx from "clsx";
import { palette, radius, surfaceStyles, transitions } from "@/app/lib/theme";

const statusPalette = {
  active: palette.accent,
  completed: palette.positive,
  upcoming: palette.cardBorder,
};

export function FlowStep({ step, title, subtitle, status = "upcoming", children, actions }) {
  const styles = surfaceStyles();
  return (
    <motion.section
      layout
      initial={{ opacity: 0, translateY: 8 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col gap-4"
      style={styles}
    >
      <header className="flex items-start justify-between gap-3 border-b border-white/5 px-5 py-4">
        <div className="flex items-center gap-3">
          <span
            className="h-8 w-8 rounded-full flex items-center justify-center text-sm font-semibold"
            style={{
              backgroundColor: `${statusPalette[status]}22`,
              color: statusPalette[status],
              transition: transitions.base,
            }}
          >
            {step}
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-100">{title}</h2>
            {subtitle && <p className="text-xs text-slate-400 mt-1 max-w-prose">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>
      <div className="px-5 pb-5">
        <div className={clsx("flex flex-col gap-4", status !== "active" && "opacity-80")}>{children}</div>
      </div>
    </motion.section>
  );
}
