const BASE_PLANS = [
  {
    key: "starter",
    defaultName: "Starter",
    defaultPrice: "$19/mo",
    defaultAllowance: 30,
    defaultTagline: "Launch your first AI listings",
    defaultFeatures: (allowance) => [
      `${allowance} AI generations each month`,
      "Download-ready PNG exports",
      "Community support",
    ],
  },
  {
    key: "pro",
    defaultName: "Pro",
    defaultPrice: "$59/mo",
    defaultAllowance: 120,
    defaultTagline: "Scale with faster turnarounds",
    defaultFeatures: (allowance) => [
      `${allowance} AI generations each month`,
      "Priority processing queue",
      "Email support",
    ],
  },
  {
    key: "scale",
    defaultName: "Scale",
    defaultPrice: "Contact us",
    defaultAllowance: 300,
    defaultTagline: "Custom limits for growing teams",
    defaultFeatures: () => [
      "Custom monthly allowance",
      "Shared workspace seats",
      "Dedicated success manager",
    ],
  },
];

function env(name) {
  return process.env[name];
}

function parseIntEnv(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return fallback;
}

function parseFeatures(raw, fallback) {
  if (typeof raw !== "string") return fallback;
  const items = raw
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}

function resolvePlan(base) {
  const prefix = `NEXT_PUBLIC_POLAR_PLAN_${base.key.toUpperCase()}`;
  const id = env(`${prefix}_ID`) || env(`${prefix}_PLAN_ID`) || null;
  const name = env(`${prefix}_NAME`) || base.defaultName;
  const price = env(`${prefix}_PRICE`) || base.defaultPrice;
  const tagline = env(`${prefix}_TAGLINE`) || base.defaultTagline;
  const allowance = parseIntEnv(env(`${prefix}_ALLOWANCE`), base.defaultAllowance);
  const features = parseFeatures(
    env(`${prefix}_FEATURES`),
    typeof base.defaultFeatures === "function"
      ? base.defaultFeatures(allowance)
      : base.defaultFeatures
  );

  return {
    key: base.key,
    id,
    name,
    price,
    allowance,
    tagline,
    features,
    isAvailable: Boolean(id),
  };
}

export function getSubscriptionPlans() {
  return BASE_PLANS.map(resolvePlan);
}

