import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { verifyEvent } from "nostr-tools/pure";
import { installCommunityFixture } from "../helpers/community";
import { waitForAnimations } from "../../../desktop/tests/helpers/animations";

const password = "correct horse studio hive";
type Record = {
  username: string;
  password: string;
  pubkey: string;
  vault: unknown;
};
async function installAccounts(
  page: Page,
  records = new Map<string, Record>(),
) {
  await page.route("**/api/accounts/*", async (route) => {
    const request = route.request();
    const body = request.postDataJSON();
    const path = new URL(request.url()).pathname.split("/").pop();
    if (path === "logout") return route.fulfill({ json: { signed_out: true } });
    let record = records.get(body.username);
    if (path === "register" || path === "password") {
      const event = JSON.parse(
        Buffer.from(
          request.headers().authorization.slice(6),
          "base64",
        ).toString(),
      );
      expect(verifyEvent(event)).toBe(true);
      expect(event.tags).toContainEqual([
        "payload",
        createHash("sha256")
          .update(request.postData() ?? "")
          .digest("hex"),
      ]);
      if (path === "register") {
        if (record)
          return route.fulfill({
            status: 409,
            json: { error: "That username is taken." },
          });
        record = {
          username: body.username,
          password: body.password,
          pubkey: event.pubkey,
          vault: body.vault,
        };
        records.set(body.username, record);
      } else if (
        record &&
        record.password === body.password &&
        record.pubkey === event.pubkey
      ) {
        record.password = body.new_password;
        record.vault = body.vault;
      } else
        return route.fulfill({
          status: 401,
          json: { error: "Username or password is incorrect." },
        });
    } else if (!record || record.password !== body.password)
      return route.fulfill({
        status: 401,
        json: { error: "Username or password is incorrect." },
      });
    if (!record) throw new Error("Missing test account");
    await route.fulfill({
      json: {
        username: record.username,
        pubkey: record.pubkey,
        vault: record.vault,
        session_token: "aa".repeat(32),
      },
    });
  });
  return records;
}

async function fillSignup(page: Page) {
  await page
    .getByRole("button", { name: "New here? Create an account" })
    .click();
  await page.getByLabel("Username", { exact: true }).fill("Studio_Sean");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: /^Account/ }).click();
  await page.getByRole("button", { name: "Sign out of this browser" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back to the Hive" }),
  ).toBeVisible();
}

test("credential lifecycle survives a fresh browser state and keeps secrets out of storage", async ({
  page,
}, testInfo) => {
  await installCommunityFixture(page, undefined, { noIdentity: true });
  const records = await installAccounts(page);
  await page.goto("/chat");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await waitForAnimations(page);
    await page.screenshot({ path: testInfo.outputPath(`login-${width}.png`) });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fillSignup(page);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByRole("button", { name: /^Account/ })).toBeVisible();
  const record = records.get("studio_sean");
  expect(record).toBeDefined();
  expect(JSON.stringify(record?.vault)).not.toContain(password);
  expect(
    await page.evaluate(() => localStorage.getItem("buzz.identity.nsec")),
  ).toBeNull();
  await signOut(page);
  await page.reload();
  await page.getByLabel("Username", { exact: true }).fill("STUDIO_SEAN");
  await page.getByLabel("Password", { exact: true }).fill("wrong password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Username or password is incorrect",
  );
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: /^Account/ }).click();
  await expect(page.getByText("Signed in as @studio_sean")).toBeVisible();
  await expect(page.getByText("Backup key", { exact: true })).toHaveCount(0);
  await page.getByText("Change password", { exact: true }).click();
  await page.getByLabel("Current password", { exact: true }).fill(password);
  await page
    .getByLabel("New password", { exact: true })
    .fill("another secure studio password");
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("another secure studio password");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("button", { name: /^Account/ })).toBeVisible();
  await page.getByRole("button", { name: /^Account/ }).click();
  await expect(page.getByText("Signed in as @studio_sean")).toBeVisible();
  expect(records.get("studio_sean")?.pubkey).toBe(record?.pubkey);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await signOut(page);
  await page.getByLabel("Username", { exact: true }).fill("studio_sean");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page
    .getByLabel("Password", { exact: true })
    .fill("another secure studio password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Account/ })).toBeVisible();
});

test("existing profile gains credentials without changing its identity", async ({
  page,
}) => {
  const fixture = await installCommunityFixture(page);
  const records = await installAccounts(page);
  await page.goto("/chat");
  await page.getByRole("button", { name: /^Account/ }).click();
  await page.getByLabel("Username", { exact: true }).fill("existing_member");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByRole("button", { name: /^Account/ }).click();
  await expect(page.getByText("Signed in as @existing_member")).toBeVisible();
  expect(records.get("existing_member")?.pubkey).toBe(fixture.self);
  expect(
    await page.evaluate(() => localStorage.getItem("buzz.identity.nsec")),
  ).toBeNull();
});

