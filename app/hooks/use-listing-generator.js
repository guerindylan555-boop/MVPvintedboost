"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "react-hot-toast";

import { getApiBase, withUserId } from "@/app/lib/api";
import { broadcastListingsUpdated } from "@/app/lib/listings-events";
import { useSubscription } from "@/app/components/subscription-provider";

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
  const { usage, isBillingEnabled, applyUsageFromResponse } = useSubscription();
  const quotaToastRef = useRef(null);

  const showQuotaToast = useCallback(() => {
    if (quotaToastRef.current) return;
    quotaToastRef.current = toast.custom(
      (t) => (
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/60 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 shadow-xl dark:border-amber-300/40 dark:bg-amber-300/10 dark:text-amber-100">
          <span>Quota reached — visit Billing to upgrade.</span>
          <button
            type="button"
            className="rounded-lg bg-amber-500/80 px-3 py-1 text-xs font-semibold text-amber-950 transition hover:bg-amber-500"
            onClick={() => {
              toast.dismiss(t.id);
              quotaToastRef.current = null;
              window.location.href = "/billing";
            }}
          >
            View plans
          </button>
        </div>
      ),
      { duration: 6000 }
    );
    setTimeout(() => {
      quotaToastRef.current = null;
    }, 6500);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!selectedFile) return;

    const remainingQuota =
      typeof usage?.remaining === "number" ? usage.remaining : null;
    if (isBillingEnabled && remainingQuota !== null && remainingQuota <= 0) {
      showQuotaToast();
      return;
    }

    const readJson = async (res) => {
      const text = await res.text();
      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch {
        return { error: text };
      }
    };

    const quotaError = (payload) => {
      const error = new Error("quota exceeded");
      error.code = "QUOTA_EXCEEDED";
      error.payload = payload;
      return error;
    };

    try {
      setIsGenerating(true);
      const baseUrl = getApiBase();

      const imageCount = plannedImagesCount;
      const poseSlots = Array.from({ length: imageCount }, (_, idx) => ({
        key: `slot-${idx + 1}`,
        index: idx,
      }));

      const envDefaultKey =
        options.environment === "studio" && (selectedEnvDefaultKey || envDefaults[0]?.s3_key)
          ? selectedEnvDefaultKey || envDefaults[0]?.s3_key
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
      const lres = await fetch(`${baseUrl}/listing`, {
        method: "POST",
        body: lform,
        headers: withUserId({}, userId),
      });
      const listingPayload = await readJson(lres);
      if (listingPayload) applyUsageFromResponse(listingPayload);
      if (!lres.ok) {
        if (lres.status === 402) {
          showQuotaToast();
          toast.error("Quota exceeded. Upgrade to continue.", { id: toastId });
          return;
        }
        throw new Error(
          listingPayload?.error || listingPayload?.detail || "Failed to create listing"
        );
      }
      const listingId = listingPayload?.id;
      if (!listingId) throw new Error("No listing id");
      broadcastListingsUpdated();

      let done = 0;
      toast.loading(`Generating images ${done}/${poseSlots.length}…`, { id: toastId });
      const initialStatus = {};
      for (const slot of poseSlots) initialStatus[slot.key] = "queued";
      setPoseStatus(initialStatus);
      setPoseErrors({});

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

      const runPose = async ({ key, index: slotIndex }) => {
        const common = buildCommonForm(slotIndex);
        const prompt = buildPrompt(slotIndex);
        const classicReq = async () => {
          const f = cloneForm(common);
          f.append("prompt_override", prompt);
          const res = await fetch(`${baseUrl}/edit/json`, {
            method: "POST",
            body: f,
            headers: withUserId({}, userId),
          });
          const payload = await readJson(res);
          if (payload) applyUsageFromResponse(payload);
          if (!res.ok) {
            if (res.status === 402) throw quotaError(payload);
            throw new Error(payload?.error || payload?.detail || "Generation failed");
          }
          return payload;
        };
        const seqReq = async () => {
          const f = cloneForm(common);
          const res = await fetch(`${baseUrl}/edit/sequential/json`, {
            method: "POST",
            body: f,
            headers: withUserId({}, userId),
          });
          const payload = await readJson(res);
          if (payload) applyUsageFromResponse(payload);
          if (!res.ok) {
            if (res.status === 402) throw quotaError(payload);
            throw new Error(payload?.error || payload?.detail || "Generation failed");
          }
          return payload;
        };
        const requests = [];
        if (flowMode === "classic") requests.push(classicReq());
        else if (flowMode === "sequential") requests.push(seqReq());
        else {
          requests.push(classicReq(), seqReq());
        }
        const results = await Promise.all(
          requests.map((promise) =>
            promise
              .then((value) => ({ ok: true, value }))
              .catch((error) => ({ ok: false, error }))
          )
        );
        const ok = results.find((entry) => entry.ok);
        if (ok) return ok.value;
        const message = results
          .map((entry) => entry.error?.message || "Failed")
          .join("; ");
        throw new Error(message || `Pose ${slotIndex + 1} failed`);
      };

      let quotaHit = false;
      for (let idx = 0; idx < poseSlots.length; idx += 1) {
        const slot = poseSlots[idx];
        if (quotaHit) {
          setPoseStatus((s) => ({ ...s, [slot.key]: "blocked" }));
          continue;
        }
        setPoseStatus((s) => ({ ...s, [slot.key]: "running" }));
        try {
          await runPose(slot);
          done += 1;
          toast.loading(`Generating images ${done}/${poseSlots.length}…`, { id: toastId });
          setPoseStatus((s) => ({ ...s, [slot.key]: "done" }));
        } catch (error) {
          if (error?.code === "QUOTA_EXCEEDED") {
            quotaHit = true;
            if (error.payload) applyUsageFromResponse(error.payload);
            showQuotaToast();
            setPoseStatus((s) => ({ ...s, [slot.key]: "blocked" }));
            for (let next = idx + 1; next < poseSlots.length; next += 1) {
              const nextSlot = poseSlots[next];
              setPoseStatus((s) => ({ ...s, [nextSlot.key]: "blocked" }));
            }
            toast.error("Quota exceeded. Upgrade to continue.", { id: toastId });
            break;
          }
          setPoseStatus((s) => ({ ...s, [slot.key]: "error" }));
          setPoseErrors((prev) => ({ ...prev, [slot.key]: error?.message || "Failed" }));
        }
      }

      if (quotaHit) return;

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
          await fetch(`${baseUrl}/describe`, {
            method: "POST",
            body: dform,
            headers: withUserId({}, userId),
          });
        } catch {}
      }

      toast.success("Listing ready!", { id: toastId });
      window.location.href = `/listing/${listingId}`;
    } catch (err) {
      console.error(err);
      toast.error(err?.message || "Generation failed. Check backend/API key.");
    } finally {
      setIsGenerating(false);
    }
  }, [
    applyUsageFromResponse,
    computeEffectivePrompt,
    desc,
    descEnabled,
    envDefaults,
    flowMode,
    garmentType,
    isBillingEnabled,
    modelDefaults,
    options,
    plannedImagesCount,
    productCondition,
    promptDirty,
    promptInput,
    resolvePoseInstruction,
    selectedEnvDefaultKey,
    selectedFile,
    showQuotaToast,
    title,
    usage?.remaining,
    useModelImage,
    userId,
  ]);

  return {
    isGenerating,
    poseStatus,
    poseErrors,
    handleGenerate,
  };
}
