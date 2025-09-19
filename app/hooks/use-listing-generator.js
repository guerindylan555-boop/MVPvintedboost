"use client";

import { useCallback, useState } from "react";
import { toast } from "react-hot-toast";

import { getApiBase, withUserId } from "@/app/lib/api";
import { broadcastListingsUpdated } from "@/app/lib/listings-events";

export function useListingGenerator({
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
}) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [poseStatus, setPoseStatus] = useState({});
  const [poseErrors, setPoseErrors] = useState({});

  const handleGenerate = useCallback(async () => {
    if (!selectedFile) return;

    try {
      setIsGenerating(true);
      const baseUrl = getApiBase();

      const imageCount = plannedImagesCount;
      const poseSlots = Array.from({ length: imageCount }, (_, idx) => ({ key: `slot-${idx + 1}`, index: idx }));

      const envDefaultKey = options.environment === "studio" && (selectedEnvDefaultKey || envDefaults[0]?.s3_key)
        ? (selectedEnvDefaultKey || envDefaults[0]?.s3_key)
        : undefined;

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
      broadcastListingsUpdated();

      let done = 0;
      toast.loading(`Generating images ${done}/${poseSlots.length}…`, { id: toastId });
      const initialStatus = {};
      for (const slot of poseSlots) initialStatus[slot.key] = "running";
      setPoseStatus(initialStatus);
      setPoseErrors({});

      const limit = (n, fns) => new Promise((resolve) => {
        const out = new Array(fns.length);
        let i = 0;
        let running = 0;
        let finished = 0;
        const next = () => {
          if (finished >= fns.length) return resolve(out);
          while (running < n && i < fns.length) {
            const idx = i;
            i += 1;
            running += 1;
            fns[idx]()
              .then((v) => { out[idx] = { status: "fulfilled", value: v }; })
              .catch((e) => { out[idx] = { status: "rejected", reason: e }; })
              .finally(() => {
                running -= 1;
                finished += 1;
                next();
              });
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

      const cloneForm = (fd) => {
        const f = new FormData();
        fd.forEach((value, key) => {
          f.append(key, value);
        });
        return f;
      };

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
        let classicP = null;
        let seqP = null;
        if (flowMode === "classic") classicP = classicReq();
        else if (flowMode === "sequential") seqP = seqReq();
        else {
          classicP = classicReq();
          seqP = seqReq();
        }
        let firstDone = false;
        const markDone = () => {
          if (!firstDone) {
            firstDone = true;
            done += 1;
            toast.loading(`Generating images ${done}/${poseSlots.length}…`, { id: toastId });
            setPoseStatus((s) => ({ ...s, [key]: "done" }));
          }
        };
        if (classicP) classicP.then(() => markDone()).catch(() => {});
        if (seqP) seqP.then(() => markDone()).catch(() => {});
        const results = await Promise.all(
          [classicP, seqP]
            .filter(Boolean)
            .map((p) => p.then((v) => ({ ok: true, v })).catch((e) => ({ ok: false, e })))
        );
        const ok = results.find((r) => r.ok);
        if (ok) {
          return ok.v;
        }
        setPoseStatus((s) => ({ ...s, [key]: "error" }));
        setPoseErrors((e) => ({ ...e, [key]: results.map((r) => r.e?.message || "Failed").join("; ") }));
        throw new Error(`Pose ${slotIndex + 1} failed`);
      };

      const tasks = poseSlots.map((slot) => runPose(slot));
      const settled = await limit(2, tasks);
      const okAny = settled.some((r) => r && r.status === "fulfilled");
      if (!okAny) throw new Error("All generations failed");

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
      window.location.href = `/listing/${listingId}`;
    } catch (err) {
      console.error(err);
      toast.error("Generation failed. Check backend/API key.");
    } finally {
      setIsGenerating(false);
    }
  }, [
    selectedFile,
    plannedImagesCount,
    options,
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
  ]);

  return {
    isGenerating,
    poseStatus,
    poseErrors,
    handleGenerate,
  };
}
