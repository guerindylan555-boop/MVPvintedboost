"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import Link from "next/link";
import Image from "next/image";
import { createAuthClient } from "better-auth/react";
import { Camera, Loader2 } from "lucide-react";
import { InfoTooltip, OptionPicker, PromptPreviewCard } from "@/app/components";
import { getApiBase, withUserId } from "@/app/lib/api";
import { VB_FLOW_MODE, VB_MAIN_OPTIONS, VB_ENV_DEFAULT_KEY, VB_MODEL_REFERENCE_PREF } from "@/app/lib/storage-keys";
import { buildMirrorSelfiePreview } from "@/app/lib/prompt-preview";
import { preprocessImage } from "@/app/lib/image-preprocess";

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
  const [isGenerating, setIsGenerating] = useState(false);
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
  const [poseStatus, setPoseStatus] = useState({}); // { [pose]: 'pending'|'running'|'done'|'error' }
  const [poseErrors, setPoseErrors] = useState({}); // { [pose]: string }
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


  function togglePose(pose) {
    setOptions((o) => {
      const has = o.poses.includes(pose);
      if (has) {
        return { ...o, poses: o.poses.filter((p) => p !== pose) };
      }
      // limit to 4
      if (o.poses.length >= 4) return o;
      return { ...o, poses: [...o.poses, pose] };
    });
  }

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

  async function handleUseSample() {
    // Tiny 1x1 PNG so backend accepts it
    const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";
    const byteChars = atob(b64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    const blob = new Blob([bytes], { type: "image/png" });
    const file = new File([blob], "sample.png", { type: "image/png" });
    await setImageFile(file);
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

  function adjustPoseCount(delta) {
    handlePoseCountChange((options.poseCount || 1) + delta);
  }

  async function handleGenerate() {
    if (!selectedFile) return;
    try {
      setIsGenerating(true);
      const baseUrl = getApiBase();

      // Ensure at least one pose slot
      const imageCount = plannedImagesCount;
      const poseSlots = Array.from({ length: imageCount }, (_, idx) => ({ key: `slot-${idx + 1}`, index: idx }));

      // Resolve environment default for main request
      const envDefaultKey = options.environment === "studio" && (selectedEnvDefaultKey || envDefaults[0]?.s3_key)
        ? (selectedEnvDefaultKey || envDefaults[0]?.s3_key)
        : undefined;

      // 1) Create listing first
      const lform = new FormData();
      lform.append("image", selectedFile);
      lform.append("gender", options.gender);
      lform.append("environment", options.environment);
      for (const slot of poseSlots) {
        const { description } = resolvePoseInstruction(slot.index);
        const snapshot = description || "random pose";
        lform.append("poses", snapshot);
      }
      lform.append("extra", options.extra || "");
      if (envDefaultKey) lform.append("env_default_s3_key", envDefaultKey);
      const personDefault = options.gender === "woman" ? modelDefaults?.woman : modelDefaults?.man;
      const personDefaultKey = personDefault?.s3_key;
      const personDesc = personDefault?.description;
      if (useModelImage && personDefaultKey) lform.append("model_default_s3_key", personDefaultKey);
      if (!useModelImage && personDesc) lform.append("model_description_text", personDesc);
      lform.append("use_model_image", String(!!useModelImage));
      if (promptDirty) lform.append("prompt_override", promptInput.trim());
      if (garmentType) lform.append("garment_type_override", garmentType);
      if (title) lform.append("title", title);
      const toastId = toast.loading("Creating listing…");
      const lres = await fetch(`${baseUrl}/listing`, { method: "POST", body: lform, headers: withUserId({}, userId) });
      if (!lres.ok) throw new Error(await lres.text());
      const listing = await lres.json();
      const listingId = listing?.id;
      if (!listingId) throw new Error("No listing id");

      // 2) Generate per pose according to flowMode (classic | sequential | both)
      let done = 0; // count poses done (first variant finished)
      toast.loading(`Generating images ${done}/${poseSlots.length}…`, { id: toastId });
      const initialStatus = {};
      for (const slot of poseSlots) initialStatus[slot.key] = "running";
      setPoseStatus(initialStatus); setPoseErrors({});

      // concurrency limiter
      const limit = (n, fns) => new Promise((resolve) => {
        const out = new Array(fns.length);
        let i = 0, running = 0, finished = 0;
        const next = () => {
          if (finished >= fns.length) return resolve(out);
          while (running < n && i < fns.length) {
            const idx = i++; running++;
            fns[idx]().then((v) => out[idx] = { status: 'fulfilled', value: v }).catch((e) => out[idx] = { status: 'rejected', reason: e }).finally(() => { running--; finished++; next(); });
          }
        };
        next();
      });

      const buildCommonForm = (slotIndex) => {
        const form = new FormData();
        form.append("image", selectedFile);
        form.append("gender", options.gender);
        form.append("environment", options.environment);
        form.append("poses", "standing");
        form.append("extra", options.extra || "");
        if (envDefaultKey) form.append("env_default_s3_key", envDefaultKey);
        if (useModelImage && personDefaultKey) form.append("model_default_s3_key", personDefaultKey);
        else if (!useModelImage && personDesc) form.append("model_description_text", personDesc);
        form.append("listing_id", listingId);
        if (garmentType) form.append("garment_type_override", garmentType);
        return form;
      };
      const cloneForm = (fd) => { const f = new FormData(); fd.forEach((v, k) => f.append(k, v)); return f; };
      const buildPrompt = (slotIndex) => {
        if (promptDirty) {
          let effective = promptInput.trim();
          const { description } = resolvePoseInstruction(slotIndex);
          if (description) effective += `\nPose description: ${description}`;
          return effective;
        }
        return computeEffectivePrompt(slotIndex, false);
      };
      const runPose = ({ key, index: slotIndex }) => async () => {
        const common = buildCommonForm(slotIndex);
        const prompt = buildPrompt(slotIndex);
        const classicReq = async () => {
          const f = cloneForm(common);
          f.append("prompt_override", prompt);
          const res = await fetch(`${baseUrl}/edit/json`, { method: "POST", body: f, headers: withUserId({}, userId) });
          if (!res.ok) throw new Error(await res.text());
          return res.json();
        };
        const seqReq = async () => {
          const f = cloneForm(common);
          const res = await fetch(`${baseUrl}/edit/sequential/json`, { method: "POST", body: f, headers: withUserId({}, userId) });
          if (!res.ok) throw new Error(await res.text());
          return res.json();
        };
        let classicP = null, seqP = null;
        if (flowMode === 'classic') classicP = classicReq();
        else if (flowMode === 'sequential') seqP = seqReq();
        else { classicP = classicReq(); seqP = seqReq(); }
        let firstDone = false;
        const markDone = () => {
          if (!firstDone) {
            firstDone = true;
            done += 1;
            toast.loading(`Generating images ${done}/${poseSlots.length}…`, { id: toastId });
            setPoseStatus((s) => ({ ...s, [key]: 'done' }));
          }
        };
        if (classicP) classicP.then(() => markDone()).catch(() => {});
        if (seqP) seqP.then(() => markDone()).catch(() => {});
        const results = await Promise.all([classicP, seqP].filter(Boolean).map((p) => p.then((v) => ({ ok: true, v })).catch((e) => ({ ok: false, e }))));
        const ok = results.find((r) => r.ok);
        if (ok) { return ok.v; }
        setPoseStatus((s) => ({ ...s, [key]: 'error' }));
        setPoseErrors((e) => ({ ...e, [key]: results.map((r) => r.e?.message || 'Failed').join('; ') }));
        throw new Error(`Pose ${slotIndex + 1} failed`);
      };
      const tasks = poseSlots.map((slot) => runPose(slot));
      const settled = await limit(2, tasks);
      const okAny = settled.some((r) => r && r.status === 'fulfilled');
      if (!okAny) throw new Error("All generations failed");

      // 3) Optionally generate description attached to listing
      if (descEnabled) {
        try {
          const dform = new FormData();
          dform.append("image", selectedFile);
          dform.append("gender", options.gender);
          if (desc.brand) dform.append("brand", desc.brand);
          if (desc.productModel) dform.append("model_name", desc.productModel);
          if (desc.size) dform.append("size", desc.size);
          if (productCondition) dform.append("condition", productCondition);
          dform.append("listing_id", listingId);
          toast.loading("Generating description…", { id: toastId });
          await fetch(`${baseUrl}/describe`, { method: "POST", body: dform, headers: withUserId({}, userId) });
        } catch {}
      }
      toast.success("Listing ready!", { id: toastId });

      // 4) Navigate to the listing detail page
      window.location.href = `/listing/${listingId}`;
    } catch (err) {
      console.error(err);
      toast.error("Generation failed. Check backend/API key.");
    } finally {
      setIsGenerating(false);
    }
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
          <div className="rounded-2xl border border-black/10 bg-black/5 p-4 dark:border-white/15 dark:bg-white/5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Upload garment</h2>
                <p className="text-xs text-foreground/60">Drop a clear photo of the item you want the model to wear.</p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <button type="button" onClick={handleUseSample} className="underline underline-offset-4">Use sample</button>
                <button type="button" onClick={handleTriggerCamera} className="underline underline-offset-4">Take photo</button>
              </div>
            </div>
            <div className="mt-4">
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
              <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />
              {!previewUrl ? (
                <button
                  type="button"
                  onClick={handleTriggerPick}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  className={`flex aspect-[4/5] w-full items-center justify-center rounded-xl border border-dashed px-4 text-center transition-colors ${
                    isDragging ? "border-blue-500 bg-blue-500/10" : "border-foreground/20 hover:border-foreground/40"
                  }`}
                >
                  <div className="flex flex-col items-center gap-2 text-foreground/70">
                    <div className="size-14 rounded-full border border-dashed border-current/30 flex items-center justify-center">
                      <Camera className="size-6" />
                    </div>
                    <div className="text-sm"><span className="font-medium text-foreground">Tap to upload</span> or drop an image</div>
                    <div className="text-xs">PNG, JPG, HEIC up to ~10MB</div>
                    {isPreprocessing && <div className="mt-1 text-xs">Optimizing photo…</div>}
                  </div>
                </button>
              ) : (
                <div className="w-full overflow-hidden rounded-xl border border-foreground/15 bg-background/40">
                  <div className="relative w-full aspect-[4/5]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={previewUrl} alt="Selected garment" className="h-full w-full object-cover" />
                    {isPreprocessing && (
                      <div className="absolute bottom-2 right-2 rounded-md border border-black/10 bg-background/80 px-2 py-1 text-[11px] dark:border-white/15">
                        Optimizing…
                      </div>
                    )}
                    <div className="absolute top-2 right-2 rounded-md border border-black/10 bg-background/80 px-2 py-1 text-[11px] dark:border-white/15">
                      {plannedImagesCount} image{plannedImagesCount > 1 ? "s" : ""}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-foreground/10 p-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{selectedFile?.name || "Selected image"}</p>
                      <p className="text-xs text-foreground/60">{selectedFile?.size ? `${Math.round(selectedFile.size / 1024)} KB` : ""}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={handleTriggerPick} className="h-9 rounded-lg bg-foreground px-3 text-sm font-medium text-background">Change</button>
                      <button type="button" onClick={clearSelection} className="h-9 rounded-lg border border-foreground/20 px-3 text-sm font-medium">Remove</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="mt-4">
              <label className="text-xs text-foreground/70">Listing title</label>
              <input
                type="text"
                placeholder="Give this generation a name"
                className="mt-2 h-10 w-full rounded-lg border border-foreground/15 bg-background/40 px-3 text-sm"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="mt-4 space-y-3 rounded-xl border border-foreground/15 bg-background/40 p-4">
              <div className="flex items-center justify-between text-xs text-foreground/70">
                <span>Generate product description</span>
                <button
                  type="button"
                  onClick={() => setDescEnabled((v) => !v)}
                  className={`relative inline-flex h-6 w-12 items-center rounded-full transition ${
                    descEnabled ? "bg-foreground" : "bg-foreground/30"
                  }`}
                  aria-pressed={descEnabled}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-background transition ${
                      descEnabled ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
              {descEnabled && (
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <input
                    type="text"
                    className="col-span-2 h-9 rounded-lg border border-foreground/15 bg-background/40 px-3"
                    placeholder="Brand (e.g., Nike, Zara)"
                    value={desc.brand}
                    onChange={(e) => setDesc((d) => ({ ...d, brand: e.target.value }))}
                  />
                  <input
                    type="text"
                    className="col-span-2 h-9 rounded-lg border border-foreground/15 bg-background/40 px-3"
                    placeholder="Model (e.g., Air Max 90)"
                    value={desc.productModel}
                    onChange={(e) => setDesc((d) => ({ ...d, productModel: e.target.value }))}
                  />
                  <div className="col-span-2 flex flex-wrap gap-2">
                    {["Brand new", "Very good", "Good"].map((condition) => (
                      <button
                        key={condition}
                        type="button"
                        onClick={() => setProductCondition(condition)}
                        className={`h-8 rounded-full border px-3 text-xs ${
                          productCondition === condition ? "border-foreground" : "border-foreground/20"
                        }`}
                      >
                        {condition}
                      </button>
                    ))}
                  </div>
                  <div className="col-span-2 flex flex-wrap gap-2">
                    {["xs", "s", "m", "l", "xl"].map((size) => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => setDesc((d) => ({ ...d, size }))}
                        className={`h-8 rounded-full border px-3 text-xs uppercase ${
                          desc.size === size ? "border-foreground" : "border-foreground/20"
                        }`}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="mt-4">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-foreground/80">
                Garment type
                <InfoTooltip label="Garment type" description="Set to Top/Bottom/Full if you know it. Leave empty to auto-detect once and cache on the listing." />
              </label>
              <div className="mt-2 grid grid-cols-3 overflow-hidden rounded-lg border border-foreground/15">
                {["top", "bottom", "full"].map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setGarmentType((prev) => (prev === t ? null : t))}
                    className={`h-10 text-xs font-medium uppercase tracking-wide transition ${
                      garmentType === t ? "bg-foreground text-background" : "text-foreground/70"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {!garmentType && <p className="mt-1 text-[11px] text-foreground/50">Auto-detect if not set.</p>}
            </div>
            <div className="mt-4">
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
          </div>

          <div className="rounded-2xl border border-black/10 bg-black/5 dark:border-white/15 dark:bg-white/5">
            <button
              type="button"
              onClick={() => setOptionsCollapsed((v) => !v)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold"
            >
              <span>Scene & model options</span>
              <span className="text-xs text-foreground/60">{optionsCollapsed ? "Show" : "Hide"}</span>
            </button>
            {!optionsCollapsed && (
              <div className="border-t border-foreground/10 px-4 py-5">
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">Model defaults</p>
                        <p className="mt-1 text-xs text-foreground/60">Pick a Studio default image to set the person and gender.</p>
                      </div>
                      <Link href="/studio" className="text-xs text-foreground/60 underline">
                        Manage
                      </Link>
                    </div>
                    {modelDefaultList.length > 0 ? (
                      <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
                        {modelDefaultList.map((model) => {
                          const selected = options.gender === model.gender;
                          const genderLabel = model.gender === "woman" ? "Woman" : "Man";
                          return (
                            <button
                              key={model.gender}
                              type="button"
                              onClick={() => setOptions((prev) => ({ ...prev, gender: model.gender }))}
                              className={`w-32 flex-shrink-0 overflow-hidden rounded-xl border text-left transition ${
                                selected ? "border-foreground bg-foreground/5" : "border-foreground/15 hover:border-foreground/40"
                              }`}
                            >
                              <div className="relative aspect-[3/4] w-full">
                                {model.url ? (
                                  <Image
                                    src={model.url}
                                    alt={`${genderLabel} default`}
                                    fill
                                    sizes="128px"
                                    className="object-cover"
                                    unoptimized
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center bg-foreground/10 text-[11px] uppercase tracking-wide text-foreground/50">
                                    No photo
                                  </div>
                                )}
                                {selected && (
                                  <span className="absolute right-2 top-2 rounded-full bg-background/90 px-2 py-1 text-[11px] font-semibold text-foreground shadow">
                                    Selected
                                  </span>
                                )}
                              </div>
                              <div className="px-3 py-2">
                                <p className="text-sm font-semibold capitalize">{model.name || genderLabel}</p>
                                <p className="text-[11px] text-foreground/60">{genderLabel} fit</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="mt-3 rounded-lg border border-foreground/15 bg-background/40 p-3 text-xs text-foreground/60">
                        No Studio defaults yet. <Link href="/studio" className="underline">Add one</Link> to unlock a quicker flow.
                      </div>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="sm:col-span-2">
                      <OptionPicker
                        label="Model reference"
                        description="Use your default model photo from Studio, or send its description only."
                        options={modelReferenceOptions}
                        value={useModelImage ? "image" : "description"}
                        onChange={(v) => setUseModelImage(v === "image")}
                      />
                      {!useModelImage && !((options.gender === "woman" ? modelDefaults?.woman?.description : modelDefaults?.man?.description)) && (
                        <p className="mt-1 text-[11px] text-amber-500">No default description stored yet. Add one from Studio.</p>
                      )}
                    </div>
                  )}
                  {isAdmin && (
                    <div className="sm:col-span-2">
                      <OptionPicker
                        label="Generation flow"
                        options={flowOptions}
                        value={flowMode}
                        onChange={setFlowMode}
                      />
                    </div>
                  )}
                  <div className="sm:col-span-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">Environment defaults</p>
                        <p className="mt-1 text-xs text-foreground/60">Pick from your saved backgrounds. Add more in Studio to build a library.</p>
                      </div>
                      <Link href="/studio" className="text-xs text-foreground/60 underline">
                        Manage
                      </Link>
                    </div>
                    {envDefaultsLoading ? (
                      <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
                        {Array.from({ length: 4 }).map((_, i) => (
                          <div key={i} className="h-32 w-32 flex-shrink-0 animate-pulse rounded-xl bg-foreground/10" />
                        ))}
                      </div>
                    ) : envDefaults.length > 0 ? (
                      <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
                        {envDefaults.map((env) => {
                          const selected = selectedEnvDefaultKey === env.s3_key;
                          return (
                            <button
                              key={env.s3_key}
                              type="button"
                              onClick={() => handleSelectEnvironmentDefault(env.s3_key)}
                              className={`w-32 flex-shrink-0 overflow-hidden rounded-xl border text-left transition ${
                                selected ? "border-foreground bg-foreground/5" : "border-foreground/15 hover:border-foreground/40"
                              }`}
                            >
                              <div className="relative aspect-[3/4] w-full">
                                {env.url ? (
                                  <Image
                                    src={env.url}
                                    alt={env.name || "Environment"}
                                    fill
                                    sizes="128px"
                                    className="object-cover"
                                    unoptimized
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center bg-foreground/10 text-[11px] uppercase tracking-wide text-foreground/50">
                                    No photo
                                  </div>
                                )}
                                {selected && (
                                  <span className="absolute right-2 top-2 rounded-full bg-background/90 px-2 py-1 text-[11px] font-semibold text-foreground shadow">
                                    Selected
                                  </span>
                                )}
                              </div>
                              <div className="px-3 py-2">
                                <p className="text-sm font-semibold">{env.name || "Untitled"}</p>
                                <p className="text-[11px] text-foreground/60">{selected ? "In use" : "Tap to select"}</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="mt-3 space-y-3">
                        <OptionPicker
                          options={environmentOptions}
                          value={options.environment}
                          onChange={(v) => setOptions((o) => ({ ...o, environment: v }))}
                        />
                        <p className="text-[11px] text-foreground/50">Save environment photos in Studio to see them here.</p>
                      </div>
                    )}
                  </div>
                  <div className="sm:col-span-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">Images & poses</p>
                        <p className="mt-1 text-xs text-foreground/60">Choose up to 10 outputs. Leave blanks to auto-pick pose ideas.</p>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-foreground/70">
                        <button
                          type="button"
                          onClick={() => adjustPoseCount(-1)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-foreground/30"
                          aria-label="Decrease images"
                        >
                          -
                        </button>
                        <span className="min-w-[2ch] text-center font-semibold">{plannedImagesCount}</span>
                        <button
                          type="button"
                          onClick={() => adjustPoseCount(1)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-foreground/30"
                          aria-label="Increase images"
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={POSE_MAX}
                      value={plannedImagesCount}
                      onChange={(e) => handlePoseCountChange(e.target.value)}
                      className="mt-3 w-full"
                    />
                    <p className="mt-4 text-[11px] text-foreground/60">We’ll pick varied poses automatically for each image.</p>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs text-foreground/70">Extra instructions</label>
                    <textarea
                      rows={3}
                      className="mt-2 w-full rounded-lg border border-foreground/15 bg-background/40 px-3 py-2 text-sm"
                      placeholder="Optional: add a style tweak, colours, or vibe"
                      value={options.extra}
                      onChange={(e) => setOptions((o) => ({ ...o, extra: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {isAdmin && (
            <div className="space-y-4 rounded-2xl border border-black/10 bg-black/5 p-4 dark:border-white/15 dark:bg-white/5 sm:p-6">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full border border-foreground/15 px-3 py-1">{options.gender}</span>
                <span className="rounded-full border border-foreground/15 px-3 py-1">Env: {environmentSummary}</span>
                <span className="rounded-full border border-foreground/15 px-3 py-1">Poses: {poseSummary || "–"}</span>
                <span className="rounded-full border border-foreground/15 px-3 py-1">Model: {modelSummary}</span>
                <span className="rounded-full border border-foreground/15 px-3 py-1">Flow: {flowMode}</span>
                <span className="rounded-full border border-foreground/15 px-3 py-1">Type: {garmentSummary}</span>
              </div>
              <PromptPreviewCard
                prompt={promptInput}
                dirty={promptDirty}
                onChange={(v) => {
                  setPromptDirty(true);
                  setPromptInput(v);
                }}
                onReset={() => {
                  setPromptDirty(false);
                  setPromptInput(computeEffectivePrompt());
                }}
              />
              {poseStatusList.length > 0 && (
                <div className="rounded-xl border border-foreground/10 bg-background/40 p-4">
                  <h3 className="text-sm font-semibold">Generation status</h3>
                  <ul className="mt-2 space-y-2 text-xs">
                    {poseStatusList.map(({ key, label, status, error }) => (
                      <li key={key} className="flex items-start justify-between gap-3">
                        <span className="font-medium">{label}</span>
                        <span className={status === "error" ? "text-red-500" : status === "done" ? "text-green-400" : "text-foreground/60"}>
                          {status === "running" ? "Generating…" : status === "done" ? "Ready" : status === "error" ? error || "Failed" : "Queued"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>

        <aside className="space-y-3">
          <div className="rounded-2xl border border-black/10 bg-black/5 p-4 text-sm dark:border-white/15 dark:bg-white/5">
            <h2 className="text-sm font-semibold">Manage listings</h2>
            <p className="mt-2 text-xs text-foreground/60">Review every generation, regenerate poses, and copy descriptions from the dedicated listings hub.</p>
            <Link
              href="/listings"
              className="mt-3 inline-flex h-9 items-center justify-center rounded-lg border border-foreground/20 px-3 text-sm font-semibold hover:border-foreground"
            >
              Open listings
            </Link>
          </div>
          {isAdmin && (
            <div className="rounded-2xl border border-black/10 bg-black/5 p-4 text-sm dark:border-white/15 dark:bg-white/5">
              <h2 className="text-sm font-semibold">Admin tools</h2>
              <button
                type="button"
                onClick={handleInitDb}
                disabled={initDbBusy}
                className={`mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${
                  initDbBusy ? "opacity-60" : ""
                }`}
              >
                {initDbBusy ? (
                  <>
                    <Loader2 className="size-3 animate-spin" />
                    Initializing…
                  </>
                ) : (
                  <>Init DB</>
                )}
              </button>
            </div>
          )}
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
