import { expect, test } from "@playwright/test";
import { nip19 } from "nostr-tools";
import { generateSecretKey } from "nostr-tools/pure";
import { waitForAnimations } from "../../../desktop/tests/helpers/animations";
import {
  actions,
  embedUrl,
  initialStudio,
  studioReducer,
} from "../../src/features/live/sample-studio";

test("sample service preserves balances, queue rules, and approved identifiers", () => {
  const now = 1000;
  const queue = { type: "queue", id: "amber", now, fail: false } as const;
  let state = studioReducer(initialStudio, queue);
  expect([state.points, state.credits]).toEqual([180, 3]);
  expect(state.queue?.id).toBe("amber");
  expect(studioReducer(state, queue).points).toBe(180);
  expect(
    studioReducer(state, { type: "settle", now: 2000 }).queue,
  ).not.toBeNull();
  state = studioReducer(state, { type: "settle", now: 4000 });
  expect(state.queue).toBeNull();
  expect(state.message).toContain("complete");
  expect(studioReducer(state, { ...queue, now: 5000 }).message).toContain(
    "cooling down",
  );
  expect(
    studioReducer(state, { ...queue, id: "challenge", now: 21000 }).message,
  ).toContain("Not enough points");
  state = studioReducer(state, {
    ...queue,
    id: "water",
    now: 21000,
    fail: true,
  });
  state = studioReducer(state, { type: "settle", now: 24000 });
  expect([state.points, state.credits]).toEqual([180, 3]);
  expect(state.message).toContain("failed");
  state = studioReducer(state, { ...queue, id: "water", now: 41000 });
  state = studioReducer(state, { type: "pause" });
  expect([state.points, state.credits, state.queue]).toEqual([180, 3, null]);
  expect(studioReducer(state, { ...queue, now: 61000 }).message).toContain(
    "paused",
  );
  expect(studioReducer(state, { type: "settle", now: 99999 })).toEqual(state);
  expect(
    studioReducer(initialStudio, { ...queue, id: "unapproved" }).points,
  ).toBe(300);
  expect(
    studioReducer({ ...initialStudio, credits: 0 }, queue).message,
  ).toContain("No interaction credits");
  expect(
    studioReducer({ ...initialStudio, points: 0 }, queue).message,
  ).toContain("Not enough points");
  const vote = { type: "vote", id: "replay" } as const;
  state = studioReducer(initialStudio, vote);
  expect(state.votes).toBe(2);
  expect(studioReducer(state, vote).votes).toBe(2);
  expect(studioReducer({ ...initialStudio, votes: 0 }, vote).message).toContain(
    "No vote credits",
  );
  expect(studioReducer(initialStudio, { ...vote, id: "unknown" }).votes).toBe(
    3,
  );
  expect(actions.map((action) => action.id)).toEqual([
    "amber",
    "chime",
    "wave",
    "challenge",
    "camera",
    "water",
  ]);
  expect(embedUrl("youtube", "M7lc1UVf-VE", "localhost")).toContain(
    "youtube-nocookie.com/embed/M7lc1UVf-VE",
  );
  const twitch = new URL(
    embedUrl("twitch", "twitch", "app.creatorhive.ai") ?? "",
  );
  expect(twitch.searchParams.get("parent")).toBe("app.creatorhive.ai");
  for (const invalid of ["", "https://example.com", "<script>", "../test"]) {
    expect(embedUrl("youtube", invalid, "localhost")).toBeNull();
    expect(embedUrl("twitch", "twitch", invalid)).toBeNull();
  }
});

