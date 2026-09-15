import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/managed",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4174", screenshot: "only-on-failure" },
  webServer: {
    command:
      "pnpm exec vite build --outDir /tmp/creatorhive-managed-preview && pnpm exec vite preview --outDir /tmp/creatorhive-managed-preview --host 127.0.0.1 --port 4174 --strictPort",
    env: {
      VITE_MANAGED_ACCOUNTS: "true",
      VITE_SUPABASE_URL: "https://creatorhive-auth-test.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only",
    },
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
  },
});
