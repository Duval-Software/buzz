import { defineConfig } from "@playwright/test";

// Separate port/output avoids interrupting the main thread's managed-account tests.
export default defineConfig({
  testDir: "./tests/managed",
  testMatch: "public-profiles.spec.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4186", screenshot: "only-on-failure" },
  outputDir: "test-results/profiles-run",
  webServer: {
    command:
      "pnpm exec vite build --outDir /tmp/creatorhive-public-profile-preview && pnpm exec vite preview --outDir /tmp/creatorhive-public-profile-preview --host 127.0.0.1 --port 4186 --strictPort",
    env: {
      VITE_MANAGED_ACCOUNTS: "true",
      VITE_PUBLIC_PROFILES: "true",
      VITE_SUPABASE_URL: "https://creatorhive-auth-test.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only",
    },
    url: "http://127.0.0.1:4186",
    reuseExistingServer: false,
  },
});