test.describe("member Live experience", () => {
  test.beforeEach(async ({ page }) => {
    // Test-only identity and relay. Never enrolls a member or sends a live event.
    await page.addInitScript(
      (nsec) => localStorage.setItem("buzz.identity.nsec", nsec),
      nip19.nsecEncode(generateSecretKey()),
    );
    await page.routeWebSocket(/.*/, (socket) => {
      socket.onMessage((raw) => {
        const [kind, data] = JSON.parse(String(raw));
        if (kind === "AUTH")
          socket.send(JSON.stringify(["OK", data.id, true, ""]));
        if (kind === "REQ") socket.send(JSON.stringify(["EOSE", data]));
      });
      socket.send(JSON.stringify(["AUTH", "local-test-challenge"]));
    });
    await page.route("https://stage.creatorhive.ai/**", (route) =>
      route.fulfill({ json: { rooms: [], session: "test" } }),
    );
    await page.goto("/live");
    await expect(
      page.getByRole("heading", { name: "CreatorHive Live", exact: true }),
    ).toBeVisible();
  });

  test("direct route, navigation, voting, and terminal", async ({ page }) => {
    await page
      .getByRole("button", {
        name: "Vote for Replay the moment it shipped",
        exact: true,
      })
      .click();
    await expect(page.locator(".hive-live").getByRole("status")).toContainText(
      "Vote counted",
    );
    await expect(
      page.getByRole("button", {
        name: "Voted for Replay the moment it shipped",
      }),
    ).toBeDisabled();
    await page.getByRole("button", { name: /01 On the workbench/ }).click();
    await expect(page.getByRole("log")).toContainText("Private values removed");
    await expect(
      page.getByRole("log").locator("input,textarea,[contenteditable]"),
    ).toHaveCount(0);
    await page
      .getByRole("link", { name: "CreatorHive home", exact: true })
      .click();
    await page.getByRole("link", { name: "Live studio", exact: true }).click();
    await expect(page).toHaveURL(/\/live/);
    await expect(
      page.getByRole("heading", { name: "CreatorHive Live", exact: true }),
    ).toBeVisible();
  });

  test("queues, cooldown, insufficient balance, failure refund, and kill switch", async ({
    page,
  }) => {
    await page.clock.install();
    await page
      .getByRole("button", { name: "Studio controls", exact: true })
      .click();
    const lights = page.getByRole("button", { name: /Hive lights Amber/ });
    await lights.click();
    await expect(page.locator(".hive-live").getByRole("status")).toContainText(
      "queued",
    );
    await expect(
      page.getByRole("complementary", { name: "Your studio membership" }),
    ).toContainText("180");
    await expect(lights).toBeDisabled();
    await page.clock.fastForward(4000);
    await expect(page.locator(".hive-live").getByRole("status")).toContainText(
      "complete",
    );
    await expect(lights).toBeDisabled();
    await page.clock.fastForward(17000);
    await page.getByRole("button", { name: /Challenge wheel/ }).click();
    await expect(page.locator(".hive-live").getByRole("status")).toContainText(
      "Not enough points",
    );
    await page.locator("#live-preview-tools > summary").click();
    await page.getByLabel("Simulate action failure").check();
    await page.getByRole("button", { name: /Water break/ }).click();
    await page.clock.fastForward(4000);
    await expect(page.locator(".hive-live").getByRole("status")).toContainText(
      "failed. Points and credit returned",
    );
    await page.getByText("Simulate staff controls", { exact: true }).click();
    await page
      .getByRole("button", { name: "Pause all preview actions" })
      .click();
    await expect(lights).toBeDisabled();
    await page.getByRole("button", { name: "Resume preview studio" }).click();
    await page.getByRole("button", { name: "Try empty balances" }).click();
    await page
      .getByRole("button", { name: "Shape the build", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Vote for A shared build notebook",
        exact: true,
      })
      .click();
    await expect(page.locator(".hive-live").getByRole("status")).toContainText(
      "No vote credits",
    );
  });

  test("upcoming, offline, live, validated YouTube and Twitch embeds", async ({
    page,
  }) => {
    // Provider content is isolated so the test is deterministic; real playback is manual QA.
    await page.route(
      /https:\/\/(www.youtube-nocookie.com|player.twitch.tv)\/.*/,
      (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<p>Provider fixture</p>",
        }),
    );
    await expect(
      page.getByRole("heading", { name: "The next build starts with you." }),
    ).toBeVisible();
    await page.locator("#live-preview-tools > summary").click();
    await page.getByLabel("Broadcast state").selectOption("offline");
    await expect(
      page.getByRole("heading", { name: "The stream ends. The ideas don’t." }),
    ).toBeVisible();
    await page.getByLabel("Broadcast state").selectOption("live");
    await page.getByLabel("YouTube video ID").fill("invalid");
    await expect(page.locator("iframe")).toHaveCount(0);
    await page.getByLabel("YouTube video ID").fill("M7lc1UVf-VE");
    await expect(page.getByTitle("YouTube livestream")).toHaveAttribute(
      "src",
      /youtube-nocookie.com\/embed\/M7lc1UVf-VE/,
    );
    await page
      .getByRole("combobox", { name: "Player", exact: true })
      .selectOption("twitch");
    await page.getByLabel("Twitch channel").fill("twitch");
    await page.getByLabel("Twitch parent hostname").fill("localhost");
    await expect(page.getByTitle("Twitch livestream")).toHaveAttribute(
      "src",
      /channel=twitch&parent=localhost/,
    );
    await page.getByLabel("Twitch parent hostname").fill("https://localhost");
    await expect(page.locator("iframe")).toHaveCount(0);
    await page.getByLabel("Broadcast state").selectOption("upcoming");
    await expect(page.locator("iframe")).toHaveCount(0);
  });

  test("responsive layouts, keyboard access, and membership copy", async ({
    page,
  }, testInfo) => {
    for (const width of [390, 768, 1280, 1920]) {
      await page.setViewportSize({ width, height: 844 });
      const player = await page.locator(".live-player").boundingBox();
      expect(player?.y).toBeLessThan(210);
      const canvas = await page.locator(".hive-live").boundingBox();
      expect(player?.width).toBeGreaterThan((canvas?.width ?? width) * 0.55);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await waitForAnimations(page);
      await page.screenshot({ path: testInfo.outputPath(`live-${width}.png`) });
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Membership", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("$99", { exact: false })).toBeVisible();
    await expect(
      page.getByText("Monthly studio credits for approved interactions"),
    ).toBeVisible();
    await expect(page.locator(".hive-live")).not.toContainText(
      /shock|treadmill/i,
    );
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page
        .getByRole("button", { name: "Studio controls", exact: true })
        .click();
      await waitForAnimations(page);
      await page
        .locator(".live-panel")
        .screenshot({ path: testInfo.outputPath(`studio-${width}.png`) });
    }
  });
});

test("production preview parameter cannot bypass membership", async ({
  page,
}) => {
  await page.goto("/live?preview=1");
  await expect(
    page.getByRole("heading", { name: "Welcome back to the Hive" }),
  ).toBeVisible();
});
