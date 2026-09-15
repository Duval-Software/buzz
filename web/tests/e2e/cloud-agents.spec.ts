import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { verifyEvent } from "nostr-tools/pure";
import { installCommunityFixture } from "../helpers/community";
import { waitForAnimations } from "../../../desktop/tests/helpers/animations";

const models = [
  { id: "echo", provider: "echo", label: "Echo (free test)" },
  { id: "haiku", provider: "anthropic", label: "Haiku" },
  {
    id: "openrouter:openai/gpt-4.1-mini",
    provider: "openrouter",
    label: "openai/gpt-4.1-mini",
  },
];

for (const width of [1440, 390]) {
  test(`OpenRouter agents use signed keeper requests without persisting keys at ${width}px`, async ({
    page,
  }, testInfo) => {
    const fixture = await installCommunityFixture(page);
    const key = "sk-or-browser-test-only";
    let posts = 0;
    let reject = true;
    const providerRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).hostname === "openrouter.ai")
        providerRequests.push(request.url());
    });
    await page.route("**/keeper/health", (route) =>
      route.fulfill({ json: { ok: true, models } }),
    );
    const agent = {
      pubkey: "cc".repeat(32),
      name: "Studio helper",
      model: models[2].id,
      respond_to: "mentions",
      key_mode: "byok",
      paused: false,
      running: true,
      adopted: false,
      created_at: 1,
      tokens_today: 0,
    };
    await page.route("**/keeper/agents", async (route) => {
      const request = route.request();
      if (request.method() === "GET")
        return route.fulfill({ json: { agents: posts > 1 ? [agent] : [] } });
      posts++;
      const body = request.postDataJSON();
      expect(body.model).toBe(models[2].id);
      expect(body.api_key).toBe(key);
      const auth = JSON.parse(
        Buffer.from(
          request.headers().authorization.slice(6),
          "base64",
        ).toString(),
      );
      expect(verifyEvent(auth)).toBe(true);
      expect(auth.tags).toContainEqual([
        "payload",
        createHash("sha256")
          .update(request.postData() ?? "")
          .digest("hex"),
      ]);
      return reject
        ? route.fulfill({
            status: 402,
            json: { error: "OpenRouter credits are exhausted" },
          })
        : route.fulfill({ json: agent });
    });
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("/agents");
    await page
      .getByRole("button", { name: "Create agent", exact: true })
      .click();
    await page.getByLabel("Agent name", { exact: true }).fill("Studio helper");
    await page.getByLabel("Model", { exact: true }).selectOption(models[2].id);
    await page
      .getByLabel("Agent persona")
      .fill("Help members turn project ideas into small next steps.");
    await page
      .getByLabel("Your OpenRouter API key")
      .fill("sk-ant-wrong-provider");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Enter your own OpenRouter API key",
    );
    expect(posts).toBe(0);
    await page.getByLabel("Your OpenRouter API key").fill(key);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(
      "credits are exhausted",
    );
    await expect(
      page.getByRole("button", { name: "Create", exact: true }),
    ).toBeEnabled();
    await waitForAnimations(page);
    await page.screenshot({
      path: testInfo.outputPath(`openrouter-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    reject = false;
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(
      page.getByText("Studio helper", { exact: true }),
    ).toBeVisible();
    expect(JSON.stringify(fixture.published)).not.toContain(key);
    expect(
      await page.evaluate(() =>
        JSON.stringify({ ...localStorage, ...sessionStorage }),
      ),
    ).not.toContain(key);
    expect(providerRequests).toHaveLength(0);
    expect(posts).toBe(2);
    await page
      .locator(".hive-list-row")
      .filter({ hasText: "Studio helper" })
      .getByRole("button", { name: "Message", exact: true })
      .click();
    await expect(page).toHaveURL(/\/chat\?channel=dm$/);
    expect(
      fixture.published.some(
        (event) =>
          event.kind === 41010 &&
          event.tags.some((tag) => tag[0] === "p" && tag[1] === agent.pubkey),
      ),
    ).toBe(true);
  });
}

test("legacy keepers hide OpenRouter; switching providers clears the key", async ({
  page,
}) => {
  await installCommunityFixture(page);
  let catalog: { ok: boolean; models?: typeof models } = { ok: true, models };
  let posts = 0;
  await page.route("**/keeper/health", (route) =>
    route.fulfill({ json: catalog }),
  );
  await page.route("**/keeper/agents", (route) => {
    if (route.request().method() === "POST") posts++;
    return route.fulfill({ json: { agents: [] } });
  });
  await page.goto("/agents");
  await page.getByRole("button", { name: "Create agent", exact: true }).click();
  await page.getByLabel("Model", { exact: true }).selectOption(models[2].id);
  await page.getByLabel("Your OpenRouter API key").fill("sk-or-test-only");
  await page.getByLabel("Model", { exact: true }).selectOption("haiku");
  await expect(page.getByLabel("Your Anthropic API key")).toHaveValue("");
  await page.getByLabel("Model", { exact: true }).selectOption(models[2].id);
  await page.getByLabel("Your OpenRouter API key").fill("sk-or-test-only");
  await page.getByLabel("Agent name", { exact: true }).fill("Helper");
  catalog = { ok: true };
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "not available on the cloud server",
  );
  expect(posts).toBe(0);
  await page.reload();
  await page.getByRole("button", { name: "Create agent", exact: true }).click();
  await expect(
    page.getByText("OpenRouter models will appear", { exact: false }),
  ).toBeVisible();
  expect(
    await page
      .getByLabel("Model", { exact: true })
      .locator("option")
      .allTextContents(),
  ).not.toContain("openai/gpt-4.1-mini");
});
