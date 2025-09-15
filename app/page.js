"use client";

import { useEffect, useRef, useState } from "react";
import { Drawer } from "vaul";
import { Toaster, toast } from "react-hot-toast";
import Link from "next/link";
import Image from "next/image";
import { createAuthClient } from "better-auth/react";
import { Camera, Check, X, Loader2 } from "lucide-react";
import { getApiBase, withUserId } from "@/app/lib/api";
import { VB_FLOW_MODE, VB_MAIN_OPTIONS, VB_ENV_DEFAULT_KEY } from "@/app/lib/storage-keys";
import { buildMirrorSelfiePreview } from "@/app/lib/prompt-preview";
const authClient = createAuthClient();

export default function Home() {
  const { data: session } = authClient.useSession();
  const isAdmin = Boolean(session?.user?.isAdmin);
  const userId = session?.session?.userId || session?.user?.id || session?.user?.email || null;
  const fileInputRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Pose choices for mirror selfie flow
  const allowedPoses = ["Face", "three-quarter pose", "from the side", "random"];
  const [options, setOptions] = useState({
    gender: "woman",
    environment: "studio",
    poses: ["random"],
    extra: "",
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
  const [showAdvancedPrompt, setShowAdvancedPrompt] = useState(false);
  const [poseStatus, setPoseStatus] = useState({}); // { [pose]: 'pending'|'running'|'done'|'error' }
  const [poseErrors, setPoseErrors] = useState({}); // { [pose]: string }
  const [lastListingId, setLastListingId] = useState(null);
  const [listings, setListings] = useState([]); // [{id, cover_url, created_at, images_count, settings}]
  const [listingsLoading, setListingsLoading] = useState(true);
  // Flow mode: classic | sequential | both
  const [flowMode, setFlowMode] = useState("classic");
  // Prompt preview/editor
  const [promptInput, setPromptInput] = useState("");
  const [promptDirty, setPromptDirty] = useState(false);
  // Pose descriptions fetched from Studio (for random)
  const [poseDescs, setPoseDescs] = useState([]); // [{s3_key, description, created_at}]
  const [randomPosePick, setRandomPosePick] = useState(null); // one chosen description at load
  // Garment type override: null (auto), or 'top'|'bottom'|'full'
  const [garmentType, setGarmentType] = useState(null);
  const plannedImagesCount = Array.isArray(options.poses) && options.poses.length > 0 ? options.poses.length : 1;

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    (async () => {
      if (!userId) return;
      setListingsLoading(true);
      const baseUrl = getApiBase();
      try {
        const res = await fetch(`${baseUrl}/listings`, { headers: withUserId({}, userId) });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data?.items)) setListings(data.items);
        }
      } catch {}
      setListingsLoading(false);
    })();
  }, [userId]);

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
    try {
      const saved = localStorage.getItem(VB_FLOW_MODE);
      if (saved === "classic" || saved === "sequential" || saved === "both") setFlowMode(saved);
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem(VB_FLOW_MODE, flowMode); } catch {}
  }, [flowMode]);

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
          setOptions((o) => ({
            gender: saved.gender || o.gender,
            environment: saved.environment || o.environment,
            poses: Array.isArray(saved.poses) && saved.poses.length > 0 ? saved.poses : o.poses,
            extra: typeof saved.extra === "string" ? saved.extra : o.extra,
          }));
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
  }, [envDefaults]);

  // If defaults exist, force environment to studio in options
  useEffect(() => {
    if (envDefaults && envDefaults.length > 0 && options.environment !== "studio") {
      setOptions((o) => ({ ...o, environment: "studio" }));
    }
  }, [envDefaults, options.environment]);

  function refreshListingsSoon(delay = 800) {
    // Simple refetch helper to reflect new cover/images soon after generation
    setTimeout(async () => {
      if (!userId) return;
      const baseUrl = getApiBase();
      try {
        const res = await fetch(`${baseUrl}/listings`, { headers: withUserId({}, userId) });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data?.items)) setListings(data.items);
        }
      } catch {}
    }, delay);
  }

  function computeEffectivePrompt(poseOverride, forPreview = true) {
    const envDefaultKey = options.environment === "studio" && (selectedEnvDefaultKey || envDefaults[0]?.s3_key)
      ? (selectedEnvDefaultKey || envDefaults[0]?.s3_key)
      : undefined;
    const personDefault = options.gender === "woman" ? modelDefaults?.woman : modelDefaults?.man;
    const personDefaultKey = personDefault?.s3_key;
    const personDesc = personDefault?.description;
    const usingPersonImage = !!(useModelImage && personDefaultKey);
    const selectedPose = poseOverride != null ? poseOverride : (Array.isArray(options.poses) && options.poses.length > 0 ? options.poses[0] : "");
    const rndDesc = (selectedPose === "random") ? (forPreview ? (randomPosePick?.description || "") : (randomPosePick?.description || "")) : "";
    return buildMirrorSelfiePreview({
      gender: options.gender,
      environment: options.environment,
      pose: selectedPose,
      extra: options.extra || "",
      usingPersonImage,
      personDesc: useModelImage ? "" : (personDesc || ""),
      envDefaultKey,
      randomPoseDescription: rndDesc,
      forPreview,
    });
  }

  // Keep prompt preview in sync unless user edited it
  useEffect(() => {
    if (!promptDirty) {
      const firstPose = Array.isArray(options.poses) && options.poses.length > 0 ? options.poses[0] : "";
      setPromptInput(computeEffectivePrompt(firstPose, true));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    options.gender,
    options.environment,
    JSON.stringify(options.poses),
    options.extra,
    selectedEnvDefaultKey,
    JSON.stringify(envDefaults),
    JSON.stringify(modelDefaults),
    useModelImage,
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

  function setImageFile(file) {
    if (!file) return;
    if (!file.type?.startsWith("image/")) {
      alert("Please select an image file.");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setSelectedFile(file);
    setPreviewUrl(objectUrl);
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    setImageFile(file);
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    setImageFile(file);
  }

  function handleDragOver(e) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleTriggerPick() {
    fileInputRef.current?.click();
  }

  function handleUseSample() {
    // Tiny 1x1 PNG so backend accepts it
    const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";
    const byteChars = atob(b64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    const blob = new Blob([bytes], { type: "image/png" });
    const file = new File([blob], "sample.png", { type: "image/png" });
    setImageFile(file);
  }

  async function handleGenerate() {
    if (!selectedFile) return;
    try {
      setIsGenerating(true);
      const baseUrl = getApiBase();

      // Ensure at least one pose
      const poses = Array.isArray(options.poses) && options.poses.length > 0 ? options.poses : ["standing"];

      // Resolve environment default for main request
      const envDefaultKey = options.environment === "studio" && (selectedEnvDefaultKey || envDefaults[0]?.s3_key)
        ? (selectedEnvDefaultKey || envDefaults[0]?.s3_key)
        : undefined;

      // 1) Create listing first
      const lform = new FormData();
      lform.append("image", selectedFile);
      lform.append("gender", options.gender);
      lform.append("environment", options.environment);
      for (const p of poses) lform.append("poses", p);
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
      setLastListingId(listingId);

      // 2) Generate per pose according to flowMode (classic | sequential | both)
      let done = 0; // count poses done (first variant finished)
      toast.loading(`Generating images ${done}/${poses.length}…`, { id: toastId });
      const initialStatus = {}; for (const p of poses) initialStatus[p] = 'running';
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

      const buildCommonForm = (pose) => {
        const form = new FormData();
        form.append("image", selectedFile);
        form.append("gender", options.gender);
        form.append("environment", options.environment);
        form.append("poses", pose);
        form.append("extra", options.extra || "");
        if (envDefaultKey) form.append("env_default_s3_key", envDefaultKey);
        if (useModelImage && personDefaultKey) form.append("model_default_s3_key", personDefaultKey);
        else if (!useModelImage && personDesc) form.append("model_description_text", personDesc);
        form.append("listing_id", listingId);
        if (garmentType) form.append("garment_type_override", garmentType);
        return form;
      };
      const cloneForm = (fd) => { const f = new FormData(); fd.forEach((v, k) => f.append(k, v)); return f; };
      const buildPrompt = (pose) => {
        if (promptDirty) {
          let effective = promptInput.trim();
          if (pose === "random") {
            const items = Array.isArray(poseDescs) ? poseDescs : [];
            const pick = items.length > 0 ? items[Math.floor(Math.random() * items.length)] : null;
            if (pick?.description) effective += `\nPose description: ${pick.description}`;
          } else if (pose === "face trois quart") {
            effective += "\n- Orientation: three-quarter face; body slightly angled; shoulders subtly rotated.";
          } else if (pose === "from the side") {
            effective += "\n- Orientation: side/profile view; ensure torso and garment remain visible.";
          }
          return effective;
        }
        return computeEffectivePrompt(pose, false);
      };
      const runPose = (pose) => async () => {
        const common = buildCommonForm(pose);
        const prompt = buildPrompt(pose);
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
        const markDone = () => { if (!firstDone) { firstDone = true; done += 1; toast.loading(`Generating images ${done}/${poses.length}…`, { id: toastId }); setPoseStatus((s) => ({ ...s, [pose]: 'done' })); } };
        if (classicP) classicP.then(() => markDone()).catch(() => {});
        if (seqP) seqP.then(() => markDone()).catch(() => {});
        const results = await Promise.all([classicP, seqP].filter(Boolean).map((p) => p.then((v) => ({ ok: true, v })).catch((e) => ({ ok: false, e }))));
        const ok = results.find((r) => r.ok);
        if (ok) { return ok.v; }
        setPoseStatus((s) => ({ ...s, [pose]: 'error' }));
        setPoseErrors((e) => ({ ...e, [pose]: results.map((r) => r.e?.message || 'Failed').join('; ') }));
        throw new Error(`Pose ${pose} failed`);
      };
      const tasks = poses.map((p) => runPose(p));
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
      refreshListingsSoon();

      // 4) Navigate to the listing detail page
      window.location.href = `/listing/${listingId}`;
    } catch (err) {
      console.error(err);
      toast.error("Generation failed. Check backend/API key.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function retryPose(pose) {
    if (!selectedFile || !lastListingId) return;
    const baseUrl = getApiBase();
    try {
      setPoseStatus((s) => ({ ...s, [pose]: 'running' }));
      const envDefaultKey = options.environment === "studio" && (selectedEnvDefaultKey || envDefaults[0]?.s3_key)
        ? (selectedEnvDefaultKey || envDefaults[0]?.s3_key)
        : undefined;
      const form = new FormData();
      form.append("image", selectedFile);
      form.append("gender", options.gender);
      form.append("environment", options.environment);
      form.append("poses", pose);
      form.append("extra", options.extra || "");
      if (envDefaultKey) form.append("env_default_s3_key", envDefaultKey);
      const personDefault = options.gender === "woman" ? modelDefaults?.woman : modelDefaults?.man;
      const personDefaultKey = personDefault?.s3_key;
      const personDesc = personDefault?.description;
      if (useModelImage && personDefaultKey) form.append("model_default_s3_key", personDefaultKey);
      else if (!useModelImage && personDesc) form.append("model_description_text", personDesc);
      if (garmentType) form.append("garment_type_override", garmentType);
      let effective = "";
      if (promptDirty) { effective = promptInput.trim(); } else { effective = computeEffectivePrompt(pose, false); }
      form.append("listing_id", lastListingId);
      let url = `${baseUrl}/edit/json`;
      if (flowMode === 'sequential') url = `${baseUrl}/edit/sequential/json`;
      else form.append("prompt_override", effective);
      const res = await fetch(url, { method: "POST", body: form, headers: withUserId({}, userId) });
      if (!res.ok) throw new Error(await res.text());
      await res.json();
      setPoseStatus((s) => ({ ...s, [pose]: 'done' }));
      setPoseErrors((e) => ({ ...e, [pose]: undefined }));
    } catch (e) {
      setPoseStatus((s) => ({ ...s, [pose]: 'error' }));
      setPoseErrors((er) => ({ ...er, [pose]: e?.message || 'Failed' }));
    }
  }

  function clearSelection() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="font-sans min-h-screen bg-background text-foreground flex flex-col">
      <Toaster position="top-center" />
      <main className="flex-1 p-5 max-w-md w-full mx-auto flex flex-col gap-5">
        {/* Upload first */}
        <section>
          <input
            ref={fileInputRef}
            id="file"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />

          {!previewUrl ? (
            <button
              type="button"
              onClick={handleTriggerPick}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`w-full aspect-[4/5] rounded-2xl border text-center flex items-center justify-center px-4 transition-colors ${
                isDragging
                  ? "border-blue-500 bg-blue-500/10"
                  : "border-black/10 dark:border-white/15 bg-black/5 dark:bg-white/5"
              }`}
            >
              <div className="flex flex-col items-center gap-2">
                <div className="size-12 rounded-full border border-dashed border-current/30 flex items-center justify-center text-gray-500">
                  <Camera className="size-6" />
                </div>
                <div className="text-sm"><span className="font-medium">Tap to upload</span> or drop an image</div>
                <div className="text-xs text-gray-500">PNG, JPG, HEIC up to ~10MB</div>
                <div className="mt-2">
                  <button type="button" onClick={handleUseSample} className="text-xs underline underline-offset-4">Use sample image</button>
                </div>
              </div>
            </button>
          ) : (
            <div className="w-full rounded-2xl overflow-hidden border border-black/10 dark:border-white/15 bg-black/5 dark:bg-white/5">
              <div className="relative w-full aspect-[4/5] bg-black/5">
                {/* Using img for local blob preview to avoid domain config */}
                <img
                  src={previewUrl}
                  alt="Selected garment preview"
                  className="h-full w-full object-cover"
                />
                <div className="absolute top-2 right-2 text-[11px] px-2 py-1 rounded-md bg-background/80 border border-black/10 dark:border-white/15">
                  {plannedImagesCount} image{plannedImagesCount > 1 ? "s" : ""}
                </div>
              </div>
              <div className="p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm truncate">
                    {selectedFile?.name || "Selected image"}
                  </p>
                  <p className="text-xs text-gray-500">
                    {(selectedFile?.size ? Math.round(selectedFile.size / 1024) : 0)} KB
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={handleTriggerPick}
                    className="h-9 px-3 rounded-md bg-foreground text-background text-sm font-medium active:translate-y-px"
                  >
                    Change
                  </button>
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="h-9 px-3 rounded-md border border-black/10 dark:border-white/15 text-sm font-medium active:translate-y-px"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          )}
          <div className="mt-3">
            <label className="text-xs text-gray-500">Garment type</label>
            <div className="mt-1 grid grid-cols-3 h-10 rounded-md border border-black/10 dark:border-white/15 overflow-hidden">
              {['top','bottom','full'].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setGarmentType((prev) => prev === t ? null : t)}
                  className={`text-xs ${garmentType === t ? 'bg-foreground text-background' : 'text-foreground'}`}
                >
                  {t}
                </button>
              ))}
            </div>
            {!garmentType && (
              <p className="mt-1 text-[10px] text-gray-500">Auto-detect if not set.</p>
            )}
          </div>
        </section>

        {/* Quick actions */}
        <section className="flex items-center justify-between">
          <Drawer.Root open={sheetOpen} onOpenChange={setSheetOpen}>
            <Drawer.Trigger asChild>
              <button
                type="button"
                className="h-10 px-4 rounded-lg border border-black/10 dark:border-white/15 text-sm"
                aria-label="Edit options"
              >
                Edit options
              </button>
            </Drawer.Trigger>
            <Drawer.Portal>
              <Drawer.Overlay className="fixed inset-0 bg-black/40" />
              <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl border-t border-black/10 dark:border-white/15 bg-background">
                <div className="mx-auto max-w-md p-4">
                  <div className="h-1 w-8 bg-black/20 dark:bg-white/20 rounded-full mx-auto mb-3" />
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-sm font-medium">Options</h2>
                    <button type="button" className="text-xs text-gray-500" onClick={() => setSheetOpen(false)}>Done</button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-1">
                      <label className="text-xs text-gray-500">Gender</label>
                      <select
                        className="mt-1 w-full h-10 rounded-md border border-black/10 dark:border-white/15 bg-transparent px-3 text-sm"
                        value={options.gender}
                        onChange={(e) => setOptions((o) => ({ ...o, gender: e.target.value }))}
                      >
                        <option value="woman">Woman</option>
                        <option value="man">Man</option>
                      </select>
                    </div>
                    <div className="col-span-1">
                      <label className="text-xs text-gray-500">Model reference</label>
                      <div className="mt-1 grid grid-cols-2 h-10 rounded-md border border-black/10 dark:border-white/15 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setUseModelImage(true)}
                          className={`text-xs ${useModelImage ? 'bg-foreground text-background' : 'text-foreground'} `}
                        >
                          Image
                        </button>
                        <button
                          type="button"
                          onClick={() => setUseModelImage(false)}
                          className={`text-xs ${!useModelImage ? 'bg-foreground text-background' : 'text-foreground'} `}
                        >
                          Description
                        </button>
                      </div>
                      {!useModelImage && !((options.gender === "woman" ? modelDefaults?.woman?.description : modelDefaults?.man?.description)) && (
                        <p className="mt-1 text-[10px] text-amber-600">No default description; falls back to gender hint.</p>
                      )}
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs text-gray-500">Generation flow</label>
                      <div className="mt-1 grid grid-cols-3 h-10 rounded-md border border-black/10 dark:border-white/15 overflow-hidden">
                        {['classic','sequential','both'].map((m) => (
                          <button key={m} type="button" onClick={() => setFlowMode(m)} className={`text-xs ${flowMode === m ? 'bg-foreground text-background' : 'text-foreground'}`}>{m}</button>
                        ))}
                      </div>
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs text-gray-500">Garment type</label>
                      <div className="mt-1 grid grid-cols-3 h-10 rounded-md border border-black/10 dark:border-white/15 overflow-hidden">
                        {['top','bottom','full'].map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setGarmentType((prev) => prev === t ? null : t)}
                            className={`text-xs ${garmentType === t ? 'bg-foreground text-background' : 'text-foreground'}`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                      {!garmentType && (
                        <p className="mt-1 text-[10px] text-gray-500">Auto-detect if not set.</p>
                      )}
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs text-gray-500">Environment</label>
                      {envDefaultsLoading ? (
                        <div className="mt-2 flex gap-2 overflow-x-auto">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="w-20 h-24 rounded-md bg-black/10 dark:bg-white/10 animate-pulse" />
                          ))}
                        </div>
                      ) : envDefaults.length > 0 ? (
                        <div className="mt-2 flex gap-2 overflow-x-auto snap-x snap-mandatory">
                          {envDefaults.map((d) => (
                            <button
                              key={d.s3_key}
                              type="button"
                              onClick={() => {
                                setSelectedEnvDefaultKey(d.s3_key);
                                try { localStorage.setItem('vb_env_default_key', d.s3_key); } catch {}
                                if (options.environment !== 'studio') setOptions((o) => ({ ...o, environment: 'studio' }));
                              }}
                              className={`w-20 snap-start rounded-md border ${selectedEnvDefaultKey === d.s3_key ? 'border-foreground' : 'border-black/10 dark:border-white/15'}`}
                              title={d.name || 'Environment'}
                            >
                              <div className="w-full aspect-[3/4] overflow-hidden rounded-t-md">
                                {d.url ? (
                                  <img src={d.url} alt={d.name || 'Environment'} className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full bg-black/10 dark:bg-white/10" />
                                )}
                              </div>
                              <div className="px-1 py-1 text-[10px] truncate">{d.name || 'Untitled'}</div>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <select
                          className="mt-1 w-full h-10 rounded-md border border-black/10 dark:border-white/15 bg-transparent px-3 text-sm"
                          value={options.environment}
                          onChange={(e) => setOptions((o) => ({ ...o, environment: e.target.value }))}
                        >
                          <option value="studio">Studio</option>
                          <option value="street">Street</option>
                          <option value="bed">Bed</option>
                          <option value="beach">Beach</option>
                          <option value="indoor">Indoor</option>
                        </select>
                      )}
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs text-gray-500">Poses (up to 4) <span className="ml-2 text-[10px] text-gray-500">{Math.min(options.poses?.length || 0, 4)}/4</span></label>
                      <div className="mt-1 grid grid-cols-2 gap-2">
                        {allowedPoses.map((pose) => {
                          const selected = options.poses.includes(pose);
                          const limitReached = !selected && options.poses.length >= 4;
                          return (
                            <button
                              key={pose}
                              type="button"
                              onClick={() => togglePose(pose)}
                              disabled={limitReached}
                              className={`h-10 rounded-md border text-sm ${selected ? 'border-foreground' : 'border-black/10 dark:border-white/15'}`}
                              aria-pressed={selected}
                            >
                              {pose}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs text-gray-500">Extra instructions</label>
                      <input
                        type="text"
                        placeholder="e.g., natural daylight, smiling, medium shot"
                        className="mt-1 w-full h-10 rounded-md border border-black/10 dark:border-white/15 bg-transparent px-3 text-sm"
                        value={options.extra}
                        onChange={(e) => setOptions((o) => ({ ...o, extra: e.target.value }))}
                      />
                    </div>
                    {/* Description controls inside sheet */}
                    <div className="col-span-2">
                      <div className="flex items-center justify-between py-2">
                        <span className="text-xs text-gray-500">Generate product description</span>
                        <button
                          type="button"
                          onClick={() => setDescEnabled((v) => !v)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${descEnabled ? 'bg-foreground' : 'bg-black/20 dark:bg-white/20'}`}
                          aria-pressed={descEnabled}
                        >
                          <span className={`inline-block h-5 w-5 transform rounded-full bg-background transition-transform ${descEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                        </button>
                      </div>
                      {descEnabled && (
                        <div className="grid grid-cols-2 gap-2">
                          <div className="col-span-2">
                            <input
                              type="text"
                              className="w-full h-9 rounded-md border border-black/10 dark:border-white/15 bg-transparent px-3 text-sm"
                              placeholder="Brand (e.g., Nike, Zara)"
                              value={desc.brand}
                              onChange={(e) => setDesc((d) => ({ ...d, brand: e.target.value }))}
                            />
                          </div>
                          <div className="col-span-2">
                            <input
                              type="text"
                              className="w-full h-9 rounded-md border border-black/10 dark:border-white/15 bg-transparent px-3 text-sm"
                              placeholder="Model (e.g., Air Max 90)"
                              value={desc.productModel}
                              onChange={(e) => setDesc((d) => ({ ...d, productModel: e.target.value }))}
                            />
                          </div>
                          <div className="col-span-2 flex items-center gap-2">
                            {['Brand new','Very good','Good'].map((c) => (
                              <button key={c} type="button" onClick={() => setProductCondition(c)} className={`h-8 px-2 rounded-md border text-xs ${productCondition === c ? 'border-foreground' : 'border-black/10 dark:border-white/15'}`}>{c}</button>
                            ))}
                          </div>
                          <div className="col-span-2 flex items-center gap-2">
                            {['xs','s','m','l','xl'].map((s) => (
                              <button key={s} type="button" onClick={() => setDesc((d) => ({ ...d, size: s }))} className={`h-8 px-2 rounded-md border text-xs ${desc.size === s ? 'border-foreground' : 'border-black/10 dark:border-white/15'}`}>{s.toUpperCase()}</button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    {/* Advanced prompt (admin-only) */}
                    {isAdmin && (
                      <div className="col-span-2">
                        <div className="flex items-center justify-between py-2">
                          <button type="button" className="text-xs font-medium" onClick={() => setShowAdvancedPrompt((v) => !v)} aria-expanded={showAdvancedPrompt}>Advanced prompt</button>
                          {promptDirty && showAdvancedPrompt ? (
                            <button type="button" className="text-xs text-gray-500 hover:underline" onClick={() => { setPromptDirty(false); setPromptInput(computeEffectivePrompt()); }}>Reset to template</button>
                          ) : null}
                        </div>
                        {showAdvancedPrompt && (
                          <>
                            <textarea rows={4} className="w-full rounded-md border border-black/10 dark:border-white/15 bg-transparent px-3 py-2 text-sm" placeholder="Exact prompt that will be sent" value={promptInput} onChange={(e) => { setPromptInput(e.target.value); setPromptDirty(true); }} />
                            <p className="mt-1 text-[10px] text-gray-500">Changing options updates the suggestion unless you edit it.</p>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </Drawer.Content>
            </Drawer.Portal>
          </Drawer.Root>
        </section>

        {/* Title */}
        <section>
          <label className="text-xs text-gray-500">Title</label>
          <input
            type="text"
            placeholder="Give this generation a name"
            className="mt-1 w-full h-10 rounded-md border border-black/10 dark:border-white/15 bg-transparent px-3 text-sm"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </section>

        {/* Options moved to bottom sheet */}

        

        {/* Listings History (server-backed, auth only) */}
        <section className="mt-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Your Listings</h2>
          </div>
          {listingsLoading ? (
            <div className="mt-2 grid grid-cols-3 gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="aspect-square rounded-md bg-black/10 dark:bg-white/10 animate-pulse" />
              ))}
            </div>
          ) : (!listings || listings.length === 0) ? (
            <p className="text-xs text-gray-500 mt-2">No listings yet. Visit <a className="underline" href="/studio">Studio</a> to set defaults and then generate your first listing.</p>
          ) : (
            <div className="mt-2 grid grid-cols-3 gap-2">
              {listings.map((l) => {
                const when = new Date(l.created_at);
                const settings = l.settings || {};
                return (
                  <Link
                    key={l.id}
                    className="relative rounded-md overflow-hidden border border-black/10 dark:border-white/15 aspect-square"
                    href={`/listing/${l.id}`}
                    title={when.toLocaleString()}
                    prefetch
                  >
                    {l.cover_url ? (
                      <Image src={l.cover_url} alt="Listing cover" fill sizes="(max-width: 768px) 33vw, 200px" className="object-cover" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-xs text-gray-500">No image yet</div>
                    )}
                    <div className="absolute top-1 left-1 flex items-center gap-1">
                      {typeof l.images_count === 'number' && l.images_count > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-background/80 border border-black/10 dark:border-white/15">{l.images_count} images</span>
                      )}
                    </div>
                    <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between gap-1 px-1">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-background/80 border border-black/10 dark:border-white/15 truncate">{when.toLocaleDateString()}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-background/80 border border-black/10 dark:border-white/15 truncate">{settings.gender || ''} {settings.environment || ''}</span>
                      {settings.garment_type && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-background/80 border border-black/10 dark:border-white/15 truncate">{settings.garment_type}</span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
          <div className="mt-4">
            <a
              href="/studio"
              className="inline-flex items-center gap-2 text-sm font-medium underline underline-offset-4"
            >
              Open Studio (Environment & Model)
            </a>
          </div>
        </section>
      </main>

      <div className="sticky bottom-0 z-10 w-full bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-t border-black/10 dark:border-white/15 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-md mx-auto p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-xs overflow-x-auto">
            <span className="px-2 py-1 rounded-md border border-black/10 dark:border-white/15">{options.gender}</span>
            <span className="px-2 py-1 rounded-md border border-black/10 dark:border-white/15">Env: {envDefaults.length > 0 ? (selectedEnvDefaultKey ? 'Default' : 'Default (first)') : options.environment}</span>
            <span className="px-2 py-1 rounded-md border border-black/10 dark:border-white/15">Poses: {Array.isArray(options.poses) ? options.poses.length : 0}</span>
            <span className="px-2 py-1 rounded-md border border-black/10 dark:border-white/15">Model: {useModelImage ? 'Image' : 'Desc'}</span>
            <span className="px-2 py-1 rounded-md border border-black/10 dark:border-white/15">Flow: {flowMode}</span>
            <span className="px-2 py-1 rounded-md border border-black/10 dark:border-white/15">Type: {garmentType || 'auto'}</span>
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!selectedFile || isGenerating}
            className={`flex-1 h-12 rounded-xl text-base font-semibold active:translate-y-px transition-opacity ${
              !selectedFile || isGenerating
                ? "bg-foreground/30 text-background/60 cursor-not-allowed"
                : "bg-foreground text-background"
            }`}
          >
            {isGenerating ? (
              <span className="inline-flex items-center gap-2">
                <svg
                  className="size-5 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  ></path>
                </svg>
                Generating…
              </span>
            ) : (
              "Generate"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
