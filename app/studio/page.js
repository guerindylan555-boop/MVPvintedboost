"use client";
export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { createAuthClient } from "better-auth/react";
import { getApiBase, withUserId } from "@/app/lib/api";
import { VB_STUDIO_ACTIVE_TAB, VB_STUDIO_MODEL_GENDER } from "@/app/lib/storage-keys";

const authClient = createAuthClient();
const ENV_TABS = ["generated", "defaults", "sources"];
const MODEL_TABS = ["generated", "defaults", "sources"];
const GENDER_FILTERS = ["all", "man", "woman"];

export default function StudioPage() {
  const { data: session } = authClient.useSession();
  const userId = session?.session?.userId || session?.user?.id || session?.user?.email || null;
  const isAdmin = Boolean(session?.user?.isAdmin);

  const [activeSection, setActiveSection] = useState("overview");
  const [envLibraryView, setEnvLibraryView] = useState("generated");
  const [modelLibraryView, setModelLibraryView] = useState("generated");
  const [modelGalleryFilter, setModelGalleryFilter] = useState("all");

  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [bulkFiles, setBulkFiles] = useState([]);
  const [sources, setSources] = useState([]);
  const [generated, setGenerated] = useState([]);
  const [defaults, setDefaults] = useState([]);
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [defaultNames, setDefaultNames] = useState({});

  const [modelPrompt, setModelPrompt] = useState("");
  const [isModelGenerating, setIsModelGenerating] = useState(false);
  const [modelPreviewUrl, setModelPreviewUrl] = useState(null);
  const [modelGender, setModelGender] = useState("man");
  const [maleFile, setMaleFile] = useState(null);
  const [malePreview, setMalePreview] = useState(null);
  const [femaleFile, setFemaleFile] = useState(null);
  const [femalePreview, setFemalePreview] = useState(null);
  const [malePersisted, setMalePersisted] = useState(null);
  const [femalePersisted, setFemalePersisted] = useState(null);
  const [isModelSourceUploading, setIsModelSourceUploading] = useState(false);
  const [modelGenerated, setModelGenerated] = useState([]);
  const [defaultsModel, setDefaultsModel] = useState({});

  const [poseFiles, setPoseFiles] = useState([]);
  const [poseSources, setPoseSources] = useState([]);
  const [poseDescs, setPoseDescs] = useState([]);
  const [isPoseUploading, setIsPoseUploading] = useState(false);
  const [isPoseDescribing, setIsPoseDescribing] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(VB_STUDIO_ACTIVE_TAB);
      const allowed = ["overview", "environment", "model", "pose"];
      if (stored && allowed.includes(stored)) {
        setActiveSection(stored);
      }
    } catch {}
    try {
      const storedGender = localStorage.getItem(VB_STUDIO_MODEL_GENDER);
      if (storedGender === "man" || storedGender === "woman") setModelGender(storedGender);
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem(VB_STUDIO_ACTIVE_TAB, activeSection); } catch {}
  }, [activeSection]);

  useEffect(() => {
    try { localStorage.setItem(VB_STUDIO_MODEL_GENDER, modelGender); } catch {}
  }, [modelGender]);

  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
      if (modelPreviewUrl && modelPreviewUrl.startsWith("blob:")) URL.revokeObjectURL(modelPreviewUrl);
      if (malePreview && malePreview.startsWith("blob:")) URL.revokeObjectURL(malePreview);
      if (femalePreview && femalePreview.startsWith("blob:")) URL.revokeObjectURL(femalePreview);
    };
  }, [previewUrl, modelPreviewUrl, malePreview, femalePreview]);

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (isAdmin) {
      refreshSources();
      refreshPoseSources();
      refreshPoseDescriptions();
    }
    refreshDefaults();
    refreshGenerated();
    refreshModelDefaults();
    refreshModelGenerated();
    refreshModelSources();
  }, [isAdmin, userId]);
  /* eslint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    if (!isAdmin && activeSection === "pose") {
      setActiveSection("overview");
    }
  }, [isAdmin, activeSection]);

  useEffect(() => {
    if (!isAdmin && modelLibraryView === "sources") {
      setModelLibraryView("generated");
    }
  }, [isAdmin, modelLibraryView]);

  /* eslint-disable react-hooks/exhaustive-deps */
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
  /* eslint-enable react-hooks/exhaustive-deps */

  async function handleGenerate() {
    try {
      setIsGenerating(true);
      const baseUrl = getApiBase();
      const endpoint = prompt.trim() ? "/env/generate" : "/env/random";
      let res;
      if (endpoint === "/env/generate") {
        const form = new FormData();
        form.append("prompt", prompt.trim());
        res = await fetch(`${baseUrl}${endpoint}`, { method: "POST", body: form, headers: withUserId({}, userId) });
      } else {
        res = await fetch(`${baseUrl}${endpoint}`, { method: "POST", headers: withUserId({}, userId) });
      }
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (previewUrl && previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(url);
      await refreshGenerated();
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
      const baseUrl = getApiBase();
      const res = await fetch(`${baseUrl}/env/random`, { method: "POST", headers: withUserId({}, userId) });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (previewUrl && previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(url);
      await refreshGenerated();
    } catch (err) {
      console.error(err);
      alert("Environment generation failed.");
    } finally {
      setIsGenerating(false);
    }
  }

  function handleBulkChange(event) {
    const files = Array.from(event.target.files || []);
    setBulkFiles(files);
  }

  function handleBulkUpload() {
    (async () => {
      try {
        if (bulkFiles.length === 0) return alert("Choose files first");
        const baseUrl = getApiBase();
        const form = new FormData();
        for (const file of bulkFiles) form.append("files", file);
        const res = await fetch(`${baseUrl}/env/sources/upload`, { method: "POST", body: form });
        if (!res.ok) throw new Error(await res.text());
        await refreshSources();
        alert("Uploaded sources.");
      } catch (err) {
        console.error(err);
        alert("Bulk upload failed.");
      }
    })();
  }

  async function refreshSources() {
    try {
      const baseUrl = getApiBase();
      const res = await fetch(`${baseUrl}/env/sources`);
      const data = await res.json();
      if (data?.items) setSources(data.items);
    } catch {}
  }

  async function refreshGenerated() {
    try {
      const baseUrl = getApiBase();
      const res = await fetch(`${baseUrl}/env/generated`, { headers: withUserId({}, userId) });
      const data = await res.json();
      if (data?.items) setGenerated(data.items);
    } catch {}
  }

  async function refreshDefaults() {
    try {
      const baseUrl = getApiBase();
      const res = await fetch(`${baseUrl}/env/defaults`, { headers: withUserId({}, userId) });
      const data = await res.json();
      if (data?.items) setDefaults(data.items);
    } catch {}
  }

  function toggleSelect(key) {
    setSelectedKeys((prev) => {
      const has = prev.includes(key);
      if (has) return prev.filter((item) => item !== key);
      if (prev.length >= 5) return prev;
      return [...prev, key];
    });
  }

  async function saveDefaults() {
    try {
      const baseUrl = getApiBase();
      const form = new FormData();
      for (const key of selectedKeys) form.append("s3_keys", key);
      for (const key of selectedKeys) form.append("names", defaultNames[key] || "Untitled");
      const res = await fetch(`${baseUrl}/env/defaults`, { method: "POST", body: form, headers: withUserId({}, userId) });
      if (!res.ok) throw new Error(await res.text());
      await refreshDefaults();
      setSelectedKeys([]);
      setDefaultNames({});
      alert("Defaults saved");
    } catch (err) {
      console.error(err);
      alert("Failed to save defaults");
    }
  }

  async function deleteAllSources() {
    if (!confirm("Delete all uploaded sources? This cannot be undone.")) return;
    try {
      const baseUrl = getApiBase();
      const res = await fetch(`${baseUrl}/env/sources`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      await refreshSources();
      alert("All sources deleted");
    } catch (err) {
      console.error(err);
      alert("Failed to delete sources");
    }
  }

  async function refreshModelDefaults() {
    try {
      const baseUrl = getApiBase();
      const res = await fetch(`${baseUrl}/model/defaults`);
      const data = await res.json();
      if (data?.items) {
        const next = {};
        for (const entry of data.items) next[entry.gender] = entry;
        setDefaultsModel(next);
      }
    } catch {}
  }

  async function refreshModelGenerated() {
    try {
      const baseUrl = getApiBase();
      const res = await fetch(`${baseUrl}/model/generated`, { headers: withUserId({}, userId) });
      const data = await res.json();
      if (data?.items) setModelGenerated(data.items);
    } catch {}
  }

  async function refreshModelSources() {
    try {
      const baseUrl = getApiBase();
      let res = await fetch(`${baseUrl}/model/sources?gender=man`);
      let data = await res.json();
      setMalePersisted(data?.items && data.items.length > 0 ? data.items[0] : null);
      res = await fetch(`${baseUrl}/model/sources?gender=woman`);
      data = await res.json();
      setFemalePersisted(data?.items && data.items.length > 0 ? data.items[0] : null);
    } catch {}
  }

  function onPickMale(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (malePreview && malePreview.startsWith("blob:")) URL.revokeObjectURL(malePreview);
    setMaleFile(file);
    setMalePreview(URL.createObjectURL(file));
    (async () => {
      try {
        setIsModelSourceUploading(true);
        const baseUrl = getApiBase();
        const form = new FormData();
        form.append("gender", "man");
        form.append("files", file);
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

  function onPickFemale(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (femalePreview && femalePreview.startsWith("blob:")) URL.revokeObjectURL(femalePreview);
    setFemaleFile(file);
    setFemalePreview(URL.createObjectURL(file));
    (async () => {
      try {
        setIsModelSourceUploading(true);
        const baseUrl = getApiBase();
        const form = new FormData();
        form.append("gender", "woman");
        form.append("files", file);
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
      const baseUrl = getApiBase();
      const res = await fetch(`${baseUrl}/model/generate`, { method: "POST", body: form, headers: withUserId({}, userId) });
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

  async function refreshPoseSources() {
    try {
      const baseUrl = getApiBase();
      const res = await fetch(`${baseUrl}/pose/sources`);
      const data = await res.json();
      if (data?.items) setPoseSources(data.items);
    } catch {}
  }

  async function refreshPoseDescriptions() {
    try {
      const baseUrl = getApiBase();
      const res = await fetch(`${baseUrl}/pose/descriptions`);
      const data = await res.json();
      if (data?.items) setPoseDescs(data.items);
    } catch {}
  }

  function handlePoseFilesChange(event) {
    setPoseFiles(Array.from(event.target.files || []));
  }

  async function uploadPoseFiles() {
    try {
      if (poseFiles.length === 0) return alert("Choose pose images first");
      setIsPoseUploading(true);
      const baseUrl = getApiBase();
      const form = new FormData();
      for (const file of poseFiles) form.append("files", file);
      const res = await fetch(`${baseUrl}/pose/sources/upload`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      await refreshPoseSources();
      setPoseFiles([]);
      alert("Pose sources uploaded.");
    } catch (err) {
      console.error(err);
      alert("Pose upload failed.");
    } finally {
      setIsPoseUploading(false);
    }
  }

  async function generatePoseDescriptions() {
    try {
      setIsPoseDescribing(true);
      const baseUrl = getApiBase();
      const res = await fetch(`${baseUrl}/pose/describe`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      await refreshPoseDescriptions();
      alert("Pose descriptions generated.");
    } catch (err) {
      console.error(err);
      alert("Pose description generation failed.");
    } finally {
      setIsPoseDescribing(false);
    }
  }

  const navItems = useMemo(() => {
    const items = [
      { key: "overview", label: "Overview" },
      { key: "environment", label: "Environments" },
      { key: "model", label: "Models" },
    ];
    if (isAdmin) items.push({ key: "pose", label: "Pose Library" });
    return items;
  }, [isAdmin]);

  const sectionCopy = useMemo(
    () => ({
      overview: {
        title: "Studio overview",
        description: "Track defaults, generated assets, and jump into detailed workflows.",
      },
      environment: {
        title: "Environment studio",
        description: "Generate mirror-scene backdrops and manage saved defaults.",
      },
      model: {
        title: "Model studio",
        description: "Curate reference models and promote the best variants.",
      },
      ...(isAdmin
        ? {
            pose: {
              title: "Pose library",
              description: "Upload pose references and build the description catalog used for randomisation.",
            },
          }
        : {}),
    }),
    [isAdmin]
  );

  const currentCopy = sectionCopy[activeSection] || sectionCopy.environment;

  const environmentDefaultCount = defaults.length;
  const environmentGeneratedCount = generated.length;
  const modelDefaultCount = [defaultsModel?.man, defaultsModel?.woman].filter(Boolean).length;
  const modelGeneratedCount = modelGenerated.length;
  const poseDescriptionCount = poseDescs.length;

  const overviewStats = useMemo(() => {
    const stats = [
      { label: "Environment defaults", value: environmentDefaultCount },
      { label: "Generated environments", value: environmentGeneratedCount },
      { label: "Model defaults", value: modelDefaultCount },
      { label: "Generated models", value: modelGeneratedCount },
    ];
    if (isAdmin) stats.push({ label: "Pose descriptions", value: poseDescriptionCount });
    return stats;
  }, [environmentDefaultCount, environmentGeneratedCount, modelDefaultCount, modelGeneratedCount, poseDescriptionCount, isAdmin]);

  const navCounts = useMemo(
    () => ({
      overview: overviewStats.reduce((sum, stat) => sum + (Number(stat.value) || 0), 0),
      environment: environmentGeneratedCount,
      model: modelGeneratedCount,
      pose: poseDescriptionCount,
    }),
    [overviewStats, environmentGeneratedCount, modelGeneratedCount, poseDescriptionCount]
  );

  const renderOverview = () => (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {overviewStats.map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-black/10 bg-black/5 p-5 dark:border-white/15 dark:bg-white/5">
            <p className="text-xs text-foreground/60">{stat.label}</p>
            <p className="mt-3 text-3xl font-semibold">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-black/10 bg-black/5 p-5 dark:border-white/15 dark:bg-white/5">
          <h3 className="text-lg font-semibold">Environment workspace</h3>
          <p className="mt-1 text-sm text-foreground/60">Generate new mirror scenes and curate up to five defaults for quick reuse.</p>
          <button
            type="button"
            onClick={() => setActiveSection("environment")}
            className="mt-4 inline-flex h-10 items-center justify-center rounded-lg bg-foreground px-4 text-sm font-semibold text-background"
          >
            Open environments
          </button>
        </div>
        <div className="rounded-2xl border border-black/10 bg-black/5 p-5 dark:border-white/15 dark:bg-white/5">
          <h3 className="text-lg font-semibold">Model workspace</h3>
          <p className="mt-1 text-sm text-foreground/60">Manage gender-specific model references and promote the best variants.</p>
          <button
            type="button"
            onClick={() => setActiveSection("model")}
            className="mt-4 inline-flex h-10 items-center justify-center rounded-lg bg-foreground px-4 text-sm font-semibold text-background"
          >
            Open models
          </button>
        </div>
        {isAdmin && (
          <div className="rounded-2xl border border-black/10 bg-black/5 p-5 dark:border-white/15 dark:bg-white/5">
            <h3 className="text-lg font-semibold">Pose catalog</h3>
            <p className="mt-1 text-sm text-foreground/60">Upload pose references and auto-generate descriptions used for random prompts.</p>
            <button
              type="button"
              onClick={() => setActiveSection("pose")}
              className="mt-4 inline-flex h-10 items-center justify-center rounded-lg bg-foreground px-4 text-sm font-semibold text-background"
            >
              Open pose library
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const renderEnvironmentLibrary = () => {
    if (envLibraryView === "defaults") {
      if (defaults.length === 0) {
        return <p className="text-xs text-foreground/60">You have no saved defaults yet. Promote generated scenes from the Generated tab.</p>;
      }
      return (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {defaults.map((item) => (
            <div key={item.s3_key} className="rounded-2xl border border-black/10 bg-background overflow-hidden dark:border-white/15">
              <div className="relative aspect-[4/5]">
                <img src={item.url} alt={item.name || "Environment default"} className="h-full w-full object-cover" />
                <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-1 text-[11px] font-medium text-white">
                  {item.name || "Untitled"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 px-3 py-3 text-xs">
                <span className="truncate text-foreground/60">{item.s3_key}</span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="rounded-md border border-black/10 px-2 py-1 dark:border-white/15"
                    onClick={async () => {
                      const newName = prompt("Rename default", item.name || "");
                      if (newName == null) return;
                      try {
                        const baseUrl = getApiBase();
                        const form = new FormData();
                        form.append("s3_key", item.s3_key);
                        form.append("name", newName);
                        const res = await fetch(`${baseUrl}/env/defaults`, { method: "PATCH", body: form, headers: withUserId({}, userId) });
                        if (!res.ok) throw new Error(await res.text());
                        await refreshDefaults();
                      } catch (err) {
                        alert("Rename failed");
                      }
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-red-500 px-2 py-1 text-red-600"
                    onClick={async () => {
                      if (!confirm("Remove this default?")) return;
                      try {
                        const baseUrl = getApiBase();
                        const res = await fetch(`${baseUrl}/env/defaults?s3_key=${encodeURIComponent(item.s3_key)}`, {
                          method: "DELETE",
                          headers: withUserId({}, userId),
                        });
                        if (!res.ok) throw new Error(await res.text());
                        await refreshDefaults();
                      } catch (err) {
                        alert("Failed to remove default");
                      }
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (envLibraryView === "sources") {
      return (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-black/10 bg-background p-5 dark:border-white/15 dark:bg-white/5">
            <h4 className="text-sm font-semibold">Upload new sources</h4>
            <p className="mt-1 text-xs text-foreground/60">Source environments help the generator learn your style.</p>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleBulkChange}
              className="mt-3 block w-full text-sm file:mr-3 file:rounded-md file:border file:border-black/10 file:bg-transparent file:px-3 file:py-2 dark:file:border-white/15"
            />
            {bulkFiles.length > 0 && (
              <div className="mt-3 flex items-center justify-between text-xs text-foreground/60">
                <span>{bulkFiles.length} file(s) selected</span>
                <button
                  type="button"
                  onClick={handleBulkUpload}
                  className="inline-flex h-9 items-center justify-center rounded-md bg-foreground px-3 font-semibold text-background"
                >
                  Upload
                </button>
              </div>
            )}
          </div>
          <div className="rounded-2xl border border-black/10 bg-background p-5 dark:border-white/15 dark:bg-white/5">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold">Uploaded sources</h4>
                <p className="mt-1 text-xs text-foreground/60">{sources.length} stored photo(s).</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={refreshSources}
                  className="inline-flex h-8 items-center justify-center rounded-md border border-black/10 px-2 text-xs dark:border-white/15"
                >
                  Refresh
                </button>
                {sources.length > 0 && (
                  <button
                    type="button"
                    onClick={deleteAllSources}
                    className="inline-flex h-8 items-center justify-center rounded-md border border-red-500 px-2 text-xs text-red-600"
                  >
                    Delete all
                  </button>
                )}
              </div>
            </div>
            {sources.length === 0 ? (
              <p className="mt-3 text-xs text-foreground/60">No sources uploaded yet.</p>
            ) : (
              <ul className="mt-3 space-y-1 text-xs text-foreground/70">
                {sources.map((src) => (
                  <li key={src.s3_key} className="truncate">{src.s3_key}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      );
    }

    if (generated.length === 0) {
      return <p className="text-xs text-foreground/60">Generate a scene to see it listed here.</p>;
    }

    return (
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {generated.map((item) => {
            const isDefault = defaults.some((def) => def.s3_key === item.s3_key);
            const selected = selectedKeys.includes(item.s3_key);
            const src = item.url || `${getApiBase()}/env/image?s3_key=${encodeURIComponent(item.s3_key)}`;
            const name = defaults.find((def) => def.s3_key === item.s3_key)?.name;
            return (
              <div key={item.s3_key} className="rounded-2xl border border-black/10 bg-background overflow-hidden dark:border-white/15">
                <div className="relative aspect-[4/5] bg-black/5">
                  <img src={src} alt="Generated environment" className="h-full w-full object-cover" />
                  {isDefault && (
                    <span className="absolute left-2 top-2 rounded-full bg-blue-600 px-2 py-1 text-[11px] font-medium text-white">
                      Default
                    </span>
                  )}
                </div>
                <div className="space-y-3 px-3 py-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-foreground/60">{item.s3_key}</span>
                    <button
                      type="button"
                      className="rounded-md border border-red-500 px-2 py-1 text-red-600"
                      onClick={async () => {
                        if (!confirm("Delete this image? This cannot be undone.")) return;
                        try {
                          const baseUrl = getApiBase();
                          const res = await fetch(`${baseUrl}/env/generated?s3_key=${encodeURIComponent(item.s3_key)}`, { method: "DELETE" });
                          if (!res.ok) throw new Error(await res.text());
                          await refreshGenerated();
                          await refreshDefaults();
                        } catch (err) {
                          alert("Delete failed");
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                  {isDefault ? (
                    <p className="truncate text-foreground/60">Saved as: {name || "Untitled"}</p>
                  ) : (
                    <label className="inline-flex items-center gap-1 text-foreground/60">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleSelect(item.s3_key)}
                        className="h-4 w-4"
                      />
                      Select for defaults
                    </label>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {selectedKeys.length > 0 && (
          <div className="rounded-2xl border border-blue-500/40 bg-blue-500/5 p-4">
            <div className="flex items-center justify-between text-xs font-semibold text-blue-900 dark:text-blue-200">
              <span>Promote {selectedKeys.length} image(s) as defaults (max 5)</span>
              <button
                type="button"
                onClick={saveDefaults}
                className="inline-flex h-8 items-center justify-center rounded-md bg-blue-600 px-3 text-white"
              >
                Save defaults
              </button>
            </div>
            <div className="mt-3 space-y-2 text-xs">
              {selectedKeys.map((key) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="flex-1 truncate">{key}</span>
                  <input
                    type="text"
                    placeholder="Name"
                    className="h-8 w-40 rounded-md border border-black/10 px-2 dark:border-white/15"
                    value={defaultNames[key] || ""}
                    onChange={(event) => setDefaultNames((prev) => ({ ...prev, [key]: event.target.value }))}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderEnvironmentSection = () => (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="rounded-2xl border border-black/10 bg-black/5 p-5 dark:border-white/15 dark:bg-white/5">
          <h3 className="text-lg font-semibold">Generate environment</h3>
          <p className="mt-1 text-xs text-foreground/60">Describe a backdrop or leave blank for a random mirror scene.</p>
          <textarea
            rows={4}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="e.g. sunlit loft apartment with a full-length mirror and wooden floors"
            className="mt-3 w-full rounded-lg border border-black/10 bg-background/50 px-3 py-2 text-sm dark:border-white/15"
          />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating}
              className={`inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold ${
                isGenerating ? "bg-foreground/30 text-background/60" : "bg-foreground text-background"
              }`}
            >
              {isGenerating ? "Generating…" : prompt.trim() ? "Generate environment" : "Generate random"}
            </button>
            <button
              type="button"
              onClick={handleRandomGenerate}
              disabled={isGenerating}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-black/10 px-4 text-sm font-semibold dark:border-white/15"
            >
              Surprise me
            </button>
            <button
              type="button"
              onClick={refreshGenerated}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-black/10 px-4 text-sm font-semibold dark:border-white/15"
            >
              Refresh library
            </button>
          </div>
        </div>
        <div className="rounded-2xl border border-black/10 bg-black/5 p-5 dark:border-white/15 dark:bg-white/5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Preview</h3>
            {previewUrl && (
              <button
                type="button"
                onClick={() => {
                  if (previewUrl && previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
                  setPreviewUrl(null);
                }}
                className="text-xs text-foreground/60 underline"
              >
                Clear preview
              </button>
            )}
          </div>
          <div className="mt-3 aspect-video overflow-hidden rounded-xl border border-black/10 bg-black/10 dark:border-white/15">
            {previewUrl ? (
              <img src={previewUrl} alt="Environment preview" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-foreground/50">Generate a scene to preview it here.</div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-black/10 bg-black/5 p-5 dark:border-white/15 dark:bg-white/5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Environment library</h3>
            <p className="text-xs text-foreground/60">Review generated scenes, defaults, and source uploads.</p>
          </div>
          <div className="inline-flex gap-2 rounded-full bg-background/40 p-1">
            {ENV_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setEnvLibraryView(tab)}
                className={`h-9 rounded-full px-3 text-xs font-semibold transition ${
                  envLibraryView === tab ? "bg-foreground text-background" : "text-foreground/60"
                }`}
              >
                {tab === "generated" ? "Generated" : tab === "defaults" ? "Defaults" : "Sources"}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4">{renderEnvironmentLibrary()}</div>
      </div>
    </div>
  );

  const renderModelLibrary = () => {
    if (modelLibraryView === "defaults") {
      const items = [
        { gender: "man", label: "Male default", data: defaultsModel?.man },
        { gender: "woman", label: "Female default", data: defaultsModel?.woman },
      ];
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map(({ gender, label, data }) => (
            <div key={gender} className="rounded-2xl border border-black/10 bg-background overflow-hidden dark:border-white/15">
              <div className="relative aspect-[4/5] bg-black/5">
                {data?.url ? (
                  <img src={data.url} alt={label} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-foreground/60">No default set</div>
                )}
                {data?.name && (
                  <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-1 text-[11px] font-medium text-white">{data.name}</span>
                )}
              </div>
              <div className="px-3 py-3 text-xs text-foreground/60">
                <p className="font-medium text-foreground">{label}</p>
                <p className="mt-1 truncate">{data?.s3_key || "—"}</p>
                {data && (
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      className="rounded-md border border-black/10 px-2 py-1 dark:border-white/15"
                      onClick={async () => {
                        const newName = prompt("Rename default", data.name || "");
                        if (newName == null) return;
                        try {
                          const baseUrl = getApiBase();
                          const form = new FormData();
                          form.append("gender", gender);
                          form.append("name", newName);
                          const res = await fetch(`${baseUrl}/model/defaults`, { method: "PATCH", body: form });
                          if (!res.ok) throw new Error(await res.text());
                          await refreshModelDefaults();
                        } catch (err) {
                          alert("Rename failed");
                        }
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-red-500 px-2 py-1 text-red-600"
                      onClick={async () => {
                        if (!confirm("Remove this default?")) return;
                        try {
                          const baseUrl = getApiBase();
                          const res = await fetch(`${baseUrl}/model/defaults?gender=${encodeURIComponent(gender)}`, { method: "DELETE" });
                          if (!res.ok) throw new Error(await res.text());
                          await refreshModelDefaults();
                        } catch (err) {
                          alert("Failed to remove default");
                        }
                      }}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (modelLibraryView === "sources") {
      const items = [
        { gender: "man", label: "Male source", preview: malePreview, persisted: malePersisted, picker: onPickMale },
        { gender: "woman", label: "Female source", preview: femalePreview, persisted: femalePersisted, picker: onPickFemale },
      ];
      return (
        <div className="grid gap-6 lg:grid-cols-2">
          {items.map((item) => (
            <div key={item.gender} className={`rounded-2xl border border-black/10 bg-background p-5 dark:border-white/15 dark:bg-white/5 ${modelGender === item.gender ? "ring-2 ring-foreground" : "opacity-70"}`}>
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold">{item.label}</h4>
                  <p className="text-xs text-foreground/60">{item.persisted ? "Current reference" : "No source uploaded"}</p>
                </div>
                {isModelSourceUploading && <span className="text-[11px] text-foreground/60">Uploading…</span>}
              </div>
              <div className="mt-3 aspect-[4/5] overflow-hidden rounded-xl border border-black/10 bg-black/5 dark:border-white/15">
                {(item.preview || item.persisted?.url) ? (
                  <img src={item.preview || item.persisted?.url} alt={item.label} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-foreground/60">None</div>
                )}
              </div>
              {isAdmin ? (
                <label className="mt-3 inline-flex h-9 w-full cursor-pointer items-center justify-center rounded-md bg-foreground text-sm font-semibold text-background">
                  <input type="file" accept="image/*" className="hidden" onChange={item.picker} />
                  Replace source
                </label>
              ) : (
                <p className="mt-3 text-[11px] text-foreground/60">Contact an admin to update this source image.</p>
              )}
            </div>
          ))}
        </div>
      );
    }

    const filtered = modelGenerated.filter((item) => {
      if (modelGalleryFilter === "all") return true;
      return item.gender === modelGalleryFilter;
    });

    if (filtered.length === 0) {
      return <p className="text-xs text-foreground/60">No generated models yet.</p>;
    }

    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-foreground/60">
          <span>Filter by gender:</span>
          {GENDER_FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setModelGalleryFilter(filter)}
              className={`h-8 rounded-full border px-3 font-semibold ${
                modelGalleryFilter === filter ? "border-foreground" : "border-foreground/30"
              }`}
            >
              {filter === "all" ? "All" : filter === "man" ? "Men" : "Women"}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((item) => {
            const gender = item.gender || "man";
            const isDefault = gender === "man" ? defaultsModel?.man?.s3_key === item.s3_key : defaultsModel?.woman?.s3_key === item.s3_key;
            const defaultName = gender === "man" ? defaultsModel?.man?.name : defaultsModel?.woman?.name;
            const src = item.url || `${getApiBase()}/model/image?s3_key=${encodeURIComponent(item.s3_key)}`;
            return (
              <div key={item.s3_key} className="rounded-2xl border border-black/10 bg-background overflow-hidden dark:border-white/15">
                <div className="relative aspect-[3/4] bg-black/5">
                  <img src={src} alt="Generated model" className="h-full w-full object-cover" />
                  {isDefault && (
                    <span className="absolute left-2 top-2 rounded-full bg-blue-600 px-2 py-1 text-[11px] font-medium text-white">
                      Default
                    </span>
                  )}
                </div>
                <div className="space-y-3 px-3 py-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-foreground/60">{item.s3_key}</span>
                    <span className="rounded-full bg-foreground/10 px-2 py-1 text-[11px] uppercase tracking-wide text-foreground/70">{gender}</span>
                  </div>
                  {item.description && (
                    <p className="whitespace-pre-wrap text-foreground/80">{item.description}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {isDefault ? (
                      <>
                        <button
                          type="button"
                          className="rounded-md border border-black/10 px-2 py-1 dark:border-white/15"
                          onClick={async () => {
                            const newName = prompt("Rename default", defaultName || "");
                            if (newName == null) return;
                            try {
                              const baseUrl = getApiBase();
                              const form = new FormData();
                              form.append("gender", gender);
                              form.append("name", newName);
                              const res = await fetch(`${baseUrl}/model/defaults`, { method: "PATCH", body: form });
                              if (!res.ok) throw new Error(await res.text());
                              await refreshModelDefaults();
                            } catch (err) {
                              alert("Rename failed");
                            }
                          }}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-red-500 px-2 py-1 text-red-600"
                          onClick={async () => {
                            if (!confirm("Remove this default?")) return;
                            try {
                              const baseUrl = getApiBase();
                              const res = await fetch(`${baseUrl}/model/defaults?gender=${encodeURIComponent(gender)}`, { method: "DELETE" });
                              if (!res.ok) throw new Error(await res.text());
                              await refreshModelDefaults();
                            } catch (err) {
                              alert("Failed to remove default");
                            }
                          }}
                        >
                          Remove
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="rounded-md border border-black/10 px-2 py-1 dark:border-white/15"
                        onClick={async () => {
                          try {
                            const baseUrl = getApiBase();
                            const form = new FormData();
                            form.append("gender", gender);
                            form.append("s3_key", item.s3_key);
                            form.append("name", gender === "woman" ? "Female default" : "Male default");
                            const res = await fetch(`${baseUrl}/model/defaults`, { method: "POST", body: form });
                            if (!res.ok) throw new Error(await res.text());
                            await refreshModelDefaults();
                          } catch (err) {
                            alert("Failed to set default");
                          }
                        }}
                      >
                        Set as default
                      </button>
                    )}
                    <button
                      type="button"
                      className="rounded-md border border-red-500 px-2 py-1 text-red-600"
                      onClick={async () => {
                        if (!confirm("Delete this model?")) return;
                        try {
                          const baseUrl = getApiBase();
                          const res = await fetch(`${baseUrl}/model/generated?s3_key=${encodeURIComponent(item.s3_key)}`, { method: "DELETE" });
                          if (!res.ok) throw new Error(await res.text());
                          await refreshModelGenerated();
                        } catch (err) {
                          alert("Delete failed");
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderModelSection = () => {
    const currentSource = modelGender === "man" ? malePersisted : femalePersisted;
    const hasSource = modelGender === "man" ? (maleFile || malePersisted) : (femaleFile || femalePersisted);

    return (
      <div className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="rounded-2xl border border-black/10 bg-black/5 p-5 dark:border-white/15 dark:bg-white/5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Generate model</h3>
                <p className="text-xs text-foreground/60">Provide an optional prompt to guide the outfit or style.</p>
              </div>
              <div className="inline-flex overflow-hidden rounded-lg border border-black/10 dark:border-white/15">
                {[
                  { key: "man", label: "Male" },
                  { key: "woman", label: "Female" },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setModelGender(item.key)}
                    className={`h-9 px-3 text-sm font-semibold ${
                      modelGender === item.key ? "bg-foreground text-background" : "bg-transparent"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {isAdmin ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {[
                  { gender: "man", label: "Male source", preview: malePreview, persisted: malePersisted, picker: onPickMale },
                  { gender: "woman", label: "Female source", preview: femalePreview, persisted: femalePersisted, picker: onPickFemale },
                ].map((item) => (
                  <div key={item.gender} className={`rounded-xl border border-black/10 bg-background p-3 dark:border-white/15 ${modelGender === item.gender ? "ring-2 ring-foreground" : "opacity-70"}`}>
                    <p className="text-xs font-semibold text-foreground/70">{item.label}</p>
                    <div className="mt-2 aspect-[4/5] overflow-hidden rounded-lg border border-black/10 bg-black/5 dark:border-white/15">
                      {(item.preview || item.persisted?.url) ? (
                        <img src={item.preview || item.persisted?.url} alt={item.label} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-[11px] text-foreground/60">No source yet</div>
                      )}
                    </div>
                    {modelGender === item.gender && (
                      <label className="mt-3 inline-flex h-9 w-full cursor-pointer items-center justify-center rounded-md bg-foreground text-sm font-semibold text-background">
                        <input type="file" accept="image/*" className="hidden" onChange={item.picker} />
                        Replace source
                      </label>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-black/10 bg-background p-4 text-xs text-foreground/60 dark:border-white/15">
                {currentSource?.url ? (
                  <div className="flex items-center gap-3">
                    <img src={currentSource.url} alt="Default source" className="h-16 w-16 rounded-md object-cover" />
                    <div>
                      <p className="font-semibold text-foreground">Reference in use</p>
                      <p>Contact your administrator to update source photos.</p>
                    </div>
                  </div>
                ) : (
                  <p>No reference uploaded yet. Contact your administrator to add one.</p>
                )}
              </div>
            )}

            <textarea
              rows={4}
              value={modelPrompt}
              onChange={(event) => setModelPrompt(event.target.value)}
              placeholder="e.g. natural daylight, smiling expression, casual denim outfit"
              className="mt-4 w-full rounded-lg border border-black/10 bg-background/50 px-3 py-2 text-sm dark:border-white/15"
            />

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleModelGenerate}
                disabled={!hasSource || isModelGenerating || isModelSourceUploading}
                className={`inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold ${
                  (!hasSource || isModelGenerating || isModelSourceUploading)
                    ? "bg-foreground/30 text-background/60"
                    : "bg-foreground text-background"
                }`}
              >
                {isModelGenerating ? "Generating…" : modelPrompt.trim() ? "Generate model" : "Generate random"}
              </button>
              <button
                type="button"
                onClick={refreshModelGenerated}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-black/10 px-4 text-sm font-semibold dark:border-white/15"
              >
                Refresh library
              </button>
              <span className="text-[11px] text-foreground/60">A source photo per gender is required before generating.</span>
            </div>
          </div>
          <div className="rounded-2xl border border-black/10 bg-black/5 p-5 dark:border-white/15 dark:bg-white/5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Preview</h3>
              {modelPreviewUrl && (
                <button
                  type="button"
                  onClick={() => {
                    if (modelPreviewUrl && modelPreviewUrl.startsWith("blob:")) URL.revokeObjectURL(modelPreviewUrl);
                    setModelPreviewUrl(null);
                  }}
                  className="text-xs text-foreground/60 underline"
                >
                  Clear preview
                </button>
              )}
            </div>
            <div className="mt-3 aspect-[3/4] overflow-hidden rounded-xl border border-black/10 bg-black/10 dark:border-white/15">
              {modelPreviewUrl ? (
                <img src={modelPreviewUrl} alt="Model preview" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-foreground/50">Generate a model to preview it here.</div>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-black/10 bg-black/5 p-5 dark:border-white/15 dark:bg-white/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">Model library</h3>
              <p className="text-xs text-foreground/60">Review generated variants, defaults, and source references.</p>
            </div>
            <div className="inline-flex gap-2 rounded-full bg-background/40 p-1">
              {MODEL_TABS.filter((tab) => tab !== "sources" || isAdmin).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setModelLibraryView(tab)}
                  className={`h-9 rounded-full px-3 text-xs font-semibold transition ${
                    modelLibraryView === tab ? "bg-foreground text-background" : "text-foreground/60"
                  }`}
                >
                  {tab === "generated" ? "Generated" : tab === "defaults" ? "Defaults" : "Sources"}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4">{renderModelLibrary()}</div>
        </div>
      </div>
    );
  };

  const renderPoseSection = () => (
    <div className="space-y-6">
      <div className="rounded-2xl border border-black/10 bg-black/5 p-5 dark:border-white/15 dark:bg-white/5">
        <h3 className="text-lg font-semibold">Upload pose references</h3>
        <p className="mt-1 text-xs text-foreground/60">Drop in up to 10 pose examples at a time to expand the catalog.</p>
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={handlePoseFilesChange}
          className="mt-3 block w-full text-sm file:mr-3 file:rounded-md file:border file:border-black/10 file:bg-transparent file:px-3 file:py-2 dark:file:border-white/15"
        />
        {poseFiles.length > 0 && (
          <div className="mt-3 flex items-center justify-between text-xs text-foreground/60">
            <span>{poseFiles.length} file(s) selected</span>
            <button
              type="button"
              onClick={uploadPoseFiles}
              disabled={isPoseUploading}
              className={`inline-flex h-9 items-center justify-center rounded-md px-3 font-semibold ${
                isPoseUploading ? "bg-foreground/30 text-background/60" : "bg-foreground text-background"
              }`}
            >
              {isPoseUploading ? "Uploading…" : "Upload"}
            </button>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-black/10 bg-black/5 p-5 dark:border-white/15 dark:bg-white/5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Pose descriptions</h3>
            <p className="text-xs text-foreground/60">Trigger description generation and manage existing entries.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refreshPoseDescriptions}
              className="inline-flex h-9 items-center justify-center rounded-md border border-black/10 px-3 text-xs font-semibold dark:border-white/15"
            >
              Refresh
            </button>
            {poseSources.length > 0 && (
              <button
                type="button"
                onClick={generatePoseDescriptions}
                disabled={isPoseDescribing}
                className={`inline-flex h-9 items-center justify-center rounded-md px-3 text-xs font-semibold ${
                  isPoseDescribing ? "bg-foreground/30 text-background/60" : "bg-foreground text-background"
                }`}
              >
                {isPoseDescribing ? "Generating…" : "Generate from sources"}
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-3">
            {poseDescs.length === 0 ? (
              <p className="text-xs text-foreground/60">No descriptions yet.</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {poseDescs.map((item) => (
                  <div key={item.s3_key} className="rounded-xl border border-black/10 bg-background p-3 text-xs text-foreground/70 dark:border-white/15">
                    <div className="truncate text-[10px] text-foreground/50">{item.s3_key}</div>
                    <p className="mt-2 whitespace-pre-wrap text-foreground/80">{item.description || "No description"}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-xl border border-black/10 bg-background p-3 text-xs text-foreground/70 dark:border-white/15">
            <h4 className="text-sm font-semibold">Raw sources ({poseSources.length})</h4>
            <p className="mt-1 text-[11px] text-foreground/60">Uploaded pose references awaiting descriptions.</p>
            {poseSources.length === 0 ? (
              <p className="mt-3 text-[11px] text-foreground/60">No sources uploaded.</p>
            ) : (
              <ul className="mt-3 space-y-1">
                {poseSources.map((key) => (
                  <li key={key} className="truncate">{key}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden lg:flex w-64 flex-col border-r border-black/10 bg-black/5 dark:border-white/15 dark:bg-white/5">
        <div className="px-6 py-6">
          <h1 className="text-lg font-semibold">Studio</h1>
          <p className="mt-1 text-xs text-foreground/60">Manage the assets that power your listings.</p>
        </div>
        <nav className="flex-1 px-2 pb-6 space-y-1">
          {navItems.map((item) => {
            const isActive = activeSection === item.key;
            const count = navCounts[item.key];
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveSection(item.key)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  isActive ? "bg-foreground text-background" : "text-foreground/70 hover:bg-foreground/10"
                }`}
              >
                <span>{item.label}</span>
                {count > 0 && (
                  <span className="rounded-full bg-background/70 px-2 py-0.5 text-[11px] font-medium">{count}</span>
                )}
              </button>
            );
          })}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="border-b border-black/10 bg-black/5 dark:border-white/15 dark:bg-white/5">
          <div className="px-4 py-4 lg:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold">{currentCopy.title}</h2>
                <p className="text-sm text-foreground/60">{currentCopy.description}</p>
              </div>
              <div className="flex items-center gap-2">
                {isAdmin && (
                  <a
                    href="/studio/admin"
                    className="inline-flex h-9 items-center justify-center rounded-md border border-black/10 px-3 text-xs font-semibold dark:border-white/15"
                  >
                    Admin tools
                  </a>
                )}
              </div>
            </div>
            <div className="mt-4 flex gap-2 overflow-x-auto lg:hidden">
              {navItems.map((item) => {
                const isActive = activeSection === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setActiveSection(item.key)}
                    className={`rounded-full px-3 py-1 text-sm font-semibold transition ${
                      isActive ? "bg-foreground text-background" : "border border-foreground/20 text-foreground/70"
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto px-4 py-6 lg:px-6">
          <div className="space-y-6">
            {activeSection === "overview" && renderOverview()}
            {activeSection === "environment" && renderEnvironmentSection()}
            {activeSection === "model" && renderModelSection()}
            {activeSection === "pose" && isAdmin && renderPoseSection()}
          </div>
        </main>
      </div>
    </div>
  );
}
