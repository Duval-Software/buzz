import { expect, test } from "@playwright/test";
import { waitForAnimations } from "../../../desktop/tests/helpers/animations";
import { installCommunityFixture } from "../helpers/community";

test("Markdown is safe and consistent in channels, threads, and DMs", async ({
  page,
}, testInfo) => {
  const { receivedRemote } = await installCommunityFixture(page);
  await page.goto("/chat?channel=markdown");
  const content = page.locator(".message-markdown").first();
  await expect(content.locator("h2")).toHaveText("Build update");
  await expect(content.locator("strong").first()).toHaveText("Shipped");
  await expect(content.locator("em")).toHaveText("today");
  await expect(content.locator("ul > li")).toHaveCount(2);
  await expect(content.locator("ol > li")).toHaveCount(2);
  await expect(content.locator("table td")).toHaveText(["Markdown", "Ready"]);
  await expect(content.getByRole("link", { name: "Docs" })).toHaveAttribute(
    "href",
    "https://example.com/docs",
  );
  await expect(
    content.getByRole("link", { name: "https://example.com/notes" }),
  ).toBeVisible();
  await expect(content.getByText("@Builder", { exact: true })).toHaveClass(
    /bg-amber/,
  );
  await expect(content.getByRole("img", { name: ":hive:" })).toHaveCount(1);
  await expect(content.locator("pre code")).toContainText(
    "![image](https://example.com/code.png)",
  );
  await expect(
    content.locator(
      "code img, code span, script, [onerror], a[href^='javascript:'], a[href^='data:']",
    ),
  ).toHaveCount(0);
  await expect(
    page.getByRole("img", { name: "attachment", exact: true }),
  ).toHaveCount(1);
  await expect
    .poll(() =>
      page
        .getByRole("img", { name: "attachment", exact: true })
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(content).toContainText("remote alternative");
  expect(receivedRemote).toEqual([]);
  expect(await page.evaluate(() => "markdownExecuted" in window)).toBe(false);
  await waitForAnimations(page);
  await page.screenshot({ path: testInfo.outputPath("markdown-channel.png") });
  await page.getByRole("button", { name: "1 reply →", exact: true }).click();
  const thread = page.getByRole("complementary").filter({
    has: page.getByRole("heading", { name: "Thread", exact: true }),
  });
  await expect(thread.locator("h2").last()).toHaveText("Build update");
  await expect(thread.locator("strong").last()).toHaveText("Thread reply");
  await expect(
    thread.getByRole("img", { name: "attachment", exact: true }),
  ).toHaveCount(1);
  await thread.getByRole("button", { name: "Close", exact: true }).click();
  await page.goto("/chat?channel=dm");
  await expect(
    page.getByRole("heading", { name: "Builder", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".message-markdown strong").first()).toHaveText(
    "Shipped",
  );
});
