"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import { InfoTooltip } from "@/app/components";
import {
  VB_FLOW_MODE,
  VB_MAIN_OPTIONS,
  VB_ENV_DEFAULT_KEY,
  VB_MODEL_REFERENCE_PREF,
} from "@/app/lib/storage-keys";

const FLOW_OPTIONS = [
  { value: "classic", label: "Instant", description: "One pass dresses the model and sets the scene." },
  { value: "sequential", label: "Two-stage", description: "Dress first, place second for more control." },
  { value: "both", label: "Run both", description: "Fire both paths and keep whichever returns first." },
];

const ENVIRONMENT_CHOICES = [
  { value: "studio", label: "Studio" },
  { value: "street", label: "Street" },
  { value: "bed", label: "Bedroom" },
  { value: "beach", label: "Beach" },
  { value: "indoor", label: "Indoor" },
];

const GENDER_CHOICES = [
  { value: "woman", label: "Woman" },
  { value: "man", label: "Man" },
];

const POSE_CHOICES = ["Face", "three-quarter pose", "from the side", "random"];

const MODEL_REFERENCE_CHOICES = [
  { value: "image", label: "Use model photo", description: "Send your default model image to keep fidelity." },
  { value: "description", label: "Use text description", description: "Send the written description for more variety." },
];

const DEFAULT_OPTIONS = {
  gender: "woman",
  environment: "studio",
  poses: ["random"],
  extra: "",
};

