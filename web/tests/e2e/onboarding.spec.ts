import { expect, test } from "@playwright/test";
import { installCommunityFixture } from "../helpers/community";
import { waitForAnimations } from "../../../desktop/tests/helpers/animations";

for (const width of [1440, 768, 390]) {
  test(`profile and interests at ${width}px`, async ({ page }, testInfo) => {
    const fixture = await installCommunityFixture(page, undefined, {
      selfProfile: {
        display_name: "Sean",
        about: "Keep this bio",
        picture: "https://example.com/avatar.png",
        custom_field: "keep me",
      },
    });
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("/onboarding");
    await expect(
      page.getByRole("heading", { name: "Make it yours." }),
    ).toBeFocused();
    await expect(page.getByLabel("Display name")).toHaveValue("Sean");
    await expect(
      page.getByRole("progressbar", { name: "Step 1 of 2" }),
    ).toHaveAttribute("aria-valuenow", "1");
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
    await capture("profile");
    await page.getByLabel("Choose a profile photo").setInputFiles({
      name: "not-a-photo.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from("<svg/>"),
    });
    await expect(page.getByRole("alert")).toContainText("JPG, PNG or WebP");
    await page.getByLabel("Display name").fill("Sean from the Hive");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "What do you build?" }),
    ).toBeFocused();
    await page.getByRole("checkbox", { name: "AI / ML", exact: true }).focus();
    await page.keyboard.press("Space");
    await page
      .getByLabel("What are you working on?", { exact: false })
      .fill("A private idea");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByLabel("Display name")).toHaveValue(
      "Sean from the Hive",
    );
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(
      page.getByRole("checkbox", { name: "AI / ML", exact: true }),
    ).toBeChecked();
    await expect(
      page.getByRole("progressbar", { name: "Step 2 of 2" }),
    ).toHaveAttribute("aria-valuenow", "2");
    if (width === 390) {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(page.locator('[data-slot="onboarding-step"]')).toHaveCSS(
        "animation-name",
        "none",
      );
    }
    await capture("interests");
    await page.getByRole("button", { name: "Enter the Hive" }).click();
    await expect(page).toHaveURL("/chat?channel=markdown");
    const updates = fixture.published.filter((e) => e.kind === 0);
    expect(updates).toHaveLength(1);
    expect(JSON.parse(updates[0].content)).toEqual({
      display_name: "Sean from the Hive",
      about: "Keep this bio",
      picture: "https://example.com/avatar.png",
      custom_field: "keep me",
    });
    expect(fixture.published.some((e) => e.kind === 9 || e.kind === 1)).toBe(
      false,
    );
    await expect(
      page.getByRole("complementary", { name: "Your private welcome" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Dismiss welcome" }).click();
    await expect(
      page.getByRole("complementary", { name: "Your private welcome" }),
    ).toHaveCount(0);
  });
}

test("failed profile save keeps draft and interests can be skipped", async ({
  page,
}) => {
  await installCommunityFixture(page, undefined, { denyCommands: true });
  await page.goto("/onboarding");
  await page.getByLabel("Display name").fill("Sean");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Enter the Hive" }).click();
  await expect(page.getByRole("alert")).toContainText("fixture denied");
  await expect(page).toHaveURL("/onboarding");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByLabel("Display name")).toHaveValue("Sean");
});

test("an interrupted profile read cannot erase existing fields", async ({
  page,
}) => {
  const fixture = await installCommunityFixture(page, undefined, {
    closeProfileQuery: true,
  });
  await page.goto("/onboarding");
  await page.getByLabel("Display name").fill("Sean");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Enter the Hive" }).click();
  await expect(page.getByRole("alert")).toContainText("connection closed");
  expect(fixture.published).toHaveLength(0);
});

test("onboarding requires community admission", async ({ page }) => {
  await installCommunityFixture(page, undefined, { rejectAuth: true });
  await page.goto("/onboarding");
  await expect(page.getByLabel("Display name")).toHaveCount(0);
});
