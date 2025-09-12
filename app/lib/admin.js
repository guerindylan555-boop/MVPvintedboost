export function parseAllowedEmails() {
  const raw = process.env.ADMIN_ALLOWED_EMAILS || "";
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function getAllowedDomain() {
  const domain = (process.env.ADMIN_ALLOWED_DOMAIN || "").trim().toLowerCase();
  return domain || undefined;
}

export function isAdminEmail(email) {
  if (!email) return false;
  const lower = email.toLowerCase();
  const emails = parseAllowedEmails();
  const domain = getAllowedDomain();

  // If no allowlist configured, allow any signed-in user
  if (emails.length === 0 && !domain) return true;

  if (emails.includes(lower)) return true;
  if (domain) {
    const endsWith = lower.endsWith("@" + domain);
    if (endsWith) return true;
  }
  return false;
}
