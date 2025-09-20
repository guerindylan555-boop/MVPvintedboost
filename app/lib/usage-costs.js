import usageRules from "@/shared/usage-rules.json";

function normalizeOperations(raw) {
  if (!raw || typeof raw !== "object") return {};
  const entries = Object.entries(raw);
  const result = {};
  for (const [key, value] of entries) {
    if (!value || typeof value !== "object") continue;
    const cost = Number.parseFloat(value.cost);
    if (!Number.isFinite(cost) || cost < 0) continue;
    result[key] = {
      key,
      label: typeof value.label === "string" && value.label ? value.label : key,
      description:
        typeof value.description === "string" && value.description
          ? value.description
          : undefined,
      cost,
    };
  }
  return result;
}

const RAW_PRECISION = Number.isFinite(usageRules?.precision)
  ? Number(usageRules.precision)
  : 0;
export const USAGE_PRECISION = RAW_PRECISION >= 0 ? Math.floor(RAW_PRECISION) : 0;
export const USAGE_OPERATION_MAP = normalizeOperations(usageRules?.operations);

export function getUsageCosts() {
  const map = USAGE_OPERATION_MAP;
  const costs = {};
  for (const key of Object.keys(map)) {
    costs[key] = map[key].cost;
  }
  return costs;
}

export function getUsageOperations() {
  return Object.values(USAGE_OPERATION_MAP);
}