export default function SettingsPage() {
  const [flowMode, setFlowMode] = useState("classic");
  const [modelReferencePref, setModelReferencePref] = useState("image");
  const [defaults, setDefaults] = useState(DEFAULT_OPTIONS);
  const [envDefaultKey, setEnvDefaultKey] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    try {
      const savedFlow = localStorage.getItem(VB_FLOW_MODE);
      if (savedFlow && FLOW_OPTIONS.some((o) => o.value === savedFlow)) setFlowMode(savedFlow);
    } catch {}
    try {
      const savedModelRef = localStorage.getItem(VB_MODEL_REFERENCE_PREF);
      if (savedModelRef === "image" || savedModelRef === "description") setModelReferencePref(savedModelRef);
    } catch {}
    try {
      const raw = localStorage.getItem(VB_MAIN_OPTIONS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          setDefaults((prev) => ({
            gender: GENDER_CHOICES.some((g) => g.value === parsed.gender) ? parsed.gender : prev.gender,
            environment: ENVIRONMENT_CHOICES.some((env) => env.value === parsed.environment) ? parsed.environment : prev.environment,
            poses: Array.isArray(parsed.poses) && parsed.poses.length > 0 ? parsed.poses.filter((pose) => POSE_CHOICES.includes(pose)).slice(0, 4) : prev.poses,
            extra: typeof parsed.extra === "string" ? parsed.extra : prev.extra,
          }));
        }
      }
    } catch {}
    try {
      const storedEnvKey = localStorage.getItem(VB_ENV_DEFAULT_KEY);
      if (storedEnvKey) setEnvDefaultKey(storedEnvKey);
    } catch {}
  }, []);

  const poseSelection = useMemo(() => new Set(defaults.poses || []), [defaults.poses]);

  function togglePose(pose) {
    setDefaults((prev) => {
      const current = Array.isArray(prev.poses) ? [...prev.poses] : [];
      const exists = current.includes(pose);
      let next = current;
      if (exists) next = current.filter((item) => item !== pose);
      else if (current.length < 4) next = [...current, pose];
      return { ...prev, poses: next };
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      try { localStorage.setItem(VB_FLOW_MODE, flowMode); } catch {}
      try { localStorage.setItem(VB_MODEL_REFERENCE_PREF, modelReferencePref); } catch {}
      try {
        const payload = {
          gender: defaults.gender,
          environment: defaults.environment,
          poses: Array.isArray(defaults.poses) && defaults.poses.length > 0 ? defaults.poses.slice(0, 4) : ["random"],
          extra: defaults.extra || "",
        };
        localStorage.setItem(VB_MAIN_OPTIONS, JSON.stringify(payload));
      } catch {}
      toast.success("Preferences saved");
    } catch (err) {
      console.error(err);
      toast.error("Failed to save preferences");
    } finally {
      setSaving(false);
    }
  }

  function handleClearEnvDefault() {
    try {
      localStorage.removeItem(VB_ENV_DEFAULT_KEY);
      setEnvDefaultKey(null);
      toast.success("Environment default cleared");
    } catch {
      toast.error("Failed to clear environment default");
    }
  }

  function handleResetAll() {
    try {
      localStorage.removeItem(VB_FLOW_MODE);
      localStorage.removeItem(VB_MODEL_REFERENCE_PREF);
      localStorage.removeItem(VB_MAIN_OPTIONS);
      localStorage.removeItem(VB_ENV_DEFAULT_KEY);
    } catch {}
    setFlowMode("classic");
    setModelReferencePref("image");
    setDefaults(DEFAULT_OPTIONS);
    setEnvDefaultKey(null);
    toast.success("Preferences reset to defaults");
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Preferences</h1>
        <p className="mt-1 text-sm text-foreground/70">Tune how the main creation flow behaves and clear saved defaults.</p>
      </div>

      <section className="rounded-2xl border border-black/10 bg-black/5 p-5 dark:border-white/15 dark:bg-white/5">
        <header className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Generation flow</h2>
          <p className="text-xs text-foreground/60">Choose the default strategy when you open the create page.</p>
        </header>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {FLOW_OPTIONS.map((option) => {
            const active = option.value === flowMode;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setFlowMode(option.value)}
                className={`flex flex-col gap-1 rounded-xl border px-4 py-3 text-left transition ${
                  active ? "border-foreground bg-foreground/10" : "border-foreground/15 hover:border-foreground/30"
                }`}
              >
                <span className="text-sm font-semibold">{option.label}</span>
                <span className="text-xs text-foreground/60">{option.description}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-black/10 bg-black/5 p-5 dark:border-white/15 dark:bg-white/5">
        <header className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Default options</h2>
          <p className="text-xs text-foreground/60">These values pre-fill on the main page. You can still change them before generating.</p>
        </header>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <span className="text-xs font-semibold text-foreground/80">Gender</span>
            <div className="flex flex-wrap gap-2">
              {GENDER_CHOICES.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  onClick={() => setDefaults((prev) => ({ ...prev, gender: choice.value }))}
                  className={`h-9 rounded-full border px-4 text-sm font-medium ${
                    defaults.gender === choice.value ? "border-foreground bg-foreground/10" : "border-foreground/20"
                  }`}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <span className="text-xs font-semibold text-foreground/80">Environment</span>
            <div className="flex flex-wrap gap-2">
              {ENVIRONMENT_CHOICES.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  onClick={() => setDefaults((prev) => ({ ...prev, environment: choice.value }))}
                  className={`h-9 rounded-full border px-4 text-sm font-medium ${
                    defaults.environment === choice.value ? "border-foreground bg-foreground/10" : "border-foreground/20"
                  }`}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-foreground/80">Default poses</span>
              <InfoTooltip label="Default poses" description="Pick up to 4 poses that pre-select on the main flow." />
            </div>
            <div className="flex flex-wrap gap-2">
              {POSE_CHOICES.map((pose) => {
                const active = poseSelection.has(pose);
                return (
                  <button
                    key={pose}
                    type="button"
                    onClick={() => togglePose(pose)}
                    className={`h-9 rounded-full border px-4 text-xs font-medium ${
                      active ? "border-foreground bg-foreground/10" : "border-foreground/20"
                    }`}
                  >
                    {pose}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-foreground/80" htmlFor="defaults-extra">Extra instructions</label>
            <textarea
              id="defaults-extra"
              rows={3}
              className="mt-2 w-full rounded-xl border border-foreground/15 bg-background/40 px-3 py-2 text-sm"
              placeholder="Optional: e.g. mention colours, lighting or vibe"
              value={defaults.extra}
              onChange={(e) => setDefaults((prev) => ({ ...prev, extra: e.target.value }))}
            />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-black/10 bg-black/5 p-5 dark:border-white/15 dark:bg-white/5">
        <header className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Model reference</h2>
          <p className="text-xs text-foreground/60">Decide whether the main flow defaults to sending the model photo or its description.</p>
        </header>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {MODEL_REFERENCE_CHOICES.map((choice) => {
            const active = choice.value === modelReferencePref;
            return (
              <button
                key={choice.value}
                type="button"
                onClick={() => setModelReferencePref(choice.value)}
                className={`flex flex-col gap-1 rounded-xl border px-4 py-3 text-left transition ${
                  active ? "border-foreground bg-foreground/10" : "border-foreground/15 hover:border-foreground/30"
                }`}
              >
                <span className="text-sm font-semibold">{choice.label}</span>
                <span className="text-xs text-foreground/60">{choice.description}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-black/10 bg-black/5 p-5 text-xs text-foreground/70 dark:border-white/15 dark:bg-white/5">
        <h2 className="text-lg font-semibold text-foreground">Saved environment default</h2>
        <p className="mt-1">The create page remembers the last Studio default you picked. Clear it if you want to start fresh.</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="rounded-full border border-foreground/20 px-3 py-1 text-[11px]">{envDefaultKey ? envDefaultKey : "No selection cached"}</span>
          <button
            type="button"
            onClick={handleClearEnvDefault}
            className="h-9 rounded-lg border border-foreground/20 px-3 text-xs font-semibold"
          >
            Clear stored key
          </button>
        </div>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-foreground/60">Stored locally in your browser. Clearing cookies will also reset these.</div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleResetAll}
            className="h-10 rounded-lg border border-foreground/20 px-4 text-sm font-semibold"
          >
            Reset to defaults
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={`h-10 rounded-lg px-4 text-sm font-semibold ${saving ? "bg-foreground/30 text-background/60" : "bg-foreground text-background"}`}
          >
            {saving ? "Saving…" : "Save preferences"}
          </button>
        </div>
      </div>
    </div>
  );
}
