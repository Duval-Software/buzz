import { expect, test } from "@playwright/test";
import { installCommunityFixture } from "../helpers/community";
import { toggleLocalDevice } from "../../src/features/video/use-local-media";
import {
  profileDraft,
  restoreProfileDraft,
} from "../../src/features/profile/profile-draft";
import type { PublicProfile } from "../../src/features/profile/public-profile";
import { waitForAnimations } from "../../../desktop/tests/helpers/animations";

test("device toggles remain independent and surface permission rejection", async () => {
  const calls: string[] = [];
  const participant = {
    isCameraEnabled: false,
    isMicrophoneEnabled: false,
    isScreenShareEnabled: true,
    setCameraEnabled: async (enabled: boolean) => {
      calls.push(`camera:${enabled}`);
      return undefined;
    },
    setMicrophoneEnabled: async (enabled: boolean) => {
      calls.push(`mic:${enabled}`);
      return undefined;
    },
    setScreenShareEnabled: async (enabled: boolean) => {
      calls.push(`screen:${enabled}`);
      return undefined;
    },
  };
  await toggleLocalDevice(participant, "camera");
  expect(calls).toEqual(["camera:true"]);
  await toggleLocalDevice(participant, "screen");
  expect(calls).toEqual(["camera:true", "screen:false"]);
  participant.setMicrophoneEnabled = async () => {
    throw new Error("Permission denied");
  };
  await expect(toggleLocalDevice(participant, "microphone")).rejects.toThrow(
    "Permission denied",
  );
});

test("draft recovery rejects malformed data and cannot replace server identity or access", () => {
  const profile: PublicProfile = {
    username: "builder",
    display_name: "Builder",
    bio: "",
    interests: [],
    accent: "honey",
    collaborating: false,
    links: [],
    highlights: [],
    avatar: null,
    cover: null,
    visibility: "members",
    published: false,
    publication_enabled: false,
    owner: true,
  };
  for (const draft of [
    "{",
    "null",
    JSON.stringify({ ...profileDraft(profile), links: [null] }),
  ])
    expect(restoreProfileDraft(profile, draft)).toBe(profile);
  const restored = restoreProfileDraft(
    profile,
    JSON.stringify({
      ...profileDraft(profile),
      bio: "My restored bio",
      username: "someone_else",
      owner: false,
      publication_enabled: true,
      published: true,
    }),
  );
  expect(restored).toMatchObject({
    bio: "My restored bio",
    username: "builder",
    owner: true,
    publication_enabled: false,
    published: false,
  });
});

test("mobile navigation contains focus and restores its opener", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installCommunityFixture(page);
  await page.goto("/chat?channel=markdown");
  const opener = page.getByRole("button", { name: "Channels", exact: true });
  await opener.click();
  const drawer = page.getByRole("dialog", { name: "Community navigation" });
  await expect(drawer).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({ path: info.outputPath("navigation-mobile.png") });
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    // Native dialogs allow focus to leave the document for browser chrome, never covered app controls.
    expect(
      await drawer.evaluate(
        (el) =>
          el.matches(":modal") &&
          (document.activeElement === document.body ||
            el.contains(document.activeElement)),
      ),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
  await expect(opener).toBeFocused();
  await page.keyboard.press("Tab");
  expect(
    await page
      .locator(".hive-navigation-dialog")
      .evaluate((el) => el.contains(document.activeElement)),
  ).toBe(false);
});

