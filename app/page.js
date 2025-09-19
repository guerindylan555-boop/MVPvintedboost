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
import { getSessionBasics } from "@/app/lib/session";
import {
  VB_ENV_DEFAULT_KEY,
  VB_FLOW_MODE,
  VB_MAIN_OPTIONS,
  VB_MODEL_REFERENCE_PREF,
  VB_WALKTHROUGH_SEEN,
} from "@/app/lib/storage-keys";
import { buildMirrorSelfiePreview } from "@/app/lib/prompt-preview";
import { preprocessImage } from "@/app/lib/image-preprocess";
import { broadcastListingsUpdated } from "@/app/lib/listings-events";
import { usePersistentState } from "@/app/lib/usePersistentState";

const authClient = createAuthClient();
const POSE_MAX = 10;

const FLOW_MODE_VALUES = new Set(["classic", "sequential", "both"]);

const WALKTHROUGH_TITLE_ID = "walkthrough-title";
const WALKTHROUGH_STEPS_ID = "walkthrough-steps";
const WALKTHROUGH_FOOTNOTE_ID = "walkthrough-footnote";

const defaultMainOptions = () => ({
  gender: "woman",
  environment: "studio",
  extra: "",
  poseCount: 3,
});

function deserializeMainOptions(value) {
  const base = defaultMainOptions();
  if (!value) return base;
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return base;
    }
  }
  if (!parsed || typeof parsed !== "object") return base;
  const next = { ...base, ...parsed };
  if (typeof next.gender !== "string" || !next.gender) next.gender = base.gender;
  if (typeof next.environment !== "string" || !next.environment) next.environment = base.environment;
  if (typeof parsed.extra === "string") next.extra = parsed.extra;
  else if (typeof next.extra !== "string") next.extra = base.extra;
  let savedCount;
  if (Number.isFinite(parsed.poseCount)) savedCount = Number(parsed.poseCount);
  else if (Array.isArray(parsed.poses)) savedCount = parsed.poses.length;
  else if (Number.isFinite(next.poseCount)) savedCount = Number(next.poseCount);
  if (!Number.isFinite(savedCount) || savedCount <= 0) savedCount = base.poseCount;
  next.poseCount = Math.min(Math.max(Math.round(savedCount), 1), POSE_MAX);
  return next;
}

function serializeMainOptions(value) {
  try {
    const normalized = deserializeMainOptions(value);
    return JSON.stringify(normalized);
  } catch {
    return JSON.stringify(defaultMainOptions());
  }
}

function deserializeEnvDefaultKey(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed === null || parsed === undefined) return null;
    if (typeof parsed === "string") return parsed;
  } catch {}
  return trimmed;
}

function serializeEnvDefaultKey(value) {
  if (value === undefined || value === null || value === "") return undefined;
  return value;
}

function deserializeModelReferencePref(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return true;
    if (trimmed === "image") return true;
    if (trimmed === "description") return false;
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    if (trimmed === "1") return true;
    if (trimmed === "0") return false;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed === "image") return true;
      if (parsed === "description") return false;
      if (typeof parsed === "boolean") return parsed;
    } catch {}
  }
  return true;
}

function serializeModelReferencePref(value) {
  return value ? "image" : "description";
}

function deserializeFlowMode(value) {
  if (!value) return "both";
  if (typeof value === "string" && FLOW_MODE_VALUES.has(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === "string" && FLOW_MODE_VALUES.has(parsed)) return parsed;
    } catch {}
  }
  return "both";
}

function serializeFlowMode(value) {
  return FLOW_MODE_VALUES.has(value) ? value : "both";
}

function deserializeWalkthroughSeen(value) {
  if (!value) return false;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "1") return true;
    if (trimmed === "0") return false;
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "boolean") return parsed;
      if (typeof parsed === "number") return parsed > 0;
    } catch {}
    return Boolean(trimmed);
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  return Boolean(value);
}

function serializeWalkthroughSeen(value) {
  return value ? "1" : "0";
}

