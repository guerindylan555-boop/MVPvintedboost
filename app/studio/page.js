"use client";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { createAuthClient } from "better-auth/react";
const authClient = createAuthClient();

export default function StudioPage() {
  const { data: session } = authClient.useSession();
  const userId = session?.session?.userId || session?.user?.id || session?.user?.email || null;
  const isAdmin = Boolean(session?.user?.isAdmin);
  const [activeTab, setActiveTab] = useState("environment"); // environment | model | pose
  // Environment tab state
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [bulkFiles, setBulkFiles] = useState([]);
  const [sources, setSources] = useState([]);
  const [generated, setGenerated] = useState([]);
  const [modelGenerated, setModelGenerated] = useState([]);
  const [modelGeneratedMen, setModelGeneratedMen] = useState([]);
  const [modelGeneratedWomen, setModelGeneratedWomen] = useState([]);
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [defaultNames, setDefaultNames] = useState({}); // s3_key -> name
  const [defaults, setDefaults] = useState([]); // [{s3_key,name,url}]
  const [defaultsModel, setDefaultsModel] = useState({}); // { man: {s3_key,name,url}, woman: {…} }
  // Model tab state
  const [modelPrompt, setModelPrompt] = useState("");
  const [isModelGenerating, setIsModelGenerating] = useState(false);
  const [modelPreviewUrl, setModelPreviewUrl] = useState(null);
  const [modelGender, setModelGender] = useState("man"); // which source to use
  const [maleFile, setMaleFile] = useState(null);
  const [malePreview, setMalePreview] = useState(null);
  const [femaleFile, setFemaleFile] = useState(null);
  const [femalePreview, setFemalePreview] = useState(null);
  const [malePersisted, setMalePersisted] = useState(null); // {s3_key,url}
  const [femalePersisted, setFemalePersisted] = useState(null); // {s3_key,url}
  const [isModelSourceUploading, setIsModelSourceUploading] = useState(false);
  // Remember UI state
  useEffect(() => {
    try {
      const tab = localStorage.getItem("vb_studio_active_tab");
      if (tab && (tab === "environment" || tab === "model" || tab === "pose")) setActiveTab(tab);
    } catch {}
    try {
      const mg = localStorage.getItem("vb_studio_model_gender");
      if (mg && (mg === "man" || mg === "woman")) setModelGender(mg);
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem("vb_studio_active_tab", activeTab); } catch {}
  }, [activeTab]);
  useEffect(() => {
    try { localStorage.setItem("vb_studio_model_gender", modelGender); } catch {}
  }, [modelGender]);
  // Model sources (admin library removed; single source per gender handled via top pickers)
  // Pose tab state
  const [poseFiles, setPoseFiles] = useState([]);
  const [poseSources, setPoseSources] = useState([]); // s3_keys
  const [poseDescs, setPoseDescs] = useState([]); // [{s3_key, description, created_at}]
  const [isPoseUploading, setIsPoseUploading] = useState(false);
  const [isPoseDescribing, setIsPoseDescribing] = useState(false);

  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
      if (modelPreviewUrl && modelPreviewUrl.startsWith("blob:")) URL.revokeObjectURL(modelPreviewUrl);
      if (malePreview && malePreview.startsWith("blob:")) URL.revokeObjectURL(malePreview);
      if (femalePreview && femalePreview.startsWith("blob:")) URL.revokeObjectURL(femalePreview);
    };
  }, [previewUrl, modelPreviewUrl, malePreview, femalePreview]);

  // (Old random prompt suggestions removed – Random now triggers backend generation)

  async function handleGenerate() {
    try {
      setIsGenerating(true);
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
      // If user entered a prompt, use /env/generate (instruction + prompt). Else fallback to /env/random.
      const endpoint = prompt.trim() ? "/env/generate" : "/env/random";
      let res;
      if (endpoint === "/env/generate") {
        const form = new FormData();
        form.append("prompt", prompt.trim());
        res = await fetch(`${baseUrl}${endpoint}`, { method: "POST", body: form, headers: userId ? { "X-User-Id": String(userId) } : {} });
      } else {
        res = await fetch(`${baseUrl}${endpoint}`, { method: "POST", headers: userId ? { "X-User-Id": String(userId) } : {} });
      }
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (previewUrl && previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(url);
    } catch (err) {
      console.error(err);
      alert("Environment generation failed.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleRandomGenerate() {
    try {
      setIsGenerating(true);
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
      const res = await fetch(`${baseUrl}/env/random`, { method: "POST", headers: userId ? { "X-User-Id": String(userId) } : {} });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (previewUrl && previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(url);
    } catch (err) {
      console.error(err);
      alert("Environment generation failed.");
    } finally {
      setIsGenerating(false);
    }
  }

  function handleBulkChange(e) {
    const files = Array.from(e.target.files || []);
    setBulkFiles(files);
  }

  function handleBulkUpload() {
    // Upload selected files to backend as environment sources
    (async () => {
      try {
        if (bulkFiles.length === 0) return alert("Choose files first");
        const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
        const form = new FormData();
        for (const f of bulkFiles) form.append("files", f);
        const res = await fetch(`${baseUrl}/env/sources/upload`, { method: "POST", body: form });
        if (!res.ok) throw new Error(await res.text());
        alert("Uploaded sources.");
      } catch (e) {
        console.error(e);
        alert("Bulk upload failed.");
      }
    })();
  }

  async function refreshSources() {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
      const res = await fetch(`${baseUrl}/env/sources`);
      const data = await res.json();
      if (data?.items) setSources(data.items);
    } catch {}
  }

  async function refreshGenerated() {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
      const res = await fetch(`${baseUrl}/env/generated`, { headers: userId ? { "X-User-Id": String(userId) } : {} });
      const data = await res.json();
      if (data?.items) setGenerated(data.items);
    } catch {}
  }

  async function refreshModelGenerated() {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
      const res = await fetch(`${baseUrl}/model/generated`, { headers: userId ? { "X-User-Id": String(userId) } : {} });
      const data = await res.json();
      if (data?.items) {
        setModelGenerated(data.items);
        setModelGeneratedMen(data.items.filter((i) => i.gender === "man"));
        setModelGeneratedWomen(data.items.filter((i) => i.gender === "woman"));
      }
    } catch {}
  }

  async function refreshDefaults() {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
      const res = await fetch(`${baseUrl}/env/defaults`, { headers: userId ? { "X-User-Id": String(userId) } : {} });
      const data = await res.json();
      if (data?.items) setDefaults(data.items);
    } catch {}
  }

  async function refreshModelDefaults() {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
      const res = await fetch(`${baseUrl}/model/defaults`);
      const data = await res.json();
      if (data?.items) {
        const next = {};
        for (const it of data.items) next[it.gender] = it;
        setDefaultsModel(next);
      }
    } catch {}
  }

  async function refreshModelSources() {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
      // Man
      let res = await fetch(`${baseUrl}/model/sources?gender=man`);
      let data = await res.json();
      setMalePersisted((data?.items && data.items.length > 0) ? data.items[0] : null);
      // Woman
      res = await fetch(`${baseUrl}/model/sources?gender=woman`);
      data = await res.json();
      setFemalePersisted((data?.items && data.items.length > 0) ? data.items[0] : null);
    } catch {}
  }

  useEffect(() => {
    if (isAdmin) {
      refreshSources();
      refreshPoseSources();
      refreshPoseDescriptions();
    }
    // Per-user data
    refreshDefaults();
    refreshGenerated();
    refreshModelGenerated();
    refreshModelDefaults();
    // Persisted model sources (used by everyone)
    refreshModelSources();
  }, [isAdmin, userId]);
  

  async function refreshPoseSources() {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
      const res = await fetch(`${baseUrl}/pose/sources`);
      const data = await res.json();
      if (data?.items) setPoseSources(data.items);
    } catch {}
  }

  async function refreshPoseDescriptions() {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
      const res = await fetch(`${baseUrl}/pose/descriptions`);
      const data = await res.json();
      if (data?.items) setPoseDescs(data.items);
    } catch {}
  }

  function handlePoseFilesChange(e) {
    setPoseFiles(Array.from(e.target.files || []));
  }

  async function uploadPoseFiles() {
    try {
      if (poseFiles.length === 0) return alert("Choose pose images first");
      setIsPoseUploading(true);
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
      const form = new FormData();
      for (const f of poseFiles) form.append("files", f);
      const res = await fetch(`${baseUrl}/pose/sources/upload`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      await refreshPoseSources();
      alert("Pose sources uploaded.");
      setPoseFiles([]);
    } catch (e) {
      console.error(e);
      alert("Pose upload failed.");
    } finally {
      setIsPoseUploading(false);
    }
  }

  async function generatePoseDescriptions() {
    try {
      setIsPoseDescribing(true);
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
      const res = await fetch(`${baseUrl}/pose/describe`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      await refreshPoseDescriptions();
      alert("Pose descriptions generated.");
    } catch (e) {
      console.error(e);
      alert("Pose description generation failed.");
    } finally {
      setIsPoseDescribing(false);
    }
  }

  // Bulk upload/remove for model sources removed (single source per gender)

  function toggleSelect(key) {
    setSelectedKeys((prev) => {
      const has = prev.includes(key);
      if (has) return prev.filter((k) => k !== key);
      if (prev.length >= 5) return prev; // limit 5
      return [...prev, key];
    });
  }

  async function saveDefaults() {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
      const form = new FormData();
      for (const k of selectedKeys) form.append("s3_keys", k);
      for (const k of selectedKeys) form.append("names", defaultNames[k] || "Untitled");
      const res = await fetch(`${baseUrl}/env/defaults`, { method: "POST", headers: userId ? { "X-User-Id": String(userId) } : {}, body: form });
      if (!res.ok) throw new Error(await res.text());
      // Refresh and clear selection for clarity
      await refreshDefaults();
      setSelectedKeys([]);
      setDefaultNames({});
      alert("Defaults saved");
    } catch (e) {
      console.error(e);
      alert("Failed to save defaults");
    }
  }

  async function deleteAllSources() {
    if (!confirm("Delete all uploaded sources? This cannot be undone.")) return;
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
      const res = await fetch(`${baseUrl}/env/sources`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      await refreshSources();
      alert("All sources deleted");
    } catch (e) {
      console.error(e);
      alert("Failed to delete sources");
    }
  }

  function onPickMale(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (malePreview && malePreview.startsWith("blob:")) URL.revokeObjectURL(malePreview);
    setMaleFile(f);
    setMalePreview(URL.createObjectURL(f));
    // Persist immediately so it's available after reload and for all users
    (async () => {
      try {
        setIsModelSourceUploading(true);
        const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
        const form = new FormData();
        form.append("gender", "man");
        form.append("files", f);
        const res = await fetch(`${baseUrl}/model/sources/upload`, { method: "POST", body: form });
        if (!res.ok) throw new Error(await res.text());
        await refreshModelSources();
      } catch (err) {
        console.error(err);
        alert("Failed to upload male source image");
      } finally {
        setIsModelSourceUploading(false);
      }
    })();
  }

  function onPickFemale(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (femalePreview && femalePreview.startsWith("blob:")) URL.revokeObjectURL(femalePreview);
    setFemaleFile(f);
    setFemalePreview(URL.createObjectURL(f));
    // Persist immediately so it's available after reload and for all users
    (async () => {
      try {
        setIsModelSourceUploading(true);
        const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
        const form = new FormData();
        form.append("gender", "woman");
        form.append("files", f);
        const res = await fetch(`${baseUrl}/model/sources/upload`, { method: "POST", body: form });
        if (!res.ok) throw new Error(await res.text());
        await refreshModelSources();
      } catch (err) {
        console.error(err);
        alert("Failed to upload female source image");
      } finally {
        setIsModelSourceUploading(false);
      }
    })();
  }

  // Ensure only the selected gender's source image is kept
  useEffect(() => {
    if (modelGender === "man") {
      if (femalePreview && femalePreview.startsWith("blob:")) URL.revokeObjectURL(femalePreview);
      setFemalePreview(null);
      setFemaleFile(null);
    } else {
      if (malePreview && malePreview.startsWith("blob:")) URL.revokeObjectURL(malePreview);
      setMalePreview(null);
      setMaleFile(null);
    }
  }, [modelGender]);

  async function handleModelGenerate() {
    const gender = modelGender;
    const file = gender === "man" ? maleFile : femaleFile;
    const hasPersisted = gender === "man" ? Boolean(malePersisted) : Boolean(femalePersisted);
    if (!file && !hasPersisted) {
      alert(`Pick a ${gender} source image first`);
      return;
    }
    try {
      setIsModelGenerating(true);
      const form = new FormData();
      if (file) form.append("image", file);
      form.append("gender", gender);
      if (modelPrompt.trim()) form.append("prompt", modelPrompt.trim());
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
      const res = await fetch(`${baseUrl}/model/generate`, { method: "POST", body: form, headers: userId ? { "X-User-Id": String(userId) } : {} });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (modelPreviewUrl && modelPreviewUrl.startsWith("blob:")) URL.revokeObjectURL(modelPreviewUrl);
      setModelPreviewUrl(url);
      await refreshModelGenerated();
    } catch (err) {
      console.error(err);
      alert("Model generation failed.");
    } finally {
      setIsModelGenerating(false);
    }
  }

  return (
    <div className="font-sans min-h-screen bg-background text-foreground flex flex-col">
      <main className="flex-1 p-5 max-w-2xl w-full mx-auto flex flex-col gap-5">
        <header className="pt-2">
          <h1 className="text-xl font-semibold tracking-tight">Studio</h1>
          <p className="text-sm text-gray-500 mt-1">Generate environment or human model scenes.</p>
        </header>

        {/* Tabs */}
        <div className={`grid ${isAdmin ? "grid-cols-3" : "grid-cols-2"} rounded-lg border border-black/10 dark:border-white/15 overflow-hidden`}>
          <button
            className={`h-10 text-sm font-medium ${
              activeTab === "environment" ? "bg-foreground text-background" : "bg-transparent"
            }`}
            onClick={() => setActiveTab("environment")}
          >
            Environment
          </button>
          <button
            className={`h-10 text-sm font-medium ${
              activeTab === "model" ? "bg-foreground text-background" : "bg-transparent"
            }`}
            onClick={() => setActiveTab("model")}
          >
            Model
          </button>
          {isAdmin && (
            <button
              className={`h-10 text-sm font-medium ${
                activeTab === "pose" ? "bg-foreground text-background" : "bg-transparent"
              }`}
              onClick={() => setActiveTab("pose")}
            >
              Pose
            </button>
          )}
        </div>

        {/* Environment tab */}
        {activeTab === "environment" && (
          <section className="flex flex-col gap-4">
            <div>
              <label className="text-xs text-gray-500">Prompt</label>
              <textarea
                rows={3}
                placeholder="Describe the environment to generate (e.g., lush garden at sunrise with mist)"
                className="mt-1 w-full rounded-md border border-black/10 dark:border-white/15 bg-transparent px-3 py-2 text-sm"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleRandomGenerate}
                className="h-10 px-3 rounded-md border border-black/10 dark:border-white/15 text-sm font-medium active:translate-y-px"
              >
                Random
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!prompt.trim() || isGenerating}
                className={`h-10 px-4 rounded-md text-sm font-semibold active:translate-y-px ${
                  !prompt.trim() || isGenerating
                    ? "bg-foreground/30 text-background/60 cursor-not-allowed"
                    : "bg-foreground text-background"
                }`}
              >
                {isGenerating ? "Generating…" : "Generate"}
              </button>
            </div>

            <div className="w-full rounded-2xl overflow-hidden border border-black/10 dark:border-white/15 bg-black/5 dark:bg-white/5">
              <div className="relative w-full aspect-video bg-black/5 flex items-center justify-center">
                {previewUrl ? (
                  <img src={previewUrl} alt="Generated environment" className="h-full w-full object-cover" />
                ) : (
                  <p className="text-xs text-gray-500">Your generated environment will appear here.</p>
                )}
              </div>
            </div>

            {/* Generated env grid below the preview */}
            <div className="mt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Recent generated environments</h3>
                <button
                  type="button"
                  onClick={refreshGenerated}
                  className="h-9 px-3 rounded-md border border-black/10 dark:border-white/15 text-xs font-medium"
                >
                  Refresh
                </button>
              </div>
              {generated.length === 0 ? (
                <p className="text-xs text-gray-500 mt-2">No generated images yet.</p>
              ) : (
                <>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {generated.map((g) => {
                      const isDefault = defaults.some((d) => d.s3_key === g.s3_key);
                      const selected = selectedKeys.includes(g.s3_key);
                      const src = g.url || `${process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"}/env/image?s3_key=${encodeURIComponent(g.s3_key)}`;
                      const name = defaults.find((d) => d.s3_key === g.s3_key)?.name;
                      return (
                        <div key={g.s3_key} className={`relative rounded-md overflow-hidden border aspect-square ${isDefault ? "border-blue-500" : selected ? "border-blue-500" : "border-black/10 dark:border-white/15"}`} title={g.s3_key}>
                          <img src={src} alt="Generated" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                          <div className="absolute top-1 right-1 flex gap-1">
                            {isDefault ? (
                              <>
                                <button
                                  type="button"
                                  className="px-2 py-1 text-[10px] rounded bg-yellow-500 text-white"
                                  onClick={async () => {
                                    const newName = prompt("Rename default", name || "");
                                    if (newName == null) return;
                                    try {
                                      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
                                      const form = new FormData();
                                      form.append("s3_key", g.s3_key);
                                      form.append("name", newName);
                                      const res = await fetch(`${baseUrl}/env/defaults`, { method: "PATCH", headers: userId ? { "X-User-Id": String(userId) } : {}, body: form });
                                      if (!res.ok) throw new Error(await res.text());
                                      await refreshDefaults();
                                    } catch (e) {
                                      alert("Rename failed");
                                    }
                                  }}
                                >
                                  Rename
                                </button>
                                <button
                                  type="button"
                                  className="px-2 py-1 text-[10px] rounded bg-gray-700 text-white"
                                  onClick={async () => {
                                    if (!confirm("Remove from defaults?")) return;
                                    try {
                                      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
                                      const res = await fetch(`${baseUrl}/env/defaults?s3_key=${encodeURIComponent(g.s3_key)}`, { method: "DELETE", headers: userId ? { "X-User-Id": String(userId) } : {} });
                                      if (!res.ok) throw new Error(await res.text());
                                      await refreshDefaults();
                                    } catch (e) {
                                      alert("Failed to remove default");
                                    }
                                  }}
                                >
                                  Undefault
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="px-2 py-1 text-[10px] rounded bg-blue-600 text-white"
                                onClick={() => toggleSelect(g.s3_key)}
                                disabled={isDefault}
                              >
                                {selected ? "Unselect" : "Select"}
                              </button>
                            )}
                            <button
                              type="button"
                              className="px-2 py-1 text-[10px] rounded bg-red-600 text-white"
                              onClick={async () => {
                                if (!confirm("Delete this image? This cannot be undone.")) return;
                                try {
                                  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
                                  const res = await fetch(`${baseUrl}/env/generated?s3_key=${encodeURIComponent(g.s3_key)}`, { method: "DELETE" });
                                  if (!res.ok) throw new Error(await res.text());
                                  await refreshGenerated();
                                  await refreshDefaults();
                                } catch (e) {
                                  alert("Delete failed");
                                }
                              }}
                            >
                              Delete
                            </button>
                          </div>
                          {isDefault && (
                            <div className="absolute bottom-0 left-0 right-0 text-[10px] bg-blue-600 text-white px-1 truncate">{name || "Default"}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {/* Naming inputs for selected */}
                  {selectedKeys.length > 0 && (
                    <div className="mt-3 grid gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">Selected ({selectedKeys.length}/5)</span>
                        <button
                          type="button"
                          onClick={saveDefaults}
                          className="h-9 px-3 rounded-md bg-foreground text-background text-xs font-medium"
                        >
                          Save defaults
                        </button>
                      </div>
                      {selectedKeys.map((k) => (
                    <div key={k} className="grid grid-cols-3 gap-2 items-center">
                      <span className="col-span-2 truncate text-xs">{k}</span>
                      <input
                        type="text"
                        placeholder="Name"
                        className="h-9 rounded-md border border-black/10 dark:border-white/15 bg-transparent px-3 text-xs"
                        value={defaultNames[k] || ""}
                        onChange={(e) => setDefaultNames((d) => ({ ...d, [k]: e.target.value }))}
                      />
                    </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Admin-only bulk upload and sources (hidden for non-admins) */}
            {isAdmin && (
              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-medium">Bulk upload images</h2>
                  <span className="text-xs text-gray-500">Admin only</span>
                </div>
                <div className="mt-2 grid gap-2">
                  <input
                    id="bulk"
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleBulkChange}
                    className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-black/10 dark:file:border-white/15 file:px-3 file:py-2 file:bg-transparent file:text-sm"
                  />
                  {bulkFiles.length > 0 && (
                    <ul className="text-xs text-gray-500 list-disc ml-4">
                      {bulkFiles.map((f) => (
                        <li key={f.name}>{f.name} ({Math.round(f.size / 1024)} KB)</li>
                      ))}
                    </ul>
                  )}
                  <div>
                    <button
                      type="button"
                      onClick={handleBulkUpload}
                      className="h-10 px-3 rounded-md border border-black/10 dark:border-white/15 text-sm font-medium active:translate-y-px"
                    >
                      Upload
                    </button>
                  </div>
                </div>
                {/* Sources list */}
                <div className="mt-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">Uploaded sources</h3>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={refreshSources}
                        className="h-9 px-3 rounded-md border border-black/10 dark:border-white/15 text-xs font-medium"
                      >
                        Refresh
                      </button>
                      {sources.length > 0 && (
                        <button
                          type="button"
                          onClick={deleteAllSources}
                          className="h-9 px-3 rounded-md bg-red-600 text-white text-xs font-medium"
                        >
                          Delete all
                        </button>
                      )}
                    </div>
                  </div>
                  {sources.length === 0 ? (
                    <p className="text-xs text-gray-500 mt-2">No sources uploaded.</p>
                  ) : (
                    <ul className="mt-2 text-xs text-gray-500 break-all">
                      {sources.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Model tab */}
        {activeTab === "model" && (
          <section className="flex flex-col gap-4">
            {/* Move gender selector on top of prompt */}
            <div>
              <label className="text-xs text-gray-500">Model gender</label>
              <div className="mt-1 grid grid-cols-2 rounded-lg border border-black/10 dark:border-white/15 overflow-hidden">
                <button
                  type="button"
                  className={`h-10 text-sm font-medium ${modelGender === "man" ? "bg-foreground text-background" : "bg-transparent"}`}
                  onClick={() => setModelGender("man")}
                >
                  Man
                </button>
                <button
                  type="button"
                  className={`h-10 text-sm font-medium ${modelGender === "woman" ? "bg-foreground text-background" : "bg-transparent"}`}
                  onClick={() => setModelGender("woman")}
                >
                  Woman
                </button>
              </div>
            </div>
            {/* Admin source image pickers moved up for visibility */}
            {isAdmin && (
              <div className="grid grid-cols-2 gap-3">
                {modelGender === "man" && (
                  <div>
                    <label className="text-xs text-gray-500">Male source image</label>
                    <div className="mt-1 rounded-2xl border border-black/10 dark:border-white/15 overflow-hidden">
                      <div className="relative w-full aspect-[4/5] bg-black/5">
                        {(malePreview || malePersisted?.url) ? (
                          <img src={malePreview || malePersisted?.url} alt="Male source" className="h-full w-full object-cover" />
                        ) : (
                          <div className="h-full w-full flex items-center justify-center text-xs text-gray-500">None</div>
                        )}
                      </div>
                      <div className="p-2 flex gap-2">
                        <label className="h-9 px-3 rounded-md bg-foreground text-background text-sm font-medium active:translate-y-px cursor-pointer">
                          <input type="file" accept="image/*" className="hidden" onChange={onPickMale} />
                          Choose
                        </label>
                        {malePreview && (
                          <button
                            type="button"
                            onClick={() => {
                              if (malePreview && malePreview.startsWith("blob:")) URL.revokeObjectURL(malePreview);
                              setMalePreview(null);
                              setMaleFile(null);
                            }}
                            className="h-9 px-3 rounded-md border border-black/10 dark:border-white/15 text-sm font-medium active:translate-y-px"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {modelGender === "woman" && (
                  <div>
                    <label className="text-xs text-gray-500">Female source image</label>
                    <div className="mt-1 rounded-2xl border border-black/10 dark:border-white/15 overflow-hidden">
                      <div className="relative w-full aspect-[4/5] bg-black/5">
                        {(femalePreview || femalePersisted?.url) ? (
                          <img src={femalePreview || femalePersisted?.url} alt="Female source" className="h-full w-full object-cover" />
                        ) : (
                          <div className="h-full w-full flex items-center justify-center text-xs text-gray-500">None</div>
                        )}
                      </div>
                      <div className="p-2 flex gap-2">
                        <label className="h-9 px-3 rounded-md bg-foreground text-background text-sm font-medium active:translate-y-px cursor-pointer">
                          <input type="file" accept="image/*" className="hidden" onChange={onPickFemale} />
                          Choose
                        </label>
                        {femalePreview && (
                          <button
                            type="button"
                            onClick={() => {
                              if (femalePreview && femalePreview.startsWith("blob:")) URL.revokeObjectURL(femalePreview);
                              setFemalePreview(null);
                              setFemaleFile(null);
                            }}
                            className="h-9 px-3 rounded-md border border-black/10 dark:border-white/15 text-sm font-medium active:translate-y-px"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* Admin bulk upload removed; single admin source per gender is managed via the top picker */}
            <div>
              <label className="text-xs text-gray-500">Prompt</label>
              <textarea
                rows={3}
                placeholder={`Describe the ${modelGender === "woman" ? "female" : "male"} model scene (e.g., full-body portrait, casual pose)`}
                className="mt-1 w-full rounded-md border border-black/10 dark:border-white/15 bg-transparent px-3 py-2 text-sm"
                value={modelPrompt}
                onChange={(e) => setModelPrompt(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    setIsModelGenerating(true);
                    const form = new FormData();
                    const gender = modelGender;
                    const file = gender === "man" ? maleFile : femaleFile;
                    const hasPersisted = gender === "man" ? Boolean(malePersisted) : Boolean(femalePersisted);
                    if (!file && !hasPersisted) return alert(`Pick a ${gender} source image first`);
                    if (file) form.append("image", file);
                    form.append("gender", gender);
                    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
                    const res = await fetch(`${baseUrl}/model/generate`, { method: "POST", body: form, headers: userId ? { "X-User-Id": String(userId) } : {} });
                    if (!res.ok) throw new Error(await res.text());
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    if (modelPreviewUrl && modelPreviewUrl.startsWith("blob:")) URL.revokeObjectURL(modelPreviewUrl);
                    setModelPreviewUrl(url);
                    await refreshModelGenerated();
                  } catch (e) {
                    console.error(e);
                    alert("Model randomization failed");
                  } finally {
                    setIsModelGenerating(false);
                  }
                }}
                className="h-10 px-3 rounded-md border border-black/10 dark:border-white/15 text-sm font-medium active:translate-y-px"
              >
                Random
              </button>
              <button
                type="button"
                onClick={handleModelGenerate}
                disabled={(
                  (modelGender === "man" ? (!maleFile && !malePersisted) : (!femaleFile && !femalePersisted))
                ) || isModelGenerating || isModelSourceUploading}
                className={`h-10 px-4 rounded-md text-sm font-semibold active:translate-y-px ${
                  ((modelGender === "man" ? (!maleFile && !malePersisted) : (!femaleFile && !femalePersisted)) || isModelGenerating || isModelSourceUploading)
                    ? "bg-foreground/30 text-background/60 cursor-not-allowed"
                    : "bg-foreground text-background"
                }`}
              >
                {isModelGenerating ? "Generating…" : "Generate"}
              </button>
            </div>

            <div className="w-full rounded-2xl overflow-hidden border border-black/10 dark:border-white/15 bg-black/5 dark:bg-white/5">
              <div className="relative w-full aspect-video bg-black/5 flex items-center justify-center">
                {modelPreviewUrl ? (
                  <img src={modelPreviewUrl} alt="Generated model" className="h-full w-full object-cover" />
                ) : (
                  <p className="text-xs text-gray-500">Your generated model will appear here.</p>
                )}
              </div>
            </div>

            {/* Generated model images (single grid for selected gender) */}
            <div className="mt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Recent generated models — {modelGender === "man" ? "Men" : "Women"}</h3>
                <button
                  type="button"
                  onClick={refreshModelGenerated}
                  className="h-9 px-3 rounded-md border border-black/10 dark:border-white/15 text-xs font-medium"
                >
                  Refresh
                </button>
              </div>
              {(modelGender === "man" ? modelGeneratedMen : modelGeneratedWomen).length === 0 ? (
                <p className="text-xs text-gray-500 mt-2">No generated models yet.</p>
              ) : (
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {(modelGender === "man" ? modelGeneratedMen : modelGeneratedWomen).map((g) => {
                    const src = g.url || `${process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"}/env/image?s3_key=${encodeURIComponent(g.s3_key)}`;
                    const gender = modelGender;
                    const isDefault = gender === "man" ? (defaultsModel?.man?.s3_key === g.s3_key) : (defaultsModel?.woman?.s3_key === g.s3_key);
                    const defaultName = gender === "man" ? (defaultsModel?.man?.name || null) : (defaultsModel?.woman?.name || null);
                    return (
                      <div key={g.s3_key} className={`relative rounded-md overflow-hidden border ${isDefault ? "border-blue-500" : "border-black/10 dark:border-white/15"} aspect-square`}>
                        <img src={src} alt="Generated model" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                        {g.description && (
                          <div className="absolute inset-x-0 bottom-0 text-[10px] bg-black/70 text-white p-1 max-h-20 overflow-auto whitespace-pre-wrap">{g.description}</div>
                        )}
                        <div className="absolute top-1 right-1 flex gap-1">
                          {isDefault ? (
                            <>
                              <button
                                type="button"
                                className="px-2 py-1 text-[10px] rounded bg-yellow-500 text-white"
                                onClick={async () => {
                                  const newName = prompt("Rename default", defaultName || "");
                                  if (newName == null) return;
                                  try {
                                    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
                                    const form = new FormData();
                                    form.append("gender", gender);
                                    form.append("name", newName);
                                    const res = await fetch(`${baseUrl}/model/defaults`, { method: "PATCH", body: form });
                                    if (!res.ok) throw new Error(await res.text());
                                    await refreshModelDefaults();
                                  } catch (e) {
                                    alert("Rename failed");
                                  }
                                }}
                              >
                                Rename
                              </button>
                              <button
                                type="button"
                                className="px-2 py-1 text-[10px] rounded bg-gray-700 text-white"
                                onClick={async () => {
                                  if (!confirm("Remove from defaults?")) return;
                                  try {
                                    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
                                    const res = await fetch(`${baseUrl}/model/defaults?gender=${encodeURIComponent(gender)}`, { method: "DELETE" });
                                    if (!res.ok) throw new Error(await res.text());
                                    await refreshModelDefaults();
                                  } catch (e) {
                                    alert("Failed to remove default");
                                  }
                                }}
                              >
                                Undefault
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="px-2 py-1 text-[10px] rounded bg-blue-600 text-white"
                              onClick={async () => {
                                try {
                                  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
                                  const form = new FormData();
                                  form.append("gender", gender);
                                  form.append("s3_key", g.s3_key);
                                  form.append("name", gender === "woman" ? "Female default" : "Male default");
                                  const res = await fetch(`${baseUrl}/model/defaults`, { method: "POST", body: form });
                                  if (!res.ok) throw new Error(await res.text());
                                  await refreshModelDefaults();
                                } catch (e) {
                                  alert("Failed to set default");
                                }
                              }}
                            >
                              Set default
                            </button>
                          )}
                        </div>
                        {isDefault && (
                          <div className="absolute bottom-0 left-0 right-0 text-[10px] bg-blue-600 text-white px-1 truncate">{defaultName || (gender === "woman" ? "Female default" : "Male default")}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Admin pickers moved above; removed duplicate block here */}
          </section>
        )}

        {/* Pose tab */}
        {activeTab === "pose" && isAdmin && (
          <section className="flex flex-col gap-4">
            <div>
              <label className="text-xs text-gray-500">Bulk upload pose images</label>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handlePoseFilesChange}
                className="mt-1 block w-full text-sm file:mr-3 file:rounded-md file:border file:border-black/10 dark:file:border-white/15 file:px-3 file:py-2 file:bg-transparent file:text-sm"
              />
              {poseFiles.length > 0 && (
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-gray-500">{poseFiles.length} file(s) selected</span>
                  <button
                    type="button"
                    onClick={uploadPoseFiles}
                    disabled={isPoseUploading}
                    className={`h-9 px-3 rounded-md text-xs font-medium ${isPoseUploading ? "bg-foreground/30 text-background/60" : "bg-foreground text-background"}`}
                  >
                    {isPoseUploading ? "Uploading…" : "Upload"}
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Pose sources</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={refreshPoseSources}
                  className="h-9 px-3 rounded-md border border-black/10 dark:border-white/15 text-xs font-medium"
                >
                  Refresh
                </button>
                {poseSources.length > 0 && (
                  <button
                    type="button"
                    onClick={generatePoseDescriptions}
                    disabled={isPoseDescribing}
                    className={`h-9 px-3 rounded-md text-xs font-medium ${isPoseDescribing ? "bg-foreground/30 text-background/60" : "bg-foreground text-background"}`}
                  >
                    {isPoseDescribing ? "Generating…" : "Generate descriptions"}
                  </button>
                )}
              </div>
            </div>

            {poseSources.length === 0 ? (
              <p className="text-xs text-gray-500">No pose sources uploaded.</p>
            ) : (
              <ul className="mt-1 text-xs text-gray-500 break-all">
                {poseSources.map((k) => (
                  <li key={k}>{k}</li>
                ))}
              </ul>
            )}

            <div className="mt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Pose descriptions</h3>
                <button
                  type="button"
                  onClick={refreshPoseDescriptions}
                  className="h-9 px-3 rounded-md border border-black/10 dark:border-white/15 text-xs font-medium"
                >
                  Refresh
                </button>
              </div>
              {poseDescs.length === 0 ? (
                <p className="text-xs text-gray-500 mt-2">No pose descriptions yet.</p>
              ) : (
                <div className="mt-2 grid grid-cols-1 gap-2">
                  {poseDescs.map((d) => (
                    <div key={d.s3_key} className="rounded-md border border-black/10 dark:border-white/15 p-2">
                      <div className="text-[10px] text-gray-500 truncate">{d.s3_key}</div>
                      <div className="mt-1 text-xs whitespace-pre-wrap">{d.description}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
