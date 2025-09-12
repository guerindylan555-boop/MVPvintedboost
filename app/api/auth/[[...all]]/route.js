import { toNextJsHandler } from "better-auth/next-js";
import { auth, migrateIfNeeded } from "@/app/lib/auth";

export const { GET, POST } = toNextJsHandler({
  async handler(req) {
    await migrateIfNeeded();
    return auth.handler(req);
  },
});
