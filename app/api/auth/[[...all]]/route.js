import { toNextJsHandler } from "better-auth/next-js";
import { auth, migrateIfNeeded } from "@/app/lib/auth";

export const { GET, POST } = toNextJsHandler(async (req) => {
  await migrateIfNeeded();
  return auth(req);
});
