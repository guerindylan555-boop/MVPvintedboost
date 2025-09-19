"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "react-hot-toast";
import { createAuthClient } from "better-auth/react";
import { Camera, Loader2 } from "lucide-react";
import { Input, Switch, Spinner } from "@heroui/react";
import {
  Card,
  CardBody,
  CardHeader,
  SectionHeader,
  SegmentedControl,
  AssetCard,
  AssetGrid,
  Textarea,
  StickyGenerateBar,
} from "@/app/components";
import { getApiBase, withUserId } from "@/app/lib/api";
import { preprocessImage } from "@/app/lib/image-preprocess";

const authClient = createAuthClient();
const MAX_IMAGE_COUNT = 10;
const CONDITION_OPTIONS = ["Brand new", "Very good", "Good"];
const SIZE_OPTIONS = ["xs", "s", "m", "l", "xl"];

function clampImageCount(value) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.round(value), 1), MAX_IMAGE_COUNT);
}

function formatDateLabel(value) {
  if (!value) return "";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function capitalize(value) {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function Home() {
  const { data: session } = authClient.useSession();
  const userId =
    session?.session?.userId || session?.user?.id || session?.user?.email || null;

  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPreprocessing, setIsPreprocessing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const [title, setTitle] = useState("");
  const [descEnabled, setDescEnabled] = useState(false);
  const [desc, setDesc] = useState({ brand: "", productModel: "", size: "" });
  const [productCondition, setProductCondition] = useState("");
  const [garmentType, setGarmentType] = useState(null);
  const [garmentTypeError, setGarmentTypeError] = useState(false);
  const [imageCount, setImageCount] = useState(4);
  const [extraInstructions, setExtraInstructions] = useState("");

  const [envAssets, setEnvAssets] = useState([]);
  const [envLoading, setEnvLoading] = useState(false);
  const [selectedEnvKey, setSelectedEnvKey] = useState(null);

  const [modelAssets, setModelAssets] = useState([]);
  const [modelLoading, setModelLoading] = useState(false);
  const [selectedModelKey, setSelectedModelKey] = useState(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const selectedEnvironment = useMemo(
    () => envAssets.find((asset) => asset.s3_key === selectedEnvKey) || null,
    [envAssets, selectedEnvKey]
  );
  const selectedModel = useMemo(
    () => modelAssets.find((asset) => asset.s3_key === selectedModelKey) || null,
    [modelAssets, selectedModelKey]
  );

  const selectedEnvIndex = useMemo(
    () => envAssets.findIndex((asset) => asset.s3_key === selectedEnvKey),
    [envAssets, selectedEnvKey]
  );
  const environmentLabel = useMemo(() => {
    if (!selectedEnvironment) return "";
    if (selectedEnvironment.name) return selectedEnvironment.name;
    if (selectedEnvIndex >= 0) return `Environment ${selectedEnvIndex + 1}`;
    return "Environment";
  }, [selectedEnvironment, selectedEnvIndex]);

  const selectedModelIndex = useMemo(
    () => modelAssets.findIndex((asset) => asset.s3_key === selectedModelKey),
    [modelAssets, selectedModelKey]
  );
  const modelLabel = useMemo(() => {
    if (!selectedModel) return "";
    if (selectedModel.description) {
      const [firstSentence] = selectedModel.description.split(". ");
      if (firstSentence) return firstSentence;
    }
    if (selectedModelIndex >= 0) return `Model ${selectedModelIndex + 1}`;
    return "Model";
  }, [selectedModel, selectedModelIndex]);
  const modelSummary = useMemo(() => {
    if (!selectedModel) return "";
    const genderLabel = capitalize(selectedModel.gender || "");
    if (modelLabel && genderLabel) return `${modelLabel} · ${genderLabel}`;
    if (modelLabel) return modelLabel;
    return genderLabel;
  }, [modelLabel, selectedModel]);

  const garmentLabel = useMemo(
    () => (garmentType ? capitalize(garmentType) : ""),
    [garmentType]
  );

  const generateSummaryItems = useMemo(
    () => [
      {
        label: "Garment",
        value: garmentLabel,
        complete: Boolean(garmentType),
        placeholder: "Select type",
      },
      {
        label: "Environment",
        value: environmentLabel,
        complete: Boolean(selectedEnvironment),
        placeholder: "Pick environment",
      },
      {
        label: "Model",
        value: modelSummary,
        complete: Boolean(selectedModel),
        placeholder: "Pick model",
      },
      {
        label: "Images",
        value: String(imageCount),
        complete: imageCount >= 1,
        placeholder: "Set count",
      },
    ],
    [
      environmentLabel,
      garmentLabel,
      garmentType,
      imageCount,
      modelSummary,
      selectedEnvironment,
      selectedModel,
    ]
  );

  const extraTrimmed = useMemo(
    () => (typeof extraInstructions === "string" ? extraInstructions.trim() : ""),
    [extraInstructions]
  );

  const fetchEnvironmentAssets = useCallback(async () => {
    setEnvLoading(true);
    try {
      const baseUrl = getApiBase();
      const res = await fetch(`${baseUrl}/env/generated`, {
        headers: withUserId({}, userId),
      });
      const data = await res.json();
      if (data?.items && Array.isArray(data.items)) {
        setEnvAssets(data.items);
      } else {
        setEnvAssets([]);
      }
    } catch (error) {
      console.error("Failed to load environments", error);
      setEnvAssets([]);
    } finally {
      setEnvLoading(false);
    }
  }, [userId]);

  const fetchModelAssets = useCallback(async () => {
    setModelLoading(true);
    try {
      const baseUrl = getApiBase();
      const res = await fetch(`${baseUrl}/model/generated`, {
        headers: withUserId({}, userId),
      });
      const data = await res.json();
      if (data?.items && Array.isArray(data.items)) {
        setModelAssets(data.items);
      } else {
        setModelAssets([]);
      }
    } catch (error) {
      console.error("Failed to load models", error);
      setModelAssets([]);
    } finally {
      setModelLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchEnvironmentAssets();
    fetchModelAssets();
  }, [fetchEnvironmentAssets, fetchModelAssets]);

  async function setImageFile(file) {
    if (!file) return;
    if (!file.type?.startsWith("image/")) {
      toast.error("Please select an image file.");
      return;
    }
    if (previewUrl) {
      try {
        URL.revokeObjectURL(previewUrl);
      } catch {}
    }
    setIsPreprocessing(true);
    try {
      const { file: processed, previewUrl: url } = await preprocessImage(file);
      const nextFile = processed || file;
      setSelectedFile(nextFile);
      setPreviewUrl(url || URL.createObjectURL(nextFile));
    } catch (error) {
      console.error("Failed to preprocess image", error);
      const objectUrl = URL.createObjectURL(file);
      setSelectedFile(file);
      setPreviewUrl(objectUrl);
    } finally {
      setIsPreprocessing(false);
    }
  }

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    await setImageFile(file);
  }

  function handleDragOver(event) {
    event.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(event) {
    event.preventDefault();
    setIsDragging(false);
  }

  async function handleDrop(event) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer?.files?.[0];
    await setImageFile(file);
  }

  function triggerFilePicker() {
    fileInputRef.current?.click();
  }

  function triggerCameraPicker() {
    cameraInputRef.current?.click();
  }

  function clearSelection() {
    if (previewUrl) {
      try {
        URL.revokeObjectURL(previewUrl);
      } catch {}
    }
    setSelectedFile(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  }

  function adjustImageCount(delta) {
    setImageCount((prev) => clampImageCount(prev + delta));
  }

  function handleImageSlider(event) {
    const next = Number(event.target.value);
    setImageCount(clampImageCount(next));
  }

  const canGenerate = Boolean(
    selectedFile && garmentType && selectedEnvironment && selectedModel
  );

  async function handleGenerate() {
    if (isGenerating) return;
    if (!selectedFile) {
      toast.error("Upload a garment photo first.");
      return;
    }
    if (!garmentType) {
      setGarmentTypeError(true);
      toast.error("Select the garment type to continue.");
      return;
    }
    if (!selectedEnvironment || !selectedModel) {
      toast.error("Pick an environment and model before generating.");
      return;
    }

    const gender = selectedModel.gender || "woman";
    const toastId = toast.loading("Creating listing…");
    setIsGenerating(true);

    try {
      const baseUrl = getApiBase();
      const createForm = new FormData();
      createForm.append("image", selectedFile);
      createForm.append("gender", gender);
      createForm.append("environment", "studio");
      createForm.append("poses", "standing");
      createForm.append("extra", extraTrimmed);
      createForm.append("env_default_s3_key", selectedEnvironment.s3_key);
      createForm.append("model_default_s3_key", selectedModel.s3_key);
      createForm.append("use_model_image", "true");
      createForm.append("garment_type_override", garmentType);
      if (title.trim()) createForm.append("title", title.trim());
      const listingRes = await fetch(`${baseUrl}/listing`, {
        method: "POST",
        body: createForm,
        headers: withUserId({}, userId),
      });
      if (!listingRes.ok) throw new Error(await listingRes.text());
      const listing = await listingRes.json();
      const listingId = listing?.id;
      if (!listingId) throw new Error("Missing listing id");

      let completed = 0;
      for (let index = 0; index < imageCount; index += 1) {
        const editForm = new FormData();
        editForm.append("image", selectedFile);
        editForm.append("gender", gender);
        editForm.append("environment", "studio");
        editForm.append("poses", "standing");
        editForm.append("extra", extraTrimmed);
        editForm.append("listing_id", listingId);
        editForm.append("env_default_s3_key", selectedEnvironment.s3_key);
        editForm.append("model_default_s3_key", selectedModel.s3_key);
        editForm.append("use_model_image", "true");
        editForm.append("garment_type_override", garmentType);
        const editRes = await fetch(`${baseUrl}/edit/json`, {
          method: "POST",
          body: editForm,
          headers: withUserId({}, userId),
        });
        if (!editRes.ok) throw new Error(await editRes.text());
        await editRes.json();
        completed += 1;
        toast.loading(`Generating images ${completed}/${imageCount}…`, { id: toastId });
      }

      if (descEnabled) {
        const brandTrimmed = desc.brand.trim();
        const modelTrimmed = desc.productModel.trim();
        const sizeTrimmed = desc.size.trim();
        try {
          const descForm = new FormData();
          descForm.append("image", selectedFile);
          descForm.append("gender", gender);
          if (brandTrimmed) descForm.append("brand", brandTrimmed);
          if (modelTrimmed) descForm.append("model_name", modelTrimmed);
          if (sizeTrimmed) descForm.append("size", sizeTrimmed);
          if (productCondition) descForm.append("condition", productCondition);
          descForm.append("listing_id", listingId);
          toast.loading("Generating description…", { id: toastId });
          await fetch(`${baseUrl}/describe`, {
            method: "POST",
            body: descForm,
            headers: withUserId({}, userId),
          });
        } catch (error) {
          console.error("Description generation failed", error);
        }
      }

      toast.success("Listing ready!", { id: toastId });
      window.location.href = `/listing/${listingId}`;
    } catch (error) {
      console.error("Generation failed", error);
      toast.error("Generation failed. Check your assets and try again.", { id: toastId });
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <>
      <div className="space-y-6 pb-32">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.4em] text-foreground/50">
            Create listing
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Dress your product in minutes
          </h1>
          <p className="max-w-2xl text-sm text-foreground/70 sm:text-base">
            Upload a garment photo, pick the scene and model from your studio assets, then let us
            generate ready-to-post visuals.
          </p>
        </header>

        <section className="space-y-5">
          <Card>
            <CardHeader>
              <SectionHeader
                title="Upload garment"
                description="Drop a clear photo of the item you want the model to wear."
              />
            </CardHeader>
            <CardBody className="space-y-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-foreground/70">
                  <button
                    type="button"
                    onClick={triggerCameraPicker}
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-foreground/15 text-foreground transition hover:border-foreground/40"
                    aria-label="Take a photo"
                    title="Take a photo"
                  >
                    <Camera className="size-5" />
                  </button>
                </div>
                {selectedFile ? (
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="text-xs font-medium text-foreground underline underline-offset-4"
                  >
                    Remove photo
                  </button>
                ) : null}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleFileChange}
              />

              {!previewUrl ? (
                <button
                  type="button"
                  onClick={triggerFilePicker}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  className={`flex aspect-[4/5] w-full flex-col items-center justify-center gap-3 rounded-3xl border border-dashed px-6 text-center transition ${
                    isDragging
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-foreground/20 bg-background/60 hover:border-foreground/40"
                  }`}
                >
                  <div className="flex size-16 items-center justify-center rounded-full border border-dashed border-current/30">
                    <Camera className="size-6" />
                  </div>
                  <div className="space-y-1 text-sm">
                    <p className="font-semibold text-foreground">Tap to upload</p>
                    <p className="text-foreground/60">PNG, JPG, HEIC up to 10MB</p>
                  </div>
                  {isPreprocessing ? (
                    <p className="text-xs text-foreground/60">Optimizing photo…</p>
                  ) : null}
                </button>
              ) : (
                <div className="overflow-hidden rounded-3xl border border-foreground/15 bg-background/60">
                  <div className="relative aspect-[4/5] w-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previewUrl}
                      alt="Selected garment"
                      className="h-full w-full object-cover"
                    />
                    {isPreprocessing ? (
                      <div className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-full bg-background/90 px-3 py-1 text-xs font-medium text-foreground shadow">
                        <Loader2 className="size-3 animate-spin" /> Optimizing
                      </div>
                    ) : null}
                    <div className="absolute bottom-3 right-3 rounded-full bg-background/90 px-3 py-1 text-xs font-medium text-foreground shadow">
                      {imageCount} image{imageCount > 1 ? "s" : ""}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-foreground/10 px-4 py-3 text-xs text-foreground/70">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {selectedFile?.name || "Selected garment"}
                      </p>
                      <p>
                        {selectedFile?.size
                          ? `${Math.round(selectedFile.size / 1024)} KB`
                          : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={triggerFilePicker}
                      className="rounded-full border border-foreground/20 px-3 py-1 text-xs font-semibold text-foreground hover:border-foreground/40"
                    >
                      Change
                    </button>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <SectionHeader
                title="Listing basics"
                description="Set a title for your listing and let us draft the description if you like."
              />
            </CardHeader>
            <CardBody className="space-y-5">
              <Input
                label="Listing title"
                labelPlacement="outside"
                placeholder="Autumn denim jacket"
                variant="bordered"
                radius="lg"
                value={title}
                onValueChange={setTitle}
              />
              <div className="rounded-2xl border border-foreground/10 bg-background/70 px-4 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">Generate product description</p>
                    <p className="text-xs text-foreground/60">
                      Add brand, model, size, and condition so we can tailor the copy.
                    </p>
                  </div>
                  <Switch
                    isSelected={descEnabled}
                    onValueChange={setDescEnabled}
                    color="primary"
                    size="lg"
                    classNames={{
                      base: "min-w-[3.5rem]",
                    }}
                    aria-label="Toggle description generation"
                  >
                    {descEnabled ? "On" : "Off"}
                  </Switch>
                </div>
                {descEnabled ? (
                  <div className="mt-4 space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        label="Brand"
                        labelPlacement="outside"
                        placeholder="e.g., Nike, Zara"
                        variant="bordered"
                        radius="lg"
                        value={desc.brand}
                        onValueChange={(value) =>
                          setDesc((prev) => ({ ...prev, brand: value }))
                        }
                      />
                      <Input
                        label="Model"
                        labelPlacement="outside"
                        placeholder="e.g., Air Max 90"
                        variant="bordered"
                        radius="lg"
                        value={desc.productModel}
                        onValueChange={(value) =>
                          setDesc((prev) => ({ ...prev, productModel: value }))
                        }
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-foreground/60">
                          Condition
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {CONDITION_OPTIONS.map((option) => (
                            <button
                              key={option}
                              type="button"
                              onClick={() =>
                                setProductCondition((prev) =>
                                  prev === option ? "" : option
                                )
                              }
                              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                                productCondition === option
                                  ? "border-foreground bg-foreground text-background"
                                  : "border-foreground/20 text-foreground/70 hover:border-foreground/40"
                              }`}
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-foreground/60">
                          Size
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {SIZE_OPTIONS.map((size) => (
                            <button
                              key={size}
                              type="button"
                              onClick={() =>
                                setDesc((prev) => ({
                                  ...prev,
                                  size: prev.size === size ? "" : size,
                                }))
                              }
                              className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase transition ${
                                desc.size === size
                                  ? "border-foreground bg-foreground text-background"
                                  : "border-foreground/20 text-foreground/70 hover:border-foreground/40"
                              }`}
                            >
                              {size.toUpperCase()}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <SectionHeader
                title="Garment type"
                description="Tell us what kind of item this is so the model wears it correctly."
              />
            </CardHeader>
            <CardBody>
              <SegmentedControl
                name="garment-type"
                label={null}
                value={garmentType}
                onChange={(next) => {
                  setGarmentType(next);
                  setGarmentTypeError(false);
                }}
                helperText="Select the item type."
                error={!garmentType && garmentTypeError}
                options={[
                  { value: "top", label: "Top" },
                  { value: "bottom", label: "Bottom" },
                  { value: "full", label: "Full" },
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <SectionHeader
                title="Scene & model"
                description="Pick one environment and one model from the assets you generated in Studio."
              />
            </CardHeader>
            <CardBody className="space-y-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">Environment</h3>
                  <Link href="/studio" className="text-xs font-semibold text-primary underline">
                    Manage
                  </Link>
                </div>
                {envLoading ? (
                  <div className="flex items-center gap-2 text-sm text-foreground/60">
                    <Spinner size="sm" /> Loading environments…
                  </div>
                ) : (
                  <AssetGrid
                    items={envAssets}
                    emptyState={
                      <div className="flex flex-col items-start gap-2 rounded-2xl border border-dashed border-foreground/20 bg-background/60 px-4 py-5 text-sm text-foreground/60">
                        <p>No environments yet. Add some in Studio.</p>
                        <Link href="/studio" className="text-xs font-semibold text-primary underline">
                          Open Studio
                        </Link>
                      </div>
                    }
                    renderItem={(item, index) => (
                      <AssetCard
                        key={item.s3_key}
                        title={item.name || `Environment ${index + 1}`}
                        subtitle={formatDateLabel(item.created_at)}
                        tag="Generated"
                        imageUrl={item.url}
                        selected={selectedEnvKey === item.s3_key}
                        onSelect={() => setSelectedEnvKey(item.s3_key)}
                      />
                    )}
                  />
                )}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">Model</h3>
                  <Link href="/studio" className="text-xs font-semibold text-primary underline">
                    Manage
                  </Link>
                </div>
                {modelLoading ? (
                  <div className="flex items-center gap-2 text-sm text-foreground/60">
                    <Spinner size="sm" /> Loading models…
                  </div>
                ) : (
                  <AssetGrid
                    items={modelAssets}
                    emptyState={
                      <div className="flex flex-col items-start gap-2 rounded-2xl border border-dashed border-foreground/20 bg-background/60 px-4 py-5 text-sm text-foreground/60">
                        <p>No models yet. Add some in Studio.</p>
                        <Link href="/studio" className="text-xs font-semibold text-primary underline">
                          Open Studio
                        </Link>
                      </div>
                    }
                    renderItem={(item, index) => (
                      <AssetCard
                        key={item.s3_key}
                        title={item.description?.split(". ")[0] || `Model ${index + 1}`}
                        subtitle={formatDateLabel(item.created_at)}
                        badge={capitalize(item.gender || "")}
                        imageUrl={item.url}
                        selected={selectedModelKey === item.s3_key}
                        onSelect={() => setSelectedModelKey(item.s3_key)}
                      />
                    )}
                  />
                )}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <SectionHeader
                title="Images"
                description="Choose how many looks to generate. We’ll handle pose variety automatically."
              />
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="flex items-center justify-between text-sm font-medium text-foreground">
                <span>{imageCount} image{imageCount > 1 ? "s" : ""}</span>
                <span className="text-xs text-foreground/60">1 to 10</span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => adjustImageCount(-1)}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-foreground/20 text-lg font-semibold text-foreground hover:border-foreground/40"
                  aria-label="Decrease image count"
                >
                  –
                </button>
                <input
                  type="range"
                  min={1}
                  max={MAX_IMAGE_COUNT}
                  value={imageCount}
                  onChange={handleImageSlider}
                  className="h-1 w-full flex-1 cursor-pointer appearance-none rounded-full bg-foreground/15"
                />
                <button
                  type="button"
                  onClick={() => adjustImageCount(1)}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-foreground/20 text-lg font-semibold text-foreground hover:border-foreground/40"
                  aria-label="Increase image count"
                >
                  +
                </button>
              </div>
              <p className="text-xs text-foreground/60">
                We’ll handle pose variety automatically.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <SectionHeader
                title="Extra instructions"
                description="Add optional styling notes, colours, or mood tweaks for the model."
              />
            </CardHeader>
            <CardBody>
              <Textarea
                value={extraInstructions}
                onChange={(event) => setExtraInstructions(event.target.value)}
                placeholder="Style tweak, colors, vibe (optional)"
                maxLength={200}
                rows={3}
              />
            </CardBody>
          </Card>
        </section>

      </div>
      <StickyGenerateBar
        items={generateSummaryItems}
        disabled={!canGenerate || isGenerating}
        isGenerating={isGenerating}
        onGenerate={handleGenerate}
      />
    </>
  );
}
