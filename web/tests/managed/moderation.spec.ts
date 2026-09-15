import { test, expect, type Page } from "@playwright/test";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { installCommunityFixture } from "../helpers/community";
import { waitForAnimations } from "../../../desktop/tests/helpers/animations";

async function fixture(page: Page, role = "admin", restricted = false) {
  const key = generateSecretKey();
  const community = await installCommunityFixture(
    page,
    "Welcome to the workshop",
    { noIdentity: true, identitySecret: key, role },
  );
  const user = {
    id: "ab73b77f-f9bd-42d8-9425-2af4f31101a0",
    aud: "authenticated",
    role: "authenticated",
    email: "staff@example.invalid",
    email_confirmed_at: new Date().toISOString(),
    app_metadata: {},
    user_metadata: {
      creatorhive_onboarding: { "wss://chat.creatorhive.ai": { version: 1 } },
    },
  };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const session = {
    access_token: `${btoa("{}")}.${btoa(JSON.stringify({ sub: user.id, exp }))}.test`,
    refresh_token: "test-refresh",
    expires_at: exp,
    expires_in: 3600,
    token_type: "bearer",
    user,
  };
  await page.addInitScript(
    (session) =>
      localStorage.setItem(
        "sb-creatorhive-auth-test-auth-token",
        JSON.stringify(session),
      ),
    session,
  );
  await page.route("**/auth/v1/user", (route) => route.fulfill({ json: user }));
  await page.route("**/api/identity/bootstrap", (route) =>
    route.fulfill({
      json: restricted
        ? {
            restrictions: {
              banned: true,
              rename_required: false,
              items: [
                {
                  id: "00000000-0000-0000-0000-000000000042",
                  action: "ban",
                  reason: "Repeated harassment",
                },
              ],
            },
          }
        : {
            accountId: user.id,
            pubkey: community.self,
            sessionToken: "ac".repeat(32),
            expiresAt: exp,
          },
    }),
  );
  await page.route("**/api/identity/sign", (route) =>
    route.fulfill({
      json: finalizeEvent(route.request().postDataJSON().event, key),
    }),
  );
  const record = {
    id: "00000000-0000-0000-0000-000000000042",
    report_event_id: "f".repeat(64),
    target_pubkey: community.builder,
    target_event_id: "e".repeat(64),
    display_name: "Jordan Lee",
    username: "jordan",
    report_type: "other",
    status: "open",
    evidence: "An example reported message for review.",
    note: "Repeated personal comments after being asked to stop.",
    created_at: new Date().toISOString(),
  };
  let deny = false;
  await page.route("**/api/identity/moderation/read", (route) => {
    const { section } = route.request().postDataJSON();
    if (section === "own")
      return route.fulfill({
        json: {
          banned: restricted,
          rename_required: false,
          items: restricted
            ? [
                {
                  id: record.id,
                  action: "ban",
                  reason: "Repeated harassment",
                  created_at: record.created_at,
                },
              ]
            : [],
        },
      });
    if (role === "member" || deny)
      return route.fulfill({
        status: 403,
        json: { error: "Staff access required" },
      });
    const items =
      section === "reports"
        ? [record]
        : section === "members"
          ? [
              {
                pubkey: community.builder,
                role: "member",
                display_name: "Jordan Lee",
                username: "jordan",
              },
            ]
          : section === "appeals"
            ? [
                {
                  id: record.id,
                  action: "ban",
                  reason: "Repeated harassment",
                  explanation: "Please review the context.",
                  display_name: "Jordan Lee",
                  status: "open",
                },
              ]
            : [];
    return route.fulfill({
      json: {
        role,
        self: community.self,
        items,
        more: false,
        policy: { count: 6, revision: "a".repeat(64) },
      },
    });
  });
  return {
    ...community,
    deny: () => {
      deny = true;
    },
  };
}

