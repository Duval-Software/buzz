import { expect, test } from "@playwright/test";
import { waitForAnimations } from "../../../desktop/tests/helpers/animations";
import { installCommunityFixture } from "../helpers/community";

for (const width of [1440, 390]) {
  for (const feed of [false, true]) {
    test(`${feed ? "feed" : "chat"} skeletons resolve into content at ${width}px`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({
        colorScheme: width === 1440 ? "dark" : "light",
      });
      let releaseContent!: () => void;
      let releaseMedia!: () => void;
      const contentReady = new Promise<void>((resolve) => {
        releaseContent = resolve;
      });
      const mediaReady = new Promise<void>((resolve) => {
        releaseMedia = resolve;
      });
      await installCommunityFixture(page, "Loaded conversation", {
        contentReady,
        pulseEvents: [
          {
            id: "fa".repeat(32),
            content: "Loaded update",
            tags: [
              [
                "imeta",
                `url https://chat.creatorhive.ai/media/${"ab".repeat(32)}.png`,
                "m image/png",
              ],
            ],
          },
        ],
      });
      await page.route("**/media/*.png", async (route) => {
        await mediaReady;
        await route.fallback();
      });
      await page.goto(feed ? "/pulse" : "/chat?channel=markdown");
      const skeleton = page.getByRole("status", {
        name: feed ? "Loading updates" : "Loading conversation",
        exact: true,
      });
      await expect(skeleton).toBeVisible();
      await expect(skeleton).toHaveAttribute("aria-busy", "true");
      await expect(skeleton.locator(".hive-skeleton-message")).toHaveCount(3);
      await expect(skeleton.getByRole("button")).toHaveCount(0);
      await expect(skeleton.locator(".hive-skeleton").first()).toHaveCSS(
        "animation-name",
        "hive-skeleton-shimmer",
      );
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(skeleton.locator(".hive-skeleton").first()).toHaveCSS(
        "animation-name",
        "none",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await waitForAnimations(page);
      await page.screenshot({ path: info.outputPath("skeleton.png") });
      if (width === 390)
        await page
          .getByRole("button", {
            name: feed ? "Open community navigation" : "Channels",
            exact: true,
          })
          .click();
      await expect(
        page.getByRole("status", { name: "Loading channels", exact: true }),
      ).toBeVisible();
      if (width === 390) await page.keyboard.press("Escape");
      releaseContent();
      await expect(skeleton).toHaveCount(0);
      await expect(
        page.getByText(feed ? "Loaded update" : "Loaded conversation", {
          exact: true,
        }),
      ).toBeVisible();
      const attachment = page.getByRole("status", {
        name: "Loading attachment",
        exact: true,
      });
      await expect(attachment).toBeVisible();
      await expect(attachment).toHaveClass(/hive-skeleton/);
      releaseMedia();
      await expect(attachment).toHaveCount(0);
      await expect
        .poll(() =>
          page
            .getByRole("img", { name: "attachment", exact: true })
            .evaluate((img: HTMLImageElement) => img.naturalWidth),
        )
        .toBeGreaterThan(0);
    });
  }
}

test("routes and video load on demand with recoverable loading states", async ({
  page,
}, testInfo) => {
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
      /\/(pulse-|live-|agents-|workflows-|VideoPanel-|StageWatch-|livekit-client|use-local-media-)/.test(
        url,
      ),
    ),
  ).toBe(false);
  await page.getByRole("link", { name: "Pulse", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Loading CreatorHive…" }),
  ).toBeVisible();
  const logo = page.locator(".hive-loading-emblem img");
  await expect(logo).toBeVisible();
  await expect
    .poll(() => logo.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(logo).toHaveCSS("animation-name", "none");
  await expect(page.locator(".hive-loading-trace")).toHaveCSS(
    "animation-name",
    "none",
  );
  await waitForAnimations(page);
  await page.screenshot({ path: testInfo.outputPath("loading-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(logo).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await waitForAnimations(page);
  await page.screenshot({ path: testInfo.outputPath("loading-mobile.png") });
  await page.setViewportSize({ width: 1280, height: 720 });
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
  expect(
    scripts.some((url) => /\/(?:livekit-client|use-local-media)/.test(url)),
  ).toBe(true);
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