export default function Home() {
  const { data: session } = authClient.useSession();
  const { userId, isAdmin } = getSessionBasics(session);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const walkthroughDialogRef = useRef(null);
  const walkthroughDismissButtonRef = useRef(null);
  const previouslyFocusedElementRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPreprocessing, setIsPreprocessing] = useState(false);
  const [walkthroughSeen, setWalkthroughSeen] = usePersistentState(
    VB_WALKTHROUGH_SEEN,
    () => false,
    {
      serialize: serializeWalkthroughSeen,
      deserialize: deserializeWalkthroughSeen,
    }
  );
  const showWalkthrough = !walkthroughSeen;
  // Pose choices for mirror selfie flow
  const [options, setOptions] = usePersistentState(
    VB_MAIN_OPTIONS,
    defaultMainOptions,
    {
      serialize: serializeMainOptions,
      deserialize: deserializeMainOptions,
    }
  );
  // Toggle to choose whether to send the model default image (true) or
  // only its stored textual description (false) with the prompt
  const [useModelImage, setUseModelImage] = usePersistentState(
    VB_MODEL_REFERENCE_PREF,
    () => true,
    {
      enabled: isAdmin,
      serialize: serializeModelReferencePref,
      deserialize: deserializeModelReferencePref,
    }
  );
  const [envDefaults, setEnvDefaults] = useState([]); // [{s3_key,name,url}]
  const [envDefaultsLoading, setEnvDefaultsLoading] = useState(true);
  const [selectedEnvDefaultKey, setSelectedEnvDefaultKey] = usePersistentState(
    VB_ENV_DEFAULT_KEY,
    () => null,
    {
      serialize: serializeEnvDefaultKey,
      deserialize: deserializeEnvDefaultKey,
    }
  );
  const [title, setTitle] = useState("");
  const [descEnabled, setDescEnabled] = useState(false);
  const [desc, setDesc] = useState({ brand: "", productModel: "", size: "" });
  const [productCondition, setProductCondition] = useState("");
  const [optionsCollapsed, setOptionsCollapsed] = useState(false);
  // Flow mode: classic | sequential | both
  const [flowMode, setFlowMode] = usePersistentState(
    VB_FLOW_MODE,
    () => "both",
    {
      enabled: isAdmin,
      serialize: serializeFlowMode,
      deserialize: deserializeFlowMode,
    }
  );
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
  }, [modelDefaultList, options.gender, setOptions]);

  // Keep selection in sync with available defaults
  useEffect(() => {
    if (!envDefaults || envDefaults.length === 0) return;
    const exists = selectedEnvDefaultKey && envDefaults.some((d) => d.s3_key === selectedEnvDefaultKey);
    if (!exists) {
      const first = envDefaults[0]?.s3_key || null;
      setSelectedEnvDefaultKey(first);
    }
  }, [envDefaults, selectedEnvDefaultKey, setSelectedEnvDefaultKey]);

  // If defaults exist, force environment to studio in options
  useEffect(() => {
    if (envDefaults && envDefaults.length > 0 && options.environment !== "studio") {
      setOptions((o) => ({ ...o, environment: "studio" }));
    }
  }, [envDefaults, options.environment, setOptions]);

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

  const dismissWalkthrough = useCallback(() => {
    setWalkthroughSeen(true);
  }, [setWalkthroughSeen]);

  useEffect(() => {
    if (showWalkthrough) {
      const activeElement = document.activeElement;
      previouslyFocusedElementRef.current =
        activeElement instanceof HTMLElement ? activeElement : null;

      const focusTarget =
        walkthroughDismissButtonRef.current || walkthroughDialogRef.current;
      const frame = requestAnimationFrame(() => {
        focusTarget?.focus?.({ preventScroll: true });
      });
      return () => {
        cancelAnimationFrame(frame);
      };
    }

    const toRestore = previouslyFocusedElementRef.current;
    previouslyFocusedElementRef.current = null;
    if (toRestore && typeof toRestore.focus === "function") {
      requestAnimationFrame(() => {
        toRestore.focus({ preventScroll: true });
      });
    }
    return undefined;
  }, [showWalkthrough]);

  const handleWalkthroughKeyDown = useCallback(
    (event) => {
      if (!showWalkthrough) return;

      if (event.key === "Escape") {
        event.preventDefault();
        dismissWalkthrough();
        return;
      }

      if (event.key !== "Tab") return;

      const dialogNode = walkthroughDialogRef.current;
      if (!dialogNode) return;

      const focusableSelectors = [
        "a[href]",
        "area[href]",
        "button:not([disabled])",
        "input:not([disabled])",
        "select:not([disabled])",
        "textarea:not([disabled])",
        "[tabindex]:not([tabindex='-1'])",
      ];
      const focusableElements = Array.from(
        dialogNode.querySelectorAll(focusableSelectors.join(","))
      ).filter(
        (element) =>
          element instanceof HTMLElement &&
          !element.hasAttribute("disabled") &&
          element.getAttribute("aria-hidden") !== "true" &&
          element.tabIndex >= 0
      );

      if (focusableElements.length === 0) {
        event.preventDefault();
        dialogNode.focus({ preventScroll: true });
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey) {
        if (
          activeElement === firstElement ||
          !dialogNode.contains(activeElement)
        ) {
          event.preventDefault();
          lastElement.focus({ preventScroll: true });
        }
        return;
      }

      if (activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus({ preventScroll: true });
      }
    },
    [dismissWalkthrough, showWalkthrough]
  );

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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-5"
          onClick={(event) => {
            if (event.target === event.currentTarget) dismissWalkthrough();
          }}
        >
          <div
            ref={walkthroughDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={WALKTHROUGH_TITLE_ID}
            aria-describedby={`${WALKTHROUGH_STEPS_ID} ${WALKTHROUGH_FOOTNOTE_ID}`}
            tabIndex={-1}
            className="w-full max-w-md rounded-2xl border border-white/15 bg-background p-5"
            onKeyDown={handleWalkthroughKeyDown}
          >
            <h2 id={WALKTHROUGH_TITLE_ID} className="text-lg font-semibold">
              How VintedBoost works
            </h2>
            <ol
              id={WALKTHROUGH_STEPS_ID}
              className="mt-3 list-inside list-decimal space-y-2 text-sm text-foreground/80"
            >
              <li>Upload a clear photo of your garment.</li>
              <li>Pick model, environment, and up to four poses.</li>
              <li>Review the prompt and generate mirror-selfie images.</li>
            </ol>
            <p
              id={WALKTHROUGH_FOOTNOTE_ID}
              className="mt-3 text-xs text-foreground/60"
            >
              Defaults for model and environment live in Studio. Set them once
              and reuse here.
            </p>
            <div className="mt-4 flex items-center justify-between">
              <Link href="/studio" className="text-sm underline">Open Studio</Link>
              <button
                ref={walkthroughDismissButtonRef}
                onClick={dismissWalkthrough}
                className="h-9 rounded-md bg-foreground px-3 text-sm font-semibold text-background"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
