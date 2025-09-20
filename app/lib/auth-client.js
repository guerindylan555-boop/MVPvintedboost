"use client";

import { createAuthClient } from "better-auth/react";
import { polarClient } from "@polar-sh/better-auth";

const clientPlugins = [polarClient()];

export const authClient = createAuthClient({
  plugins: clientPlugins,
});