test("search recovers from refusal and opens an older reply in its thread", async ({
  page,
}) => {
  const root = "a1".repeat(32);
  const reply = "b2".repeat(32);
  await installCommunityFixture(page, undefined, {
    searchRefusals: 1,
    chatEvents: [
      {
        id: root,
        content: "Earlier project discussion",
        tags: [["h", "markdown"]],
        linkedOnly: true,
      },
      {
        id: reply,
        content: "The answer from last month",
        tags: [
          ["h", "markdown"],
          ["e", root, "", "root"],
          ["e", root, "", "reply"],
        ],
        linkedOnly: true,
      },
    ],
  });
  await page.goto("/chat?channel=markdown");
  await expect(page.getByText("The answer from last month")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Search the Hive", exact: true })
    .click();
  const search = page.getByRole("dialog", {
    name: "Search the hive",
    exact: true,
  });
  await search.getByRole("textbox", { name: "Search messages" }).fill("answer");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(search.getByRole("alert")).toContainText(
    "could not be completed",
  );
  await expect(search.getByText(/Nothing matched/)).toHaveCount(0);
  await search.getByRole("button", { name: "Retry search" }).click();
  await search
    .getByRole("button", { name: /The answer from last month/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`event=${reply}`));
  await expect(
    page.getByRole("heading", { name: "Thread", exact: true }),
  ).toBeVisible();
  const target = page.locator(`[data-message-id="${reply}"]`);
  await expect(target).toBeFocused();
  await expect(target).toContainText("The answer from last month");
});

test("missing links give a recovery state and never silently open another channel", async ({
  page,
}) => {
  await installCommunityFixture(page);
  await page.goto(`/chat?channel=missing&event=${"c3".repeat(32)}`);
  await expect(page.getByRole("alert")).toContainText(
    "This channel is unavailable",
  );
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeDisabled();
  await page.goto(`/chat?channel=markdown&event=${"c3".repeat(32)}`);
  await expect(page.getByRole("alert")).toContainText(
    "This message is unavailable",
  );
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible();
});

test("composers preserve multiline drafts and submit only on unmodified Enter", async ({
  page,
}) => {
  const fixture = await installCommunityFixture(page);
  await page.goto("/chat?channel=markdown");
  const composer = page.getByRole("textbox", { name: "Message #markdown" });
  await composer.fill("First line");
  await composer.press("Shift+Enter");
  await composer.pressSequentially("Second line");
  await expect(composer).toHaveValue("First line\nSecond line");
  expect(fixture.published.filter((event) => event.kind === 9)).toHaveLength(0);
  await page.reload();
  await expect(composer).toHaveValue("First line\nSecond line");
  await composer.press("Enter");
  await expect
    .poll(() => fixture.published.filter((event) => event.kind === 9))
    .toHaveLength(1);
  expect(fixture.published.find((event) => event.kind === 9)?.content).toBe(
    "First line\nSecond line",
  );
  await expect(composer).toHaveValue("");
});

test("notifications describe missing configuration and announcements respect posting access", async ({
  page,
}) => {
  await installCommunityFixture(page, "", {
    noMessages: true,
    role: "member",
    policy: "admins",
    channelName: "announcements",
  });
  await page.goto("/chat?channel=markdown");
  await expect(
    page.getByRole("heading", { name: "You’re up to date." }),
  ).toBeVisible();
  await expect(
    page.getByText("Only channel owners and admins can post.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: /Message #/ })).toHaveCount(0);
  await page.getByRole("button", { name: /^Account/ }).click();
  await expect(
    page.getByText(
      /Notifications (aren’t available in this community yet|are blocked for this site)/,
    ),
  ).toBeVisible();
  await expect(
    page.getByText("This browser cannot do push notifications."),
  ).toHaveCount(0);
});

test("deleted message links stay removed and Inbox opens the selected Pulse update", async ({
  page,
}) => {
  const removed = "d4".repeat(32);
  const update = "e5".repeat(32);
  await installCommunityFixture(page, undefined, {
    chatEvents: [
      {
        id: removed,
        content: "Deleted message body",
        tags: [["h", "markdown"]],
        linkedOnly: true,
      },
      {
        id: "f6".repeat(32),
        kind: 5,
        content: "",
        tags: [
          ["h", "markdown"],
          ["e", removed],
        ],
        linkedOnly: true,
      },
    ],
    pulseEvents: [
      {
        id: update,
        content: "The specific update mentioned in Inbox",
        tags: [],
      },
    ],
  });
  await page.goto(`/chat?channel=markdown&event=${removed}`);
  await expect(page.getByRole("alert")).toContainText("no longer available");
  await expect(page.getByText("Deleted message body")).toHaveCount(0);
  await page.goto("/inbox");
  await page
    .getByRole("button", { name: /The specific update mentioned in Inbox/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`update=${update}`));
  await expect(page.locator(`[data-update-id="${update}"]`)).toBeFocused();
  await page.getByRole("button", { name: "← Back to all updates" }).click();
  await expect(page).toHaveURL(/\/pulse$/);
});