test("registration does not bypass community admission", async ({ page }) => {
  await installCommunityFixture(page, undefined, {
    noIdentity: true,
    rejectAuth: true,
  });
  await installAccounts(page);
  await page.goto("/chat");
  await fillSignup(page);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Join the conversation" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Account/ })).toHaveCount(0);
});

test("tampered account backup cannot unlock a profile", async ({ page }) => {
  await installCommunityFixture(page, undefined, { noIdentity: true });
  const records = await installAccounts(page);
  await page.goto("/chat");
  await fillSignup(page);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await signOut(page);
  const record = records.get("studio_sean");
  if (!record) throw new Error("Missing account");
  record.vault = {
    ...(record.vault as object),
    ciphertext: Buffer.alloc(48).toString("base64"),
  };
  await page.getByLabel("Username", { exact: true }).fill("studio_sean");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Could not unlock this account",
  );
});

test("invited members use credentials, consent and signed claims without losing their login", async ({
  page,
}, testInfo) => {
  await installCommunityFixture(page, undefined, { noIdentity: true });
  const records = await installAccounts(page);
  await page.route("https://api.github.com/**", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/join-policy", (route) =>
    route.fulfill({
      json: {
        policy: {
          terms_markdown: "# Community terms",
          privacy_markdown: "# Privacy",
          age_attestation_required: true,
          version: "policy-v1",
        },
      },
    }),
  );
  let receipts = 0;
  await page.route("**/api/invites/accept-policy", (route) => {
    expect(route.request().postDataJSON()).toEqual({
      code: "account-invite",
      policy_version: "policy-v1",
      age_confirmed: true,
    });
    receipts++;
    return route.fulfill({ json: { receipt: "bound-policy-receipt" } });
  });
  let claims = 0;
  await page.route("**/api/invites/claim", (route) => {
    claims++;
    const request = route.request();
    expect(request.postDataJSON()).toEqual({
      code: "account-invite",
      policy_receipt: "bound-policy-receipt",
    });
    const event = JSON.parse(
      Buffer.from(
        request.headers().authorization.slice(6),
        "base64",
      ).toString(),
    );
    expect(verifyEvent(event)).toBe(true);
    expect(event.pubkey).toBe(records.get("invited_sean")?.pubkey);
    expect(event.tags).toContainEqual(["account-session", "aa".repeat(32)]);
    expect(event.tags).toContainEqual(["u", request.url()]);
    expect(event.tags).toContainEqual([
      "payload",
      createHash("sha256")
        .update(request.postData() ?? "")
        .digest("hex"),
    ]);
    return claims === 1
      ? route.fulfill({ status: 409, json: { error: "invite_exhausted" } })
      : route.fulfill({
          json: {
            status: "joined",
            community_id: "fixture",
            host: "chat.creatorhive.ai",
            role: "member",
          },
        });
  });
  await page.goto("/invite/account-invite");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await waitForAnimations(page);
    await page.screenshot({
      path: testInfo.outputPath(`invite-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await expect(
    page.getByRole("button", { name: "Join in browser" }),
  ).toHaveCount(0);
  await page.getByLabel("Username", { exact: true }).fill("invited_sean");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByText("Signed in as @invited_sean")).toBeVisible();
  const join = page.getByRole("button", { name: "Join in browser" });
  await expect(join).toBeDisabled();
  expect(claims).toBe(0);
  await page.getByLabel("I am 18 years of age or older.").press("Space");
  await expect(join).toBeDisabled();
  await page
    .getByLabel("I agree to the Buzz Terms of Service and Privacy Policy.")
    .press("Space");
  await join.click();
  await expect(page.getByRole("alert")).toContainText("reached its use limit");
  await expect(page).toHaveURL("/invite/account-invite");
  await expect(join).toBeEnabled();
  await join.click();
  await expect(page).toHaveURL("/onboarding");
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page).toHaveURL("/chat");
  await page.getByRole("button", { name: "Channels", exact: true }).click();
  await page.getByRole("button", { name: /^Account/ }).click();
  await expect(page.getByText("Signed in as @invited_sean")).toBeVisible();
  expect(claims).toBe(2);
  expect(receipts).toBe(2);
  // A fresh invite tab uses the same credential login, without registering again.
  await page.goto("/invite/account-invite");
  await page.getByRole("button", { name: "Already a member? Sign in" }).click();
  await page.getByLabel("Username", { exact: true }).fill("invited_sean");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Signed in as @invited_sean")).toBeVisible();
  await expect(join).toBeDisabled();
});

test("unavailable invite policy fails closed with recovery guidance", async ({
  page,
}) => {
  await installCommunityFixture(page);
  await page.route("https://api.github.com/**", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/join-policy", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.goto("/invite/unavailable");
  await expect(page.getByRole("alert")).toContainText("Could not load");
  await expect(
    page.getByRole("button", { name: "Join in browser" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Accept invite in Buzz" }),
  ).toBeDisabled();
});
