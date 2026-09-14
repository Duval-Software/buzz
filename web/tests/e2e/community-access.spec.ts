import { expect, test } from "@playwright/test";
import { installCommunityFixture } from "../helpers/community";
import { waitForAnimations } from "../../../desktop/tests/helpers/animations";
import { verifyEvent } from "nostr-tools/pure";

test("community owner reviews signed changes and receives actual relay errors", async ({
  page,
}, testInfo) => {
  const fixture = await installCommunityFixture(page, undefined, {
    role: "owner",
    denyCommands: true,
  });
  await page.goto("/community");
  await expect(page.getByText("Your community role:")).toContainText("owner");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await waitForAnimations(page);
    await page.screenshot({
      path: testInfo.outputPath(`community-settings-${width}-fixture.png`),
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Make admin", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(fixture.published.filter((event) => event.kind === 9032)).toHaveLength(
    0,
  );
  await page.getByRole("button", { name: "Confirm change" }).click();
  await expect(page.getByRole("alert")).toContainText("fixture denied");
  const command = fixture.published.find((event) => event.kind === 9032);
  expect(command?.tags).toEqual([
    ["p", fixture.builder],
    ["role", "admin"],
  ]);
  expect(verifyEvent(command as Parameters<typeof verifyEvent>[0])).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("link", { name: "CreatorHive home", exact: true })
    .click();
  await page.getByRole("button", { name: /Your profile/ }).click();
  await page
    .getByRole("link", { name: "Community settings", exact: true })
    .click();
  await expect(page).toHaveURL(/\/community$/);
});

test("admin grants ordinary access but cannot promote; success waits for relay", async ({
  page,
}) => {
  const fixture = await installCommunityFixture(page, undefined, {
    role: "admin",
  });
  await page.goto("/community");
  await expect(page.getByText("Your community role:")).toContainText("admin");
  await expect(
    page.getByRole("button", { name: "Make admin", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Community role").locator("option")).toHaveCount(
    1,
  );
  await page.route("**/api/accounts/resolve", (route) =>
    route.fulfill({
      json: { username: "new_member", pubkey: "dd".repeat(32) },
    }),
  );
  await page.getByLabel("Member username").fill("new_member");
  await page.getByRole("button", { name: "Review access" }).click();
  await page.getByRole("button", { name: "Confirm change" }).click();
  await expect(
    page.locator(".hive-community-settings").getByRole("status"),
  ).toContainText("relay accepted");
  expect(fixture.published.find((event) => event.kind === 9030)?.tags).toEqual([
    ["p", "dd".repeat(32)],
    ["role", "member"],
  ]);
});

for (const forgedRoster of [false, true])
  test(`ordinary/forged membership cannot grant admin UI (${forgedRoster})`, async ({
    page,
  }) => {
    await installCommunityFixture(page, undefined, {
      role: forgedRoster ? "owner" : "member",
      forgedRoster,
    });
    await page.goto("/community");
    await expect(
      page.getByText(
        forgedRoster
          ? "The relay did not provide a verified membership list."
          : "Only community owners and admins can manage access.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Review access" }),
    ).toHaveCount(0);
    if (!forgedRoster) {
      await expect(
        page.getByRole("heading", { name: "Community administrators" }),
      ).toBeVisible();
      await page.getByText("Builder · owner", { exact: true }).click();
      await expect(
        page.getByText("bb".repeat(32), { exact: true }),
      ).toBeVisible();
    }
  });

test("announcement readers retain history and reactions without composers", async ({
  page,
}) => {
  await installCommunityFixture(page, "Announcement fixture", {
    policy: "admins",
    role: "guest",
    supportsPolicy: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/chat?channel=markdown");
  await expect(page.getByText("Announcement fixture")).toBeVisible();
  await expect(
    page.getByText("Announcements · Only channel owners"),
  ).toBeVisible();
  await expect(page.getByPlaceholder("Message #markdown")).toHaveCount(0);
  await page.getByRole("button", { name: /1 reply/ }).click();
  await expect(
    page.getByText(
      "Only channel owners and admins can reply to announcements.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Members", exact: true }).click();
  await expect(page.getByText("guest", { exact: true })).toBeVisible();
});

for (const supportsPolicy of [false, true])
  test(`publishing settings follow server capability (${supportsPolicy})`, async ({
    page,
  }) => {
    const fixture = await installCommunityFixture(page, undefined, {
      role: "owner",
      supportsPolicy,
    });
    await page.goto("/chat?channel=markdown");
    await page.getByRole("button", { name: "Members", exact: true }).click();
    await page.getByText("Channel publishing", { exact: true }).click();
    if (!supportsPolicy) {
      await expect(page.getByText("This relay needs an update")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Save publishing policy" }),
      ).toHaveCount(0);
    } else {
      await page.getByLabel("Who can publish").selectOption("admins");
      await page
        .getByRole("button", { name: "Save publishing policy" })
        .click();
      await expect(
        page.getByText("The relay accepted the publishing policy.", {
          exact: true,
        }),
      ).toBeVisible();
      expect(
        fixture.published.find((event) => event.kind === 9002)?.tags,
      ).toEqual([
        ["h", "markdown"],
        ["posting_policy", "admins"],
      ]);
    }
  });
