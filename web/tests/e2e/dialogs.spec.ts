import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { installCommunityFixture } from "../helpers/community";
import { waitForAnimations } from "../../../desktop/tests/helpers/animations";

for (const width of [1440, 390]) {
  for (const theme of ["dark", "light"] as const) {
    test(`shared dialogs at ${width}px in ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await installCommunityFixture(page, undefined, { role: "owner" });
      await page.goto("/pulse");
      const check = async (label: string) => {
        const dialog = page.getByRole("dialog", { name: label, exact: true });
        await expect(dialog).toBeVisible();
        await expect(dialog.locator(".hive-dialog-header h2")).toHaveText(
          label,
        );
        const box = await dialog.boundingBox();
        if (!box) throw new Error("Dialog has no rendered bounds");
        expect(box.x).toBeGreaterThanOrEqual(12);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width - 12);
        expect(box.y + box.height).toBeLessThanOrEqual(844);
        expect(
          await dialog
            .locator(".hive-dialog-body")
            .evaluate((el) => el.scrollWidth <= el.clientWidth),
        ).toBe(true);
        await expect(dialog).toHaveJSProperty("open", true);
        await dialog
          .getByRole("button", { name: "Close", exact: true })
          .focus();
        await page.keyboard.press("Tab");
        expect(
          await dialog.evaluate((el) => el.contains(document.activeElement)),
        ).toBe(true);
        await waitForAnimations(page);
        await page.screenshot({
          path: info.outputPath(`${label.replaceAll(" ", "-")}.png`),
        });
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
      };
      const opener = page.getByRole("button", {
        name: "New update",
        exact: true,
      });
      await opener.click();
      await check("New update");
      await expect(opener).toBeFocused();
      if (width === 390)
        await page
          .getByRole("button", {
            name: "Open community navigation",
            exact: true,
          })
          .click();
      await page.getByRole("button", { name: /Your profile/ }).click();
      await check("Your account");
      await page
        .getByRole("button", { name: "Search the Hive", exact: true })
        .click();
      await check("Search the hive");
      await page
        .getByRole("button", { name: "New message", exact: true })
        .click();
      await check("New message");
      await page.getByRole("button", { name: /Browse channels/ }).click();
      await check("Browse channels");
      await page.goto("/community");
      await page
        .getByRole("button", { name: "Make admin", exact: true })
        .click();
      await check("Change to admin");
    });
  }
}

test("Escape cannot dismiss an uploading draft; failures keep the draft recoverable", async ({
  page,
}) => {
  await installCommunityFixture(page, undefined, { pulseEvents: [] });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/upload", async (route) => {
    await pending;
    await route.fulfill({ status: 500, body: "Upload failed" });
  });
  await page.goto("/pulse");
  await page.getByRole("button", { name: "New update", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New update" });
  const draft = dialog.getByRole("textbox", { name: "What are you building?" });
  await draft.fill("Keep my work while the upload finishes.");
  await dialog.getByLabel("Choose build attachment").setInputFiles({
    name: "demo.png",
    mimeType: "image/png",
    buffer: readFileSync("public/icons/icon-192.png"),
  });
  await expect(dialog).toHaveAttribute("aria-busy", "true");
  await expect(
    dialog.getByRole("button", { name: "Close", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  release();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(draft).toHaveValue("Keep my work while the upload finishes.");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("invite policies use the same accessible frame with scrolling and focus return", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.route("**/api/join-policy", (route) =>
    route.fulfill({
      json: {
        policy: {
          terms_markdown:
            "## Community terms\n\n" +
            "A long policy paragraph for checking scroll behavior.\n\n".repeat(
              50,
            ),
          privacy_markdown: "## Privacy\n\nYour community privacy policy.",
          age_attestation_required: false,
          version: "test",
        },
      },
    }),
  );
  await page.route("https://api.github.com/**", (route) =>
    route.fulfill({ status: 500 }),
  );
  await page.goto("/invite/demo-code");
  const terms = page.getByRole("button", {
    name: "Terms of Service",
    exact: true,
  });
  await terms.click();
  const dialog = page.getByRole("dialog", {
    name: "Terms of Service",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".hive-dialog-header")).toBeVisible();
  await dialog.locator(".hive-dialog-body").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(
    dialog.getByRole("button", { name: "Close", exact: true }),
  ).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({ path: info.outputPath("invite-terms-mobile.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(terms).toBeFocused();
});
