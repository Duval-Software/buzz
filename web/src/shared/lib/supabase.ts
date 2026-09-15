import { createClient } from "@supabase/supabase-js";

/** Opt-in per deployment. A missing configuration must never enable legacy fallback. */
export const managedAccountsEnabled =
  import.meta.env.VITE_MANAGED_ACCOUNTS === "true";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const supabase =
  managedAccountsEnabled && url && key
    ? createClient(url, key, {
        auth: {
          flowType: "pkce",
          detectSessionInUrl: true,
          persistSession: true,
          autoRefreshToken: true,
        },
      })
    : null;
