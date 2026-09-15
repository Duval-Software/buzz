import { test, expect } from "@playwright/test";
import { waitForAnimations } from "../../../desktop/tests/helpers/animations";

// Start the reference service with its preview env before running this optional check.
test("reference app renders and starts a bounded PKCE flow", async ({
  page,
  request,
}) => {
  test.skip(
    !process.env.SSO_PREVIEW_URL,
    "requires a separately running reference app",
  );
  const base = process.env.SSO_PREVIEW_URL as string;
  await page.goto(base);
  await expect(
    page.getByRole("link", { name: "Sign in with CreatorHive" }),
  ).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/sso-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/sso-mobile.png" });
  const response = await request.get(`${base}/login`, { maxRedirects: 0 });
  expect(response.status()).toBe(303);
  const target = new URL(response.headers().location);
  expect(target.pathname).toBe("/auth/v1/oauth/authorize");
  expect(target.searchParams.get("code_challenge_method")).toBe("S256");
  expect(target.searchParams.get("scope")).toBe("openid email profile");
  expect(target.searchParams.get("redirect_uri")).toBe(`${base}/callback`);
  expect(target.searchParams.get("state")).toBeTruthy();
  expect(target.searchParams.get("nonce")).toBeTruthy();
  await page.goto(`${base}/callback?state=forged&code=forged`);
  await expect(
    page.getByRole("heading", { name: "Please sign in again" }),
  ).toBeVisible();
});
