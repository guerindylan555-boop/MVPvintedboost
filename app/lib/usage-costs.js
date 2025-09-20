import rawCosts from "@/shared/usage_costs.json" assert { type: "json" };

const COSTS = Object.freeze({ ...rawCosts });

export const USAGE_COSTS = COSTS;

export function getUsageCost(key, fallback = 1) {
  const value = COSTS?.[key];
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function getListingCreationCost(imageCount = 1) {
  const base = getUsageCost("listing_create", 1);
  const perImage = getUsageCost("listing_image", 1);
  return base + Math.max(0, imageCount) * perImage;
}

export function getEnvironmentCost() {
  return getUsageCost("studio_environment", 1);
}

export function getModelCost() {
  return getUsageCost("studio_model", 1);
}
