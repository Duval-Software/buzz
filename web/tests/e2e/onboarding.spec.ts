import { expect, test } from "@playwright/test";
import { verifyEvent } from "nostr-tools/pure";
import { installCommunityFixture } from "../helpers/community";
import { waitForAnimations } from "../../../desktop/tests/helpers/animations";

for (const width of [1440, 768, 390]) {
  test(`welcome, profile, and first destination at ${width}px`, async ({
    page,
  }, testInfo) => {
    const fixture = await installCommunityFixture(page, undefined, {
      selfProfile: {
        display_name: "Sean",
        about: "Building things",
        picture: "https://example.com/avatar.png",
        custom_field: "keep me",
      },
    });
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("/onboarding");
    await expect(
      page.getByRole("heading", { name: "Good ideas grow together." }),
    ).toBeFocused();
    const capture = async (name: string) => {
      await waitForAnimations(page);
      await page.screenshot({
        path: testInfo.outputPath(`${name}-${width}.png`),
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    };
    await capture("welcome");
    await page.getByRole("button", { name: "Make yourself at home" }).click();
    await expect(
      page.getByRole("heading", { name: "What should we call you?" }),
    ).toBeFocused();
    await expect(page.getByLabel("Display name")).toHaveValue("Sean");
    await page.getByLabel("Display name").fill("   ");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Enter a display name");
    await page.getByLabel("Display name").fill("Sean from the Hive");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await capture("profile");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Where shall we start?" }),
    ).toBeFocused();
    await page.getByRole("radio", { name: /Step into the studio/ }).focus();
    await page.keyboard.press("Space");
    await expect(
      page.getByRole("radio", { name: /Step into the studio/ }),
    ).toBeChecked();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByLabel("Display name")).toHaveValue(
      "Sean from the Hive",
    );
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await capture("destination");
    expect(fixture.published).toHaveLength(0);
    await page.getByRole("button", { name: "Save & open Live" }).click();
    await expect(page).toHaveURL("/live");
    const updates = fixture.published.filter((event) => event.kind === 0);
    expect(updates).toHaveLength(1);
    expect(verifyEvent(updates[0])).toBe(true);
    expect(JSON.parse(updates[0].content)).toEqual({
      display_name: "Sean from the Hive",
      about: "Building things",
      picture: "https://example.com/avatar.png",
      custom_field: "keep me",
    });
    expect(
      fixture.published.some((event) => event.kind === 9 || event.kind === 1),
    ).toBe(false);
    await page.goto("/chat");
    await expect(
      page.getByRole("heading", { name: "Good ideas grow together." }),
    ).toHaveCount(0);
    if (width === 390)
      await page.getByRole("button", { name: "Channels", exact: true }).click();
    await page.getByRole("button", { name: /Your profile/ }).click();
    await page
      .getByRole("link", { name: "Revisit the community welcome" })
      .click();
    await expect(page).toHaveURL("/onboarding");
  });
}

test("profile failure retains progress and skip makes no additional changes", async ({
  page,
}) => {
  const fixture = await installCommunityFixture(page, undefined, {
    denyCommands: true,
  });
  await page.goto("/onboarding");
  await page.getByRole("button", { name: "Make yourself at home" }).click();
  await page.getByLabel("Display name").fill("Sean");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Save & open Chat" }).click();
  await expect(page.getByRole("alert")).toContainText("fixture denied");
  await expect(page).toHaveURL("/onboarding");
  await expect(
    page.getByRole("button", { name: "Save & open Chat" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page).toHaveURL("/chat");
  expect(fixture.published.filter((event) => event.kind === 0)).toHaveLength(1);
});

test("an interrupted profile read cannot erase the existing profile", async ({
  page,
}) => {
  const fixture = await installCommunityFixture(page, undefined, {
    closeProfileQuery: true,
  });
  await page.goto("/onboarding");
  await page.getByRole("button", { name: "Make yourself at home" }).click();
  await page.getByLabel("Display name").fill("Sean");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Save & open Chat" }).click();
  await expect(page.getByRole("alert")).toContainText("connection closed");
  expect(fixture.published).toHaveLength(0);
});

test("onboarding requires actual community admission", async ({ page }) => {
  await installCommunityFixture(page, undefined, { rejectAuth: true });
  await page.goto("/onboarding");
  await expect(
    page.getByRole("heading", { name: "Join the conversation" }),
  ).toBeVisible();
  await expect(page.getByLabel("Display name")).toHaveCount(0);
});

test("pending welcome survives a reload and skip tolerates unavailable storage", async ({
  page,
}) => {
  const { self } = await installCommunityFixture(page);
  const marker = `creatorhive.onboarding.v1:wss://chat.creatorhive.ai:${self}`;
  await page.goto("/chat");
  await page.evaluate((key) => localStorage.setItem(key, "pending"), marker);
  await page.reload();
  await expect(page).toHaveURL("/onboarding");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("creatorhive.onboarding."))
        throw new Error("Storage unavailable");
      original.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page).toHaveURL("/chat");
  await expect(
    page.getByRole("button", { name: /Your profile/ }),
  ).toBeVisible();
});
