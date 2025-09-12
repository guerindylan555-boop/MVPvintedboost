"use client";

import { useEffect, useRef, useState } from "react";

export default function Home() {
  const fileInputRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(true);
  const allowedPoses = ["standing", "sitting", "lying down", "walking"];
  const [options, setOptions] = useState({
    gender: "woman",
    environment: "studio",
    poses: ["standing"],
    extra: "",
  });
  // Toggle to choose whether to send the model default image (true) or
  // only its stored textual description (false) with the prompt
  const [useModelImage, setUseModelImage] = useState(true);
  const [envDefaults, setEnvDefaults] = useState([]); // [{s3_key,name,url}]
  const [selectedEnvDefaultKey, setSelectedEnvDefaultKey] = useState(null);
  const [title, setTitle] = useState("");
  const [descEnabled, setDescEnabled] = useState(false);
  const [desc, setDesc] = useState({ brand: "", productModel: "", size: "" });
  const [history, setHistory] = useState([]); // [{id, dataUrl, createdAt, prompt, options}]
  // Prompt preview/editor
  const [promptInput, setPromptInput] = useState("");
  const [promptDirty, setPromptDirty] = useState(false);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("vb_history");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setHistory(parsed);
      }
    } catch {}
  }, []);

  // Load environment defaults to reflect in UI label
  useEffect(() => {
    (async () => {
      try {
        const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
        const res = await fetch(`${baseUrl}/env/defaults`);
        const data = await res.json();
        if (data?.items) setEnvDefaults(data.items);
      } catch {}
    })();
  }, []);

  // Load model defaults (one per gender)
  const [modelDefaults, setModelDefaults] = useState({}); // { man: {s3_key,name}, woman: {...} }
  useEffect(() => {
    (async () => {
      try {
        const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
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
      const saved = localStorage.getItem("vb_env_default_key");
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
        if (first) localStorage.setItem("vb_env_default_key", first);
      } catch {}
    }
  }, [envDefaults]);

  // If defaults exist, force environment to studio in options
  useEffect(() => {
    if (envDefaults && envDefaults.length > 0 && options.environment !== "studio") {
      setOptions((o) => ({ ...o, environment: "studio" }));
    }
  }, [envDefaults, options.environment]);

  function persistHistory(next) {
    setHistory(next);
    try {
      localStorage.setItem("vb_history", JSON.stringify(next));
    } catch {}
  }

  function computeEffectivePrompt() {
    // Mirror Selfie for Vinted template (frontend preview aligned with backend)
    const envDefaultKey = options.environment === "studio" && (selectedEnvDefaultKey || envDefaults[0]?.s3_key)
      ? (selectedEnvDefaultKey || envDefaults[0]?.s3_key)
      : undefined;
    const personDefault = options.gender === "woman" ? modelDefaults?.woman : modelDefaults?.man;
    const personDefaultKey = personDefault?.s3_key;
    const personDesc = personDefault?.description;
    const usingPersonImage = !!(useModelImage && personDefaultKey);
    const usingPersonDesc = !!(!useModelImage && personDesc);
    const pose = Array.isArray(options.poses) && options.poses.length > 0 ? options.poses[0] : "";

    const lines = [];
    lines.push("High-level goals");
    lines.push("- Photorealistic mirror selfie suitable for a Vinted listing.");
    lines.push("- The person holds a black iPhone 16 Pro; amateur smartphone look.");
    lines.push("- Garment is the hero: exact shape, color, fabric, prints, logos.");
    lines.push("");
    lines.push("TASK");
    lines.push(
      "You render a photorealistic mirror selfie of a person wearing the provided garment. The person holds a black iPhone 16 Pro. If a person reference is provided, keep hair and overall build consistent (the face may be occluded by the phone). If an environment reference is provided, treat it as a mirror scene and match its lighting, camera angle, color palette, and depth of field. Keep an amateur phone-shot look."
    );
    lines.push("");
    lines.push("REQUIRED OUTPUT");
    lines.push("- One 2D PNG photo, vertical smartphone framing (prefer 4:5).");
    lines.push("- Realistic lighting and skin; garment clearly visible and dominant.");
    lines.push("- The person must be wearing the uploaded garment; do not omit or replace it.");
    lines.push("");
    lines.push("HARD CONSTRAINTS (must follow)");
    lines.push("1) Garment fidelity: preserve exact silhouette, color, fabric texture, print scale/alignment, closures, and logos from the garment image.");
    lines.push("2) Body realism: natural proportions; correct anatomy; no extra fingers; no warped limbs.");
    lines.push("3) Face realism: plausible expression; no duplicates/melting; preserve identity cues (hair/build) if a person ref is provided.");
    lines.push("4) Clothing fit: believable size and drape; respect gravity and fabric stiffness.");
    lines.push("5) Clean output: no watermarks, no AI artifacts, no text overlays, no added logos.");
    lines.push("6) Safety: PG-13; no explicit content.");
    lines.push("7) Mirror selfie: a black iPhone 16 Pro is held in front of the face in the mirror; ensure the phone occludes the face area consistently (with correct reflection), without obscuring key garment details.");
    lines.push("8) Garment usage: the person must be wearing the uploaded garment; do not omit or replace it.");
    lines.push("");
    lines.push("CONDITIONED CONTROLS");
    lines.push(`- Gender: ${usingPersonImage ? "" : (options.gender || "")}`);
    lines.push(`- Environment: ${envDefaultKey ? "" : (options.environment || "")}`);
    lines.push(`- Pose: ${pose || ""}`);
    lines.push(`- Extra user instructions: "${(options.extra || "").trim().replace(/\n/g, " ")}"`);
    lines.push("");
    lines.push("STYLE & CAMERA DIRECTION");
    lines.push("- Smartphone mirror-selfie aesthetic; natural colors; mild grain acceptable.");
    lines.push("- 3/4 or full-body by default so the garment is fully visible.");
    lines.push("- Camera look: ~26–35mm equivalent; mild lens distortion; f/2.8–f/5.6; soft bokeh if indoors.");
    lines.push("- Lighting: match environment reference if given; otherwise soft directional key + gentle fill; subtle rim for separation.");
    lines.push("- Composition: center subject in mirror; show phone and hand; avoid cropping garment edges; keep hands visible naturally.");
    lines.push("");
    lines.push("ENVIRONMENT BEHAVIOR");
    lines.push("- If an environment reference is provided: treat it as a mirror scene; imitate its framing, palette, light direction, shadows, and DoF; keep any mirror frame consistent.");
    lines.push("- If not provided: synthesize a clean mirror setting (bedroom/closet/bath) that complements the garment; uncluttered background.");
    lines.push("");
    lines.push("PERSON BEHAVIOR");
    lines.push("- If a person reference is provided: keep hair, skin tone, and general build consistent (face may be partly occluded by phone).");
    lines.push("- If not provided: synthesize a plausible model matching the gender; friendly neutral expression.");
    if (usingPersonDesc) {
      lines.push("- Use a person that matches this description.");
      lines.push(`- Person description: ${personDesc}`);
    }
    lines.push("- Hand pose: holding a black iPhone 16 Pro naturally; fingers look correct; phone and its reflection visible.");
    lines.push("");
    lines.push("POSE RENDERING");
    lines.push(`- Enforce the requested pose: ${pose || ""}. Make it balanced and anatomically plausible.`);
    lines.push("- Ensure the garment remains fully visible and not occluded by the phone or pose.");
    lines.push("");
    lines.push("QUALITY CHECK BEFORE OUTPUT");
    lines.push("- Fingers: five per hand; shapes correct.");
    lines.push("- Garment: crisp edges; seams/hemlines visible; prints/logos accurate.");
    lines.push("- Face: no duplicates; no melting; if visible, eyes symmetrical; otherwise occluded by phone.");
    lines.push("- Mirror: phone and reflection consistent; no extra phones; no camera artifacts.");
    lines.push("- Background: clean and coherent; matches env ref if provided.");
    lines.push("");
    lines.push("NEGATIVE GUIDANCE (avoid)");
    lines.push("blurry, over-saturated, HDR halos, duplicated limbs, extra fingers, warped faces, melted textures, text overlays, watermarks, added/brand-new logos, heavy beauty retouching, studio glamour look, ring-light glare, tripod/DSLR look, explicit content.");
    lines.push("");
    lines.push("END OF INSTRUCTIONS");

    return lines.join("\n");
  }

  // Keep prompt preview in sync unless user edited it
  useEffect(() => {
    if (!promptDirty) {
      setPromptInput(computeEffectivePrompt());
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
      // limit to 3
      if (o.poses.length >= 3) return o;
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

  async function handleGenerate() {
    if (!selectedFile) return;
    try {
      setIsGenerating(true);
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

      // Ensure at least one pose
      const poses = Array.isArray(options.poses) && options.poses.length > 0 ? options.poses : ["standing"];

      // Fire parallel requests per pose (max 3 by UI)
      // Use selected studio default (persisted), or fall back to first
      const envDefaultKey = options.environment === "studio" && (selectedEnvDefaultKey || envDefaults[0]?.s3_key)
        ? (selectedEnvDefaultKey || envDefaults[0]?.s3_key)
        : undefined;

      const requests = poses.map(async (pose) => {
        const form = new FormData();
        form.append("image", selectedFile);
        form.append("gender", options.gender);
        form.append("environment", options.environment);
        form.append("poses", pose);
        form.append("extra", options.extra || "");
        form.append("title", title || "");
        if (envDefaultKey) {
          form.append("env_default_s3_key", envDefaultKey);
        }
        const personDefault = options.gender === "woman" ? modelDefaults?.woman : modelDefaults?.man;
        const personDefaultKey = personDefault?.s3_key;
        const personDesc = personDefault?.description;
        if (useModelImage && personDefaultKey) {
          form.append("model_default_s3_key", personDefaultKey);
        } else if (!useModelImage && personDesc) {
          form.append("model_description_text", personDesc);
        }
        // Always send the visible prompt as override so backend uses exactly this text
        const effective = (promptInput && promptInput.trim()) ? promptInput : computeEffectivePrompt();
        form.append("prompt_override", effective);
        // Description fields are not sent to backend for generation
        const res = await fetch(`${baseUrl}/edit`, { method: "POST", body: form });
        if (!res.ok) throw new Error(await res.text());
        const blob = await res.blob();
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error("Failed to read image"));
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
        return { pose, dataUrl: String(dataUrl) };
      });

      const results = await Promise.allSettled(requests);
      const successes = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
      if (successes.length === 0) throw new Error("All generations failed");

      // Show first result in preview
      const first = successes[0];
      if (previewUrl && typeof previewUrl === "string" && previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
      setPreviewUrl(first.dataUrl);

      // Save all in history (cap 12)
      const now = Date.now();
      const newItems = successes.map((s) => ({
        id: `${now}-${s.pose}-${Math.random().toString(36).slice(2, 6)}`,
        dataUrl: s.dataUrl,
        createdAt: now,
        prompt: (promptInput && promptInput.trim()) ? promptInput : computeEffectivePrompt(),
        options: { ...options, poses: [s.pose], title, desc: descEnabled ? desc : undefined },
      }));
      const next = [...newItems, ...history].slice(0, 12);
      persistHistory(next);
    } catch (err) {
      console.error(err);
      alert("Generation failed. Check backend logs and API key.");
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

  return (
    <div className="font-sans min-h-screen bg-background text-foreground flex flex-col">
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
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    className="size-6"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.5"
                      d="M3 15.75V18a3 3 0 003 3h12a3 3 0 003-3v-2.25M7.5 9 12 4.5 16.5 9M12 4.5V15"
                    />
                  </svg>
                </div>
                <div className="text-sm">
                  <span className="font-medium">Tap to upload</span> or drop an image
                </div>
                <div className="text-xs text-gray-500">PNG, JPG, HEIC up to ~10MB</div>
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

        {/* Description generation toggle */}
        <section>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm font-medium">Description generation</span>
            <button
              type="button"
              onClick={() => setDescEnabled((v) => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${descEnabled ? "bg-foreground" : "bg-black/20 dark:bg-white/20"}`}
              aria-pressed={descEnabled}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-background transition-transform ${descEnabled ? "translate-x-5" : "translate-x-1"}`}
              />
            </button>
          </div>
          {descEnabled && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-gray-500">Brand</label>
                <input
                  type="text"
                  className="mt-1 w-full h-10 rounded-md border border-black/10 dark:border-white/15 bg-transparent px-3 text-sm"
                  placeholder="e.g., Nike, Zara"
                  value={desc.brand}
                  onChange={(e) => setDesc((d) => ({ ...d, brand: e.target.value }))}
                />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-500">Model</label>
                <input
                  type="text"
                  className="mt-1 w-full h-10 rounded-md border border-black/10 dark:border-white/15 bg-transparent px-3 text-sm"
                  placeholder="e.g., Air Max 90, Oversized Hoodie"
                  value={desc.productModel}
                  onChange={(e) => setDesc((d) => ({ ...d, productModel: e.target.value }))}
                />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-500">Size</label>
                <div className="mt-1 grid grid-cols-5 gap-2">
                  {["xs", "s", "m", "l", "xl"].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setDesc((d) => ({ ...d, size: s }))}
                      className={`h-10 rounded-md border text-sm ${desc.size === s ? "border-foreground" : "border-black/10 dark:border-white/15"}`}
                    >
                      {s.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Prompt preview and editor */}
        <section>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm font-medium">Prompt</span>
            {promptDirty ? (
              <button
                type="button"
                className="text-xs text-gray-500 hover:underline"
                onClick={() => {
                  setPromptDirty(false);
                  setPromptInput(computeEffectivePrompt());
                }}
              >
                Reset to suggested
              </button>
            ) : null}
          </div>
          <textarea
            rows={4}
            className="w-full rounded-md border border-black/10 dark:border-white/15 bg-transparent px-3 py-2 text-sm"
            placeholder="Exact prompt that will be sent"
            value={promptInput}
            onChange={(e) => {
              setPromptInput(e.target.value);
              setPromptDirty(true);
            }}
          />
          <p className="mt-1 text-[10px] text-gray-500">This exact text is sent to the model. Changing options updates the suggestion unless you edit it.</p>
        </section>

        {/* Options */}
        <section className="mt-1">
          <button
            type="button"
            className="w-full flex items-center justify-between py-3"
            onClick={() => setOptionsOpen((s) => !s)}
          >
            <span className="text-sm font-medium">Options</span>
            <span className="text-xs text-gray-500">{optionsOpen ? "Hide" : "Show"}</span>
          </button>
          {optionsOpen && (
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
              {/* Model reference toggle: Image vs Description */}
              <div className="col-span-1">
                <label className="text-xs text-gray-500">Model reference</label>
                <div className="mt-1 flex items-center justify-between h-10 px-2 rounded-md border border-black/10 dark:border-white/15">
                  <span className="text-xs text-gray-600">{useModelImage ? "Use default image" : "Use description only"}</span>
                  <button
                    type="button"
                    onClick={() => setUseModelImage((v) => !v)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${useModelImage ? "bg-foreground" : "bg-black/20 dark:bg-white/20"}`}
                    aria-pressed={useModelImage}
                  >
                    <span className={`inline-block h-5 w-5 transform rounded-full bg-background transition-transform ${useModelImage ? "translate-x-5" : "translate-x-1"}`} />
                  </button>
                </div>
                {/* Tiny helper when description not available for selected gender */}
                {!useModelImage && !((options.gender === "woman" ? modelDefaults?.woman?.description : modelDefaults?.man?.description)) && (
                  <p className="mt-1 text-[10px] text-amber-600">No description on default; falling back to prompt gender.</p>
                )}
              </div>
              {envDefaults.length > 0 ? (
                <div className="col-span-1">
                  <label className="text-xs text-gray-500">Environment</label>
                  <select
                    className="mt-1 w-full h-10 rounded-md border border-black/10 dark:border-white/15 bg-transparent px-3 text-sm"
                    value={selectedEnvDefaultKey || ""}
                    onChange={(e) => {
                      const v = e.target.value || null;
                      setSelectedEnvDefaultKey(v);
                      try {
                        if (v) localStorage.setItem("vb_env_default_key", v);
                      } catch {}
                      if (options.environment !== "studio") {
                        setOptions((o) => ({ ...o, environment: "studio" }));
                      }
                    }}
                  >
                    {envDefaults.map((d) => (
                      <option key={d.s3_key} value={d.s3_key}>
                        {d.name || d.s3_key}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="col-span-1">
                  <label className="text-xs text-gray-500">Environment</label>
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
                </div>
              )}
              <div className="col-span-2">
                <label className="text-xs text-gray-500">Poses (up to 3)</label>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {allowedPoses.map((pose) => {
                    const selected = options.poses.includes(pose);
                    const limitReached = !selected && options.poses.length >= 3;
                    return (
                      <label key={pose} className={`flex items-center gap-2 text-sm rounded-md border px-3 py-2 ${selected ? "border-foreground" : "border-black/10 dark:border-white/15"}`}>
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={selected}
                          disabled={limitReached}
                          onChange={() => togglePose(pose)}
                        />
                        {pose}
                      </label>
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
            </div>
          )}
        </section>

        

        {/* History */}
        <section className="mt-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">History</h2>
            {history.length > 0 && (
              <button
                type="button"
                className="text-xs text-gray-500 hover:underline"
                onClick={() => persistHistory([])}
              >
                Clear
              </button>
            )}
          </div>
          {history.length === 0 ? (
            <p className="text-xs text-gray-500 mt-2">No generations yet.</p>
          ) : (
            <div className="mt-2 grid grid-cols-3 gap-2">
              {history.map((item) => (
                <button
                  key={item.id}
                  className="relative rounded-md overflow-hidden border border-black/10 dark:border-white/15 aspect-square"
                  onClick={() => setPreviewUrl(item.dataUrl)}
                  title={new Date(item.createdAt).toLocaleString()}
                >
                  <img src={item.dataUrl} alt="History" className="h-full w-full object-cover" />
                </button>
              ))}
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

      <div className="sticky bottom-0 z-10 w-full bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-t border-black/10 dark:border-white/15">
        <div className="max-w-md mx-auto p-4 flex gap-3">
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
