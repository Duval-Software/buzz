import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { verifyEvent } from "nostr-tools";
import { installCommunityFixture } from "../helpers/community";
import { waitForAnimations } from "../../../desktop/tests/helpers/animations";

const original = "a1".repeat(32);
const linked = [
  ["hive-post", "feedback"],
  ["hive-project", "Replay bookmarks"],
  ["hive-build", "https://example.com/replay"],
];

test("build updates upload, follow, edit, resolve and delete through signed events", async ({
  page,
}, info) => {
  const fixture = await installCommunityFixture(page, undefined, {
    pulseEvents: [],
  });
  let uploaded = false;
  await page.route("**/upload", async (route) => {
    const hash = route.request().headers()["x-sha-256"];
    const auth = route.request().headers().authorization.slice(6);
    const signed = JSON.parse(Buffer.from(auth, "base64url").toString());
    expect(verifyEvent(signed)).toBe(true);
    expect(signed.tags).toContainEqual(["x", hash]);
    uploaded = true;
    await route.fulfill({
      json: {
        url: `https://chat.creatorhive.ai/media/${hash}.png`,
        sha256: hash,
        size: 100,
        type: "image/png",
      },
    });
  });
  await page.goto("/pulse");
  await expect(
    page.getByRole("textbox", { name: "What are you building?" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "New update", exact: true }).click();
  const composer = page.getByRole("dialog", {
    name: "New update",
    exact: true,
  });
  await composer.getByRole("radio", { name: "Feedback wanted" }).check();
  await composer
    .getByRole("textbox", { name: "What are you building?" })
    .fill(
      "Which bookmark interaction feels clearer? [Try the demo](https://example.com/demo)",
    );
  await composer
    .getByText("Link this update to a build", { exact: true })
    .click();
  await composer
    .getByLabel("Build name", { exact: true })
    .fill("Replay bookmarks");
  await composer
    .getByLabel("Build link", { exact: true })
    .fill("https://example.com/replay");
  await composer.getByLabel("Choose build attachment").setInputFiles({
    name: "bookmark.png",
    mimeType: "image/png",
    buffer: readFileSync("public/icons/icon-192.png"),
  });
  await expect(
    composer.getByText("bookmark.png", { exact: true }),
  ).toBeVisible();
  expect(uploaded).toBe(true);
  await composer.getByRole("button", { name: "Post", exact: true }).click();
  await expect(composer).not.toBeVisible();
  const posted = fixture.published.find((event) => event.kind === 1);
  expect(posted?.tags).toEqual(expect.arrayContaining(linked));
  expect(posted?.tags.some((tag) => tag[0] === "imeta")).toBe(true);
  expect(verifyEvent(posted as Parameters<typeof verifyEvent>[0])).toBe(true);
  let note = page
    .getByRole("article")
    .filter({ hasText: "Which bookmark interaction feels clearer?" });
  await expect(
    note.getByRole("link", { name: "Try the demo" }),
  ).toHaveAttribute("href", "https://example.com/demo");
  await note.getByRole("button", { name: "Follow build", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Following", exact: true }).click();
  await expect(
    page.getByText("Following in this browser.", { exact: false }),
  ).toBeVisible();
  await expect(note).toBeVisible();
  await note.getByText("•••", { exact: true }).click();
  await note.getByRole("button", { name: "Edit update", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit update", exact: true });
  await edit
    .getByLabel("Update text")
    .fill("Which bookmark interaction feels clearer? Two options are ready.");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).not.toBeVisible();
  await note
    .getByRole("button", { name: "Resolve feedback", exact: true })
    .click();
  const resolution = page.getByRole("dialog", {
    name: "Resolve feedback",
    exact: true,
  });
  await resolution
    .getByLabel("Feedback outcome")
    .fill("We chose the inline bookmark after three member demos.");
  await resolution.getByRole("button", { name: "Mark resolved" }).click();
  await expect(
    note.getByText("Feedback resolved", { exact: true }),
  ).toBeVisible();
  await expect(
    note.getByText("We chose the inline bookmark after three member demos."),
  ).toBeVisible();
  await page.reload();
  note = page
    .getByRole("article")
    .filter({ hasText: "Two options are ready." });
  await expect(
    note.getByText("Feedback resolved", { exact: true }),
  ).toBeVisible();
  const edits = fixture.published.filter((event) => event.kind === 40003);
  expect(edits).toHaveLength(2);
  expect(edits[1].created_at).toBeGreaterThan(edits[0].created_at);
  expect(edits[1].tags.some((tag) => tag[0] === "imeta")).toBe(true);
  await page.getByLabel("Filter updates").selectOption("feedback");
  await expect(note).not.toBeVisible();
  await page.getByLabel("Filter updates").selectOption("all");
  await waitForAnimations(page);
  await page.screenshot({
    path: info.outputPath("pulse-resolved-desktop.png"),
  });
  await note.getByText("•••", { exact: true }).click();
  await note
    .getByRole("button", { name: "Delete update", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Delete update", exact: true })
    .getByRole("button", { name: "Delete update", exact: true })
    .click();
  await expect(note).toHaveCount(0);
  await page.reload();
  await expect(note).toHaveCount(0);
});

test("foreign edits and deletes are ignored; reports and replies use existing relay contracts", async ({
  page,
}) => {
  const fixture = await installCommunityFixture(page, undefined, {
    pulseEvents: [
      { id: original, content: "A real feedback request", tags: linked },
      {
        id: "a2".repeat(32),
        kind: 40003,
        pubkey: "cc".repeat(32),
        content: "Forged replacement",
        tags: [["e", original]],
      },
      {
        id: "a3".repeat(32),
        kind: 5,
        pubkey: "cc".repeat(32),
        content: "",
        tags: [["e", original]],
      },
    ],
  });
  await page.goto("/pulse");
  const note = page
    .getByRole("article")
    .filter({ hasText: "A real feedback request" });
  await expect(note).toBeVisible();
  await expect(page.getByText("Forged replacement")).toHaveCount(0);
  await note.getByText("•••", { exact: true }).click();
  await expect(note.getByRole("button", { name: "Edit update" })).toHaveCount(
    0,
  );
  await note.getByRole("button", { name: "Report update" }).click();
  const report = page.getByRole("dialog", { name: "Report update" });
  await report.getByLabel("Reason", { exact: true }).selectOption("spam");
  await report.getByRole("button", { name: "Submit report" }).click();
  await expect(
    page.getByText("Report submitted for moderator review."),
  ).toBeVisible();
  const signedReport = fixture.published.find((event) => event.kind === 1984);
  expect(signedReport?.tags).toEqual([
    ["e", original, "spam"],
    ["p", fixture.builder],
  ]);
  expect(verifyEvent(signedReport as Parameters<typeof verifyEvent>[0])).toBe(
    true,
  );
  await note.getByRole("button", { name: "Reply", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Write your reply" })
    .fill("Here is a specific suggestion.");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  expect(fixture.published.find((event) => event.kind === 1)?.tags).toEqual([
    ["e", original, "", "reply"],
    ["p", fixture.builder],
  ]);
});

test("refused writes keep the draft and invalid links never publish", async ({
  page,
}) => {
  const fixture = await installCommunityFixture(page, undefined, {
    denyCommands: true,
  });
  await page.goto("/pulse");
  await page.getByRole("button", { name: "New update", exact: true }).click();
  const draft = page.getByRole("textbox", { name: "What are you building?" });
  await draft.fill("Keep this draft after refusal");
  await page.getByText("Link this update to a build", { exact: true }).click();
  await page
    .getByLabel("Build link", { exact: true })
    .fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("http://");
  expect(fixture.published).toHaveLength(0);
  await page.getByLabel("Build link", { exact: true }).fill("");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("fixture denied");
  await expect(draft).toHaveValue("Keep this draft after refusal");
  await expect(
    page
      .getByRole("article")
      .filter({ hasText: "Keep this draft after refusal" }),
  ).toHaveCount(0);
});

for (const width of [1440, 390])
  test(`feed and focused composer at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: "dark" });
    await installCommunityFixture(page, undefined, {
      pulseEvents: [
        {
          id: original,
          content:
            "The replay picker is ready to try.\n\nWe made the timestamp visible before you open a bookmark. Does that make the list easier to scan?",
          tags: linked,
        },
        {
          id: "a4".repeat(32),
          content:
            "## First release is out\n\nA small tool for collecting useful moments from our live builds. [Try it here](https://example.com/replay).",
          tags: [["hive-post", "shipped"], ...linked.slice(1)],
        },
      ],
    });
    await page.goto("/pulse");
    await expect(
      page.getByText("The replay picker is ready to try.", { exact: false }),
    ).toBeVisible();
    await waitForAnimations(page);
    await page.screenshot({ path: info.outputPath(`pulse-feed-${width}.png`) });
    await page.getByRole("button", { name: "New update", exact: true }).click();
    await page.getByRole("button", { name: "Recap a live build" }).click();
    await expect(
      page.getByRole("textbox", { name: "What are you building?" }),
    ).toContainText("Member input that shaped it:");
    await waitForAnimations(page);
    await page.screenshot({
      path: info.outputPath(`pulse-composer-${width}.png`),
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
