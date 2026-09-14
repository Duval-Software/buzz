import { expect, test } from "@playwright/test";
import { installCommunityFixture } from "../helpers/community";

test("routes and video load on demand with recoverable loading states", async ({
  page,
}) => {
  await installCommunityFixture(page);
  const scripts: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script")
      scripts.push(new URL(request.url()).pathname);
  });
  let releasePulse!: () => void;
  const pulsePending = new Promise<void>((resolve) => {
    releasePulse = resolve;
  });
  await page.route("**/assets/pulse-*.js", async (route) => {
    await pulsePending;
    await route.continue();
  });
  await page.goto("/chat?channel=markdown");
  await expect(
    page.getByRole("textbox", { name: "Message #markdown" }),
  ).toBeVisible();
  expect(
    scripts.some((url) =>
      /\/(pulse-|live-|agents-|workflows-|VideoPanel-|StageWatch-|livekit-client)/.test(
        url,
      ),
    ),
  ).toBe(false);
  await page.getByRole("link", { name: "Pulse", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Loading CreatorHive…" }),
  ).toBeVisible();
  releasePulse();
  await expect(
    page.getByRole("heading", { name: "Pulse", exact: true }),
  ).toBeVisible();
  expect(scripts.some((url) => /\/pulse-/.test(url))).toBe(true);
  await page.goBack();
  await expect(
    page.getByRole("textbox", { name: "Message #markdown" }),
  ).toBeVisible();
  let releaseVideo!: () => void;
  const videoPending = new Promise<void>((resolve) => {
    releaseVideo = resolve;
  });
  await page.route("**/assets/VideoPanel-*.js", async (route) => {
    await videoPending;
    await route.continue();
  });
  await page.getByRole("button", { name: "Video", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Loading video…" }),
  ).toBeVisible();
  releaseVideo();
  await expect(
    page.getByRole("button", { name: "Join #markdown video" }),
  ).toBeVisible();
  expect(scripts.some((url) => /\/livekit-client/.test(url))).toBe(true);
  await page.getByRole("button", { name: "Hide video", exact: true }).click();
  await page.getByRole("button", { name: "The Lounge", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Leave", exact: true }),
  ).toBeVisible();
  expect(scripts.some((url) => /\/StageWatch-/.test(url))).toBe(true);
  await page.getByRole("button", { name: "Leave", exact: true }).click();
});

test("a failed route chunk offers reload recovery", async ({ page }) => {
  await installCommunityFixture(page);
  await page.route("**/assets/pulse-*.js", (route) => route.abort("failed"));
  await page.goto("/pulse");
  await expect(page.getByRole("alert")).toContainText(
    "This page couldn’t load",
  );
  await page.unroute("**/assets/pulse-*.js");
  await page.getByRole("button", { name: "Reload page", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Pulse", exact: true }),
  ).toBeVisible();
});
