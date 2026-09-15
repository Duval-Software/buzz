import { expect, test } from "@playwright/test";
import { installCommunityFixture } from "../helpers/community";

test("community entry prefers General over alphabetically earlier conversations", async ({
  page,
}) => {
  await installCommunityFixture(page, "Welcome", {
    channelName: "General",
    channelDelayMs: 200,
  });
  await page.goto("/chat");
  await expect(
    page.getByRole("textbox", { name: "Message #General" }),
  ).toBeVisible();
  await page.goto("/chat?channel=dm");
  await expect(
    page.getByRole("textbox", { name: "Message Builder" }),
  ).toBeVisible();
});

for (const width of [1440, 390]) {
  test(`new chats open at the latest content at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await installCommunityFixture(
      page,
      Array.from(
        { length: 35 },
        (_, i) =>
          `History paragraph ${i + 1}. Here is an earlier part of the conversation.`,
      ).join("\n\n"),
    );
    let releaseImage!: () => void;
    const imagePending = new Promise<void>((resolve) => {
      releaseImage = resolve;
    });
    await page.route("**/media/*.png", async (route) => {
      await imagePending;
      await route.fallback();
    });
    await page.goto("/chat?channel=markdown");
    const timeline = page.locator(".hive-timeline");
    const distanceFromBottom = () =>
      timeline.evaluate(
        (el) => el.scrollHeight - el.clientHeight - el.scrollTop,
      );
    await expect(
      page.getByText("History paragraph 35.", { exact: false }),
    ).toBeVisible();
    await expect
      .poll(() => timeline.evaluate((el) => el.scrollHeight > el.clientHeight))
      .toBe(true);
    await expect.poll(distanceFromBottom).toBeLessThan(2);
    releaseImage();
    await expect
      .poll(() =>
        timeline
          .locator("img")
          .evaluateAll((images) =>
            images.every((image) => (image as HTMLImageElement).complete),
          ),
      )
      .toBe(true);
    await expect.poll(distanceFromBottom).toBeLessThan(2);

    // Explicitly reading history must not be undone by later layout changes.
    await timeline.evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect.poll(() => timeline.evaluate((el) => el.scrollTop)).toBe(0);
    await page.setViewportSize({ width, height: 700 });
    await expect
      .poll(() => timeline.evaluate((el) => el.clientHeight))
      .toBeLessThan(650);
    expect(await timeline.evaluate((el) => el.scrollTop)).toBe(0);

    if (width === 390)
      await page.getByRole("button", { name: "Channels", exact: true }).click();
    await page.getByRole("button", { name: /^Builder(?: \d+)?$/ }).click();
    await expect(
      page.getByRole("textbox", { name: "Message Builder" }),
    ).toBeVisible();
    await expect.poll(distanceFromBottom).toBeLessThan(2);
    if (width === 390)
      await page.getByRole("button", { name: "Channels", exact: true }).click();
    await page.getByRole("button", { name: "# markdown", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "Message #markdown" }),
    ).toBeVisible();
    await expect.poll(distanceFromBottom).toBeLessThan(2);
  });
}

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`composer has one focus border and respects ${reducedMotion} when sending`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion, colorScheme: "dark" });
    await installCommunityFixture(page);
    await page.goto("/chat?channel=markdown");
    const composer = page.getByRole("textbox", { name: "Message #markdown" });
    await composer.fill("A small step forward");
    await expect(composer).toBeFocused();
    await expect(composer).toHaveCSS("outline-style", "none");
    await expect(composer).toHaveCSS("border-top-width", "0px");
    await expect(page.locator(".hive-composer-field")).toHaveCSS(
      "border-top-color",
      "rgb(232, 187, 113)",
    );
    await expect(page.locator(".hive-message.is-outgoing")).toHaveCount(0);
    await composer.press("Enter");
    const sent = page
      .locator(".hive-message")
      .filter({ hasText: "A small step forward" });
    await expect(sent).toHaveCount(1);
    await expect(sent).toHaveCSS(
      "animation-name",
      reducedMotion === "reduce" ? "none" : "hive-message-send",
    );
    await expect(composer).toHaveValue("");
    await expect(composer).toBeFocused();
    await expect(sent.getByTitle("Edit", { exact: true })).toBeAttached();
  });
}
