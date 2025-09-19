"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "react-hot-toast";
import { createAuthClient } from "better-auth/react";

import {
  AdminReviewPanel,
  AdminToolsCard,
  DescriptionSettings,
  GarmentTypeSelector,
  SceneModelOptions,
  UploadPanel,
} from "@/app/components";
import { useListingGenerator } from "@/app/hooks/use-listing-generator";
import { getApiBase, withUserId } from "@/app/lib/api";
import { VB_FLOW_MODE, VB_MAIN_OPTIONS, VB_ENV_DEFAULT_KEY, VB_MODEL_REFERENCE_PREF } from "@/app/lib/storage-keys";
import { buildMirrorSelfiePreview } from "@/app/lib/prompt-preview";
import { preprocessImage } from "@/app/lib/image-preprocess";
import { broadcastListingsUpdated } from "@/app/lib/listings-events";

const authClient = createAuthClient();
const POSE_MAX = 10;

export default function Home() {
  const { data: session } = authClient.useSession();
  const isAdmin = Boolean(session?.user?.isAdmin);
  const userId = session?.session?.userId || session?.user?.id || session?.user?.email || null;
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPreprocessing, setIsPreprocessing] = useState(false);
  const [showWalkthrough, setShowWalkthrough] = useState(false);
  // Pose choices for mirror selfie flow
  const [options, setOptions] = useState({
    gender: "woman",
    environment: "studio",
    extra: "",
    poseCount: 3,
  });
  // Toggle to choose whether to send the model default image (true) or
  // only its stored textual description (false) with the prompt
  const [useModelImage, setUseModelImage] = useState(true);
  const [envDefaults, setEnvDefaults] = useState([]); // [{s3_key,name,url}]
  const [envDefaultsLoading, setEnvDefaultsLoading] = useState(true);
  const [selectedEnvDefaultKey, setSelectedEnvDefaultKey] = useState(null);
  const [title, setTitle] = useState("");
  const [descEnabled, setDescEnabled] = useState(false);
  const [desc, setDesc] = useState({ brand: "", productModel: "", size: "" });
  const [productCondition, setProductCondition] = useState("");
  const [optionsCollapsed, setOptionsCollapsed] = useState(false);
  // Flow mode: classic | sequential | both
  const [flowMode, setFlowMode] = useState("both");
  // Prompt preview/editor
  const [promptInput, setPromptInput] = useState("");
  const [promptDirty, setPromptDirty] = useState(false);
  // Admin: DB init action
  const [initDbBusy, setInitDbBusy] = useState(false);
  // Pose descriptions fetched from Studio (for random)
  const [poseDescs, setPoseDescs] = useState([]); // [{s3_key, description, created_at}]
  const [randomPosePick, setRandomPosePick] = useState(null); // one chosen description at load
  // Garment type override: null (auto), or 'top'|'bottom'|'full'
  const [garmentType, setGarmentType] = useState(null);
  const [poseRandomCache, setPoseRandomCache] = useState(Array.from({ length: POSE_MAX }, () => null));
  const plannedImagesCount = Number.isFinite(options.poseCount) && options.poseCount > 0
    ? Math.min(Math.max(Math.round(options.poseCount), 1), POSE_MAX)
    : 1;

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    try {
      const seen = localStorage.getItem("vb_walkthrough_seen");
      if (!seen) setShowWalkthrough(true);
    } catch {}
  }, []);

  // Load pose descriptions from Studio for random selection
  useEffect(() => {
    (async () => {
      try {
        const baseUrl = getApiBase();
        const res = await fetch(`${baseUrl}/pose/descriptions`);
        const data = await res.json();
        if (data?.items && Array.isArray(data.items)) {
          setPoseDescs(data.items);
          if (data.items.length > 0) {
            const pick = data.items[Math.floor(Math.random() * data.items.length)];
            setRandomPosePick(pick);
          }
        }
      } catch {}
    })();
  }, []);
  // Load/persist flow mode selection
  useEffect(() => {
    if (!isAdmin) return;
    try {
      const saved = localStorage.getItem(VB_FLOW_MODE);
      if (saved === "classic" || saved === "sequential" || saved === "both") setFlowMode(saved);
    } catch {}
  }, [isAdmin]);
  useEffect(() => {
    if (!isAdmin) return;
    try { localStorage.setItem(VB_FLOW_MODE, flowMode); } catch {}
  }, [isAdmin, flowMode]);

  useEffect(() => {
    if (!isAdmin) return;
    try {
      const stored = localStorage.getItem(VB_MODEL_REFERENCE_PREF);
      if (stored === "image" || stored === "description") setUseModelImage(stored === "image");
    } catch {}
  }, [isAdmin]);
  useEffect(() => {
    if (!isAdmin) return;
    try { localStorage.setItem(VB_MODEL_REFERENCE_PREF, useModelImage ? "image" : "description"); } catch {}
  }, [isAdmin, useModelImage]);

  useEffect(() => {
    if (!isAdmin) {
      setUseModelImage(true);
      setFlowMode("both");
    }
  }, [isAdmin]);

  // Load environment defaults to reflect in UI label
  useEffect(() => {
    (async () => {
      setEnvDefaultsLoading(true);
      try {
        const baseUrl = getApiBase();
        const res = await fetch(`${baseUrl}/env/defaults`, { headers: withUserId({}, userId) });
        const data = await res.json();
        if (data?.items) setEnvDefaults(data.items);
      } catch {}
      setEnvDefaultsLoading(false);
    })();
  }, [userId]);

  // Remember last selected options (gender, environment, poses, extra) and restore on load
  useEffect(() => {
    try {
      const raw = localStorage.getItem(VB_MAIN_OPTIONS);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved && typeof saved === "object") {
          setOptions((o) => {
            const next = {
              ...o,
              gender: saved.gender || o.gender,
              environment: saved.environment || o.environment,
              extra: typeof saved.extra === "string" ? saved.extra : o.extra,
            };
            const savedCount = Number.isFinite(saved.poseCount)
              ? Number(saved.poseCount)
              : (Array.isArray(saved.poses) ? saved.poses.length : o.poseCount);
            if (savedCount && Number.isFinite(savedCount)) {
              const clamped = Math.min(Math.max(Math.round(savedCount), 1), POSE_MAX);
              next.poseCount = clamped;
            }
            return next;
          });
        }
      }
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem(VB_MAIN_OPTIONS, JSON.stringify(options)); } catch {}
  }, [options]);

  // Load model defaults (one per gender)
  const [modelDefaults, setModelDefaults] = useState({}); // { man: {s3_key,name}, woman: {...} }
  useEffect(() => {
    (async () => {
      try {
        const baseUrl = getApiBase();
        const res = await fetch(`${baseUrl}/model/defaults`);
        const data = await res.json();
        if (data?.items) {
          const next = {};
          for (const it of data.items) next[it.gender] = it;
          setModelDefaults(next);
        }
      } catch {}
    })();
  }, []);

  const modelDefaultList = useMemo(() => {
    const list = [];
    if (modelDefaults?.woman) list.push({ gender: "woman", ...modelDefaults.woman });
    if (modelDefaults?.man) list.push({ gender: "man", ...modelDefaults.man });
    return list;
  }, [modelDefaults]);

  useEffect(() => {
    if (modelDefaultList.length === 0) return;
    const hasCurrent = modelDefaultList.some((item) => item.gender === options.gender);
    if (!hasCurrent) {
      setOptions((prev) => ({ ...prev, gender: modelDefaultList[0].gender }));
    }
  }, [modelDefaultList, options.gender]);

  // Load saved studio default selection
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VB_ENV_DEFAULT_KEY);
      if (saved) setSelectedEnvDefaultKey(saved);
    } catch {}
  }, []);

  // Keep selection in sync with available defaults
  useEffect(() => {
    if (!envDefaults || envDefaults.length === 0) return;
    const exists = selectedEnvDefaultKey && envDefaults.some((d) => d.s3_key === selectedEnvDefaultKey);
    if (!exists) {
      const first = envDefaults[0]?.s3_key || null;
      setSelectedEnvDefaultKey(first);
      try {
        if (first) localStorage.setItem(VB_ENV_DEFAULT_KEY, first);
      } catch {}
    }
  }, [envDefaults, selectedEnvDefaultKey]);

  // If defaults exist, force environment to studio in options
  useEffect(() => {
    if (envDefaults && envDefaults.length > 0 && options.environment !== "studio") {
      setOptions((o) => ({ ...o, environment: "studio" }));
    }
  }, [envDefaults, options.environment]);

  async function handleInitDb() {
    if (!isAdmin || initDbBusy) return;
    const toastId = toast.loading("Initializing database…");
    setInitDbBusy(true);
    try {
      const res = await fetch("/api/admin/init-db", { method: "POST" });
      const text = await res.text();
      if (!res.ok) throw new Error(text || "Failed");
      toast.success("DB initialized", { id: toastId });
    } catch (e) {
      toast.error(`Init failed: ${e?.message || "error"}`, { id: toastId });
    } finally {
      setInitDbBusy(false);
    }
  }

  function dismissWalkthrough() {
    setShowWalkthrough(false);
    try { localStorage.setItem("vb_walkthrough_seen", "1"); } catch {}
  }

  const getRandomPoseDescription = useCallback(() => {
    const items = Array.isArray(poseDescs) ? poseDescs : [];
    if (items.length > 0) {
      const pick = items[Math.floor(Math.random() * items.length)];
      if (pick?.description) return pick.description;
    }
    if (randomPosePick?.description) return randomPosePick.description;
    return "";
  }, [poseDescs, randomPosePick]);

  function resolvePoseInstruction(index = 0) {
    const idx = Math.max(0, Math.min(index, POSE_MAX - 1));
    const fallback = (typeof poseRandomCache[idx] === "string" && poseRandomCache[idx]) || getRandomPoseDescription();
    return { poseValue: "random", description: fallback };
  }

  function computeEffectivePrompt(index = 0, forPreview = true) {
    const envDefaultKey = options.environment === "studio" && (selectedEnvDefaultKey || envDefaults[0]?.s3_key)
      ? (selectedEnvDefaultKey || envDefaults[0]?.s3_key)
      : undefined;
    const personDefault = options.gender === "woman" ? modelDefaults?.woman : modelDefaults?.man;
    const personDefaultKey = personDefault?.s3_key;
    const personDesc = personDefault?.description;
    const usingPersonImage = !!(useModelImage && personDefaultKey);
    const { poseValue, description } = resolvePoseInstruction(index);
    return buildMirrorSelfiePreview({
      gender: options.gender,
      environment: options.environment,
      pose: poseValue,
      extra: options.extra || "",
      usingPersonImage,
      personDesc: useModelImage ? "" : (personDesc || ""),
      envDefaultKey,
      randomPoseDescription: description,
      forPreview,
    });
  }

  useEffect(() => {
    setPoseRandomCache((prev) => {
      const next = [...prev];
      let changed = false;
      for (let i = 0; i < POSE_MAX; i += 1) {
        if (i >= plannedImagesCount) {
          if (next[i] !== null) {
            next[i] = null;
            changed = true;
          }
          continue;
        }
        if (!next[i]) {
          const randomDesc = getRandomPoseDescription();
          if (randomDesc) {
            next[i] = randomDesc;
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [options.poseCount, getRandomPoseDescription, plannedImagesCount]);
  const envDefaultsKey = useMemo(
    () => (Array.isArray(envDefaults) ? envDefaults.map((d) => d.s3_key).join("|") : ""),
    [envDefaults]
  );
  const modelDefaultsKey = useMemo(() => {
    if (!modelDefaults) return "";
    const woman = modelDefaults?.woman
      ? `${modelDefaults.woman.s3_key || ""}:${modelDefaults.woman.description || ""}`
      : "";
    const man = modelDefaults?.man
      ? `${modelDefaults.man.s3_key || ""}:${modelDefaults.man.description || ""}`
      : "";
    return `${woman}|${man}`;
  }, [modelDefaults]);

  // Keep prompt preview in sync unless user edited it
  useEffect(() => {
    if (!promptDirty) {
      setPromptInput(computeEffectivePrompt(0, true));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    options.gender,
    options.environment,
    options.poseCount,
    options.extra,
    selectedEnvDefaultKey,
    envDefaultsKey,
    modelDefaultsKey,
    useModelImage,
    promptDirty,
    poseRandomCache,
  ]);

  const { isGenerating, poseStatus, poseErrors, handleGenerate } = useListingGenerator({
    selectedFile,
    options,
    plannedImagesCount,
    selectedEnvDefaultKey,
    envDefaults,
    modelDefaults,
    useModelImage,
    promptDirty,
    promptInput,
    garmentType,
    title,
    descEnabled,
    desc,
    productCondition,
    userId,
    flowMode,
    resolvePoseInstruction,
    computeEffectivePrompt,
  });

  async function setImageFile(file) {
    if (!file) return;
    if (!file.type?.startsWith("image/")) {
      alert("Please select an image file.");
      return;
    }
    // Revoke previous preview if any
    if (previewUrl) try { URL.revokeObjectURL(previewUrl); } catch {}
    setIsPreprocessing(true);
    try {
      const { file: processed, previewUrl: url } = await preprocessImage(file);
      setSelectedFile(processed || file);
      setPreviewUrl(url || URL.createObjectURL(processed || file));
    } catch {
      // Fallback to original
      const objectUrl = URL.createObjectURL(file);
      setSelectedFile(file);
      setPreviewUrl(objectUrl);
    } finally {
      setIsPreprocessing(false);
    }
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    await setImageFile(file);
  }

  async function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    await setImageFile(file);
  }

  function handleDragOver(e) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleTriggerPick() { fileInputRef.current?.click(); }
  function handleTriggerCamera() { cameraInputRef.current?.click(); }

  function handleSelectEnvironmentDefault(key) {
    setSelectedEnvDefaultKey(key);
    try { localStorage.setItem(VB_ENV_DEFAULT_KEY, key); } catch {}
    if (options.environment !== "studio") {
      setOptions((o) => ({ ...o, environment: "studio" }));
    }
  }

  function handlePoseCountChange(next) {
    const parsed = Number(next);
    const numeric = Number.isFinite(parsed) ? Math.round(parsed) : plannedImagesCount;
    const clamped = Math.min(Math.max(numeric, 1), POSE_MAX);
    setOptions((prev) => {
      if (prev.poseCount === clamped) return prev;
      return { ...prev, poseCount: clamped };
    });
  }

  function clearSelection() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const canGenerate = Boolean(selectedFile) && !isGenerating;
  const selectedEnvironment = selectedEnvDefaultKey
    ? envDefaults.find((env) => env.s3_key === selectedEnvDefaultKey)
    : envDefaults[0];
  const environmentSummary = envDefaults.length > 0
    ? selectedEnvironment?.name || "Saved default"
    : options.environment;
  const selectedModelDefault = options.gender === "woman" ? modelDefaults?.woman : modelDefaults?.man;
  const modelSummary = useModelImage
    ? (selectedModelDefault?.name || "Default image")
    : "Description";
  const garmentSummary = garmentType || "auto";
  const poseSummary = `${plannedImagesCount} image${plannedImagesCount > 1 ? "s" : ""}`;
  const poseStatusList = Array.from({ length: plannedImagesCount }, (_, idx) => {
    const key = `slot-${idx + 1}`;
    const randomLabel = typeof poseRandomCache[idx] === "string" && poseRandomCache[idx]?.trim() ? poseRandomCache[idx] : "Random pose";
    return {
      key,
      index: idx,
      label: randomLabel || `Image ${idx + 1}`,
      status: poseStatus[key] || (isGenerating ? "running" : "pending"),
      error: poseErrors[key],
    };
  });
  const modelReferenceOptions = useMemo(() => [
    {
      value: "image",
      label: "Use model photo",
      description: "Send the default person image alongside the garment for fidelity.",
    },
    {
      value: "description",
      label: "Text description",
      description: "Send only the person description when you want more variation.",
    },
  ], []);
  const flowOptions = useMemo(() => [
    {
      value: "classic",
      label: "Instant",
      description: "One model call blends garment, person, and environment together.",
    },
    {
      value: "sequential",
      label: "Two-stage",
      description: "First dress the model, then place them into the environment.",
    },
    {
      value: "both",
      label: "Run both",
      description: "Fire both pathways; we keep whichever returns an image first.",
    },
  ], []);
  const environmentOptions = useMemo(() => [
    { value: "studio", label: "Studio", description: "Use your saved defaults or a clean neutral room." },
    { value: "street", label: "Street", description: "Outdoor mirror moment with natural light." },
    { value: "bed", label: "Bedroom", description: "Soft indoor vibe for loungewear." },
    { value: "beach", label: "Beach", description: "Sunlit boardwalk or sand backdrop." },
    { value: "indoor", label: "Indoor", description: "General interior scenes beyond the studio." },
  ], []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Create a listing</h1>
          <p className="text-sm text-foreground/70">Upload a garment photo, tweak the scene, and generate Vinted-ready imagery in seconds.</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="space-y-6">
          <UploadPanel
            fileInputRef={fileInputRef}
            cameraInputRef={cameraInputRef}
            previewUrl={previewUrl}
            selectedFile={selectedFile}
            isDragging={isDragging}
            isPreprocessing={isPreprocessing}
            plannedImagesCount={plannedImagesCount}
            title={title}
            onTitleChange={setTitle}
            onTriggerPick={handleTriggerPick}
            onTriggerCamera={handleTriggerCamera}
            onFileChange={handleFileChange}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClearSelection={clearSelection}
          />
          <DescriptionSettings
            enabled={descEnabled}
            onToggle={setDescEnabled}
            desc={desc}
            onDescFieldChange={(field, value) => setDesc((d) => ({ ...d, [field]: value }))}
            productCondition={productCondition}
            onConditionChange={setProductCondition}
          />
          <GarmentTypeSelector value={garmentType} onChange={setGarmentType} />
          <SceneModelOptions
            collapsed={optionsCollapsed}
            onToggleCollapsed={() => setOptionsCollapsed((v) => !v)}
            modelDefaultList={modelDefaultList}
            selectedGender={options.gender}
            onSelectGender={(gender) => setOptions((prev) => ({ ...prev, gender }))}
            modelDefaults={modelDefaults}
            isAdmin={isAdmin}
            useModelImage={useModelImage}
            onUseModelImageChange={setUseModelImage}
            modelReferenceOptions={modelReferenceOptions}
            flowOptions={flowOptions}
            flowMode={flowMode}
            onFlowModeChange={setFlowMode}
            envDefaults={envDefaults}
            envDefaultsLoading={envDefaultsLoading}
            selectedEnvDefaultKey={selectedEnvDefaultKey}
            onSelectEnvironmentDefault={handleSelectEnvironmentDefault}
            environmentOptions={environmentOptions}
            onEnvironmentChange={(value) => setOptions((o) => ({ ...o, environment: value }))}
            environmentValue={options.environment}
            plannedImagesCount={plannedImagesCount}
            poseMax={POSE_MAX}
            onPoseCountChange={handlePoseCountChange}
            extraInstructions={options.extra}
            onExtraChange={(value) => setOptions((o) => ({ ...o, extra: value }))}
          />
          {isAdmin && (
            <AdminReviewPanel
              gender={options.gender}
              environmentSummary={environmentSummary}
              poseSummary={poseSummary}
              modelSummary={modelSummary}
              flowMode={flowMode}
              garmentSummary={garmentSummary}
              prompt={promptInput}
              promptDirty={promptDirty}
              onPromptChange={(v) => {
                setPromptDirty(true);
                setPromptInput(v);
              }}
              onPromptReset={() => {
                setPromptDirty(false);
                setPromptInput(computeEffectivePrompt());
              }}
              poseStatusItems={poseStatusList}
            />
          )}
          <div className="pt-2">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!canGenerate}
              className={`inline-flex h-10 w-full items-center justify-center rounded-lg px-4 text-sm font-semibold ${
                canGenerate ? "bg-foreground text-background" : "bg-foreground/30 text-background/60"
              }`}
            >
              {isGenerating ? "Generating…" : "Generate listing"}
            </button>
          </div>
        </section>

        <aside className="space-y-3">
          {isAdmin && <AdminToolsCard busy={initDbBusy} onInitDb={handleInitDb} />}
        </aside>
      </div>

      {showWalkthrough && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-5">
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-background p-5">
            <h2 className="text-lg font-semibold">How VintedBoost works</h2>
            <ol className="mt-3 list-inside list-decimal space-y-2 text-sm text-foreground/80">
              <li>Upload a clear photo of your garment.</li>
              <li>Pick model, environment, and up to four poses.</li>
              <li>Review the prompt and generate mirror-selfie images.</li>
            </ol>
            <p className="mt-3 text-xs text-foreground/60">Defaults for model and environment live in Studio. Set them once and reuse here.</p>
            <div className="mt-4 flex items-center justify-between">
              <Link href="/studio" className="text-sm underline">Open Studio</Link>
              <button onClick={dismissWalkthrough} className="h-9 rounded-md bg-foreground px-3 text-sm font-semibold text-background">Got it</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