test("staff navigation, reports, confirmation and member actions", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/chat");
  await page.getByRole("link", { name: "Manage CreatorHive" }).click();
  await expect(
    page.getByRole("heading", { name: "Manage CreatorHive" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Jordan Lee/ }).click();
  await expect(page.getByRole("blockquote")).toContainText(
    "example reported message",
  );
  await page
    .getByRole("button", { name: "Remove message", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirm change" }),
  ).toBeDisabled();
  await page
    .getByLabel("Reason shown to the member")
    .fill("Repeated personal harassment");
  await page.getByRole("button", { name: "Confirm change" }).click();
  await expect
    .poll(() =>
      state.published.some(
        (event) =>
          event.kind === 9044 &&
          event.tags.some((tag) => tag[0] === "action" && tag[1] === "delete"),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Members", exact: true }).click();
  await page.getByRole("button", { name: /Jordan Lee/ }).click();
  await expect(page.getByRole("button", { name: "Change role" })).toBeVisible();
  await expect(
    page.getByRole("option", { name: "Admin", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Ban member", exact: true }).click();
  await page
    .getByLabel("Reason shown to the member")
    .fill("Escalated harassment after prior warning");
  await page.getByRole("button", { name: "Confirm change" }).click();
  await expect
    .poll(() => state.published.some((event) => event.kind === 9040))
    .toBe(true);
});

test("members report only the selected message and can dismiss the dialog by keyboard", async ({
  page,
}) => {
  const state = await fixture(page, "member");
  await page.goto("/chat");
  const report = page
    .getByRole("button", { name: "Report message", exact: true })
    .first();
  await report.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(report).toBeFocused();
  await report.click();
  await expect(
    page.getByText(
      "Only this message will be shared with the moderation team.",
    ),
  ).toBeVisible();
  await page
    .getByLabel("What happened?")
    .fill("Please review this selected message.");
  await page.getByRole("button", { name: "Send report", exact: true }).click();
  await expect
    .poll(() => state.published.some((event) => event.kind === 1984))
    .toBe(true);
  const command = state.published.find((event) => event.kind === 1984);
  expect(command?.tags.filter((tag) => tag[0] === "e")).toHaveLength(1);
  expect(command?.tags.filter((tag) => tag[0] === "p")).toEqual([
    ["p", state.builder],
  ]);
  expect(command?.content).toBe("Please review this selected message.");
});

test("moderator limits, responsive review and revocation", async ({
  page,
}, testInfo) => {
  const state = await fixture(page, "moderator");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/manage");
  await page.getByRole("button", { name: /Jordan Lee/ }).click();
  await expect(
    page.getByRole("button", { name: "Ban member", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Appeals", exact: true }),
  ).toHaveCount(0);
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("staff-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Back to list" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("staff-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Back to list" }).click();
  state.deny();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Staff access required");
  await expect(page.getByRole("blockquote")).toHaveCount(0);
});

test("ordinary members cannot enter staff routes", async ({ page }) => {
  await fixture(page, "member");
  await page.goto("/manage");
  await expect(page.getByRole("alert")).toContainText("Staff access required");
  await expect(
    page.getByRole("link", { name: "Manage CreatorHive" }),
  ).toHaveCount(0);
});

test("a moderator submits the selected timeout preset", async ({ page }) => {
  const state = await fixture(page, "moderator");
  await page.goto("/manage");
  await page.getByRole("button", { name: "Members", exact: true }).click();
  await page.getByRole("button", { name: /Jordan Lee/ }).click();
  await page.getByLabel("Timeout length").selectOption("600");
  await page
    .getByRole("button", { name: "Apply timeout", exact: true })
    .click();
  await page
    .getByLabel("Reason shown to the member")
    .fill("Short timeout after repeated harassment");
  await page.getByRole("button", { name: "Confirm change" }).click();
  await expect
    .poll(() => state.published.some((event) => event.kind === 9042))
    .toBe(true);
  const command = state.published.find((event) => event.kind === 9042);
  const remaining =
    Number(command?.tags.find((tag) => tag[0] === "expiration")?.[1]) -
    Math.floor(Date.now() / 1000);
  expect(remaining).toBeGreaterThanOrEqual(590);
  expect(remaining).toBeLessThanOrEqual(600);
});

test("banned members can appeal without a messaging session", async ({
  page,
}) => {
  const state = await fixture(page, "member", true);
  let submitted = false;
  await page.route("**/api/identity/moderation/appeal", (route) => {
    submitted = true;
    return route.fulfill({ json: { submitted: true } });
  });
  await page.goto("/chat");
  await page.getByRole("button", { name: "Appeal this action" }).click();
  await page
    .getByLabel("What should the reviewer know?")
    .fill("Please review the conversation before this message.");
  await page.getByRole("button", { name: "Submit appeal" }).click();
  await expect.poll(() => submitted).toBe(true);
  await expect(page.getByRole("status")).toContainText("submitted");
  expect(state.published).toHaveLength(0);
});
