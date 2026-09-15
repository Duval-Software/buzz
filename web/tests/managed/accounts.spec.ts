import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import { installCommunityFixture } from "../helpers/community";
import { test, expect } from "@playwright/test";
import { waitForAnimations } from "../../../desktop/tests/helpers/animations";

test("normal login is accessible on desktop and mobile without identity controls", async ({
  page,
}) => {
  await page.goto("/chat");
  await expect(
    page.getByRole("heading", { name: /Welcome to\s*CreatorHive/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/nsec|public key|backup key|import identity|NIP-07/i),
  ).toHaveCount(0);
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/managed-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "CreatorHive home" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Email address")).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".hive-sign-in-form")).toHaveCSS(
    "animation-name",
    "none",
  );
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/managed-mobile.png" });
});

test("Google uses PKCE and the configured callback", async ({ page }) => {
  let authorization = "";
  await page.route(
    "https://creatorhive-auth-test.supabase.co/auth/v1/authorize**",
    (route) => {
      authorization = route.request().url();
      return route.fulfill({
        contentType: "text/html",
        body: "Provider reached",
      });
    },
  );
  await page.goto("/chat");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect.poll(() => authorization).not.toBe("");
  const query = new URL(authorization).searchParams;
  expect(query.get("provider")).toBe("google");
  expect(query.get("code_challenge_method")).toBe("s256");
  expect(query.get("code_challenge")).toBeTruthy();
  expect(query.get("redirect_to")).toBe("http://127.0.0.1:4174/chat");
});

test("cancelled Google login offers retry without creating a local identity", async ({
  page,
}) => {
  await page.goto("/chat#error=access_denied&error_description=Cancelled");
  await expect(page.getByRole("alert")).toContainText(
    "Google sign-in wasn’t completed",
  );
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() => localStorage.getItem("buzz.identity.nsec")),
  ).toBeNull();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Forgot password?" }),
  ).toBeVisible();
});

for (const newMember of [false, true]) {
  test(`managed ${newMember ? "new" : "returning"} member onboarding and chat recovery`, async ({
    page,
  }) => {
    const key = generateSecretKey(); // Test-server key; never injected into the browser.
    const fixture = await installCommunityFixture(
      page,
      "Existing community message",
      {
        noIdentity: true,
        identitySecret: key,
        selfProfile: {
          display_name: newMember ? "" : "Test member",
          creatorhive_onboarding: {
            version: 1,
            completed_at: new Date().toISOString(),
          },
        },
      },
    );
    const user = {
      id: "ab73b77f-f9bd-42d8-9425-2af4f31101a0",
      aud: "authenticated",
      role: "authenticated",
      email: "member@example.invalid",
      email_confirmed_at: new Date().toISOString(),
      app_metadata: {},
      user_metadata: {
        full_name: "New Hive Member",
        avatar_url: "https://lh3.googleusercontent.com/test-photo",
        creatorhive_onboarding: newMember
          ? {}
          : {
              "wss://chat.creatorhive.ai": {
                version: 1,
                completed_at: new Date().toISOString(),
              },
            },
      } as Record<string, unknown>,
    };
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const jwt = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, exp, session_id: "65fbdc7e-e99c-47af-8911-f7d9d7153b7d", role: "authenticated" })).toString("base64url")}.test-signature`;
    await page.route("**/auth/v1/token**", (route) =>
      route.fulfill({
        json: {
          access_token: jwt,
          token_type: "bearer",
          expires_in: 3600,
          expires_at: exp,
          refresh_token: "test-refresh",
          user,
        },
      }),
    );
    let denyOnboardingSave = newMember;
    await page.route("**/auth/v1/user", (route) => {
      if (route.request().method() === "PUT") {
        if (denyOnboardingSave)
          return route.fulfill({
            status: 503,
            json: { msg: "Could not save your welcome progress" },
          });
        user.user_metadata = {
          ...user.user_metadata,
          ...route.request().postDataJSON().data,
        };
      }
      return route.fulfill({ json: user });
    });
    let memberProfile: Record<string, unknown> | null = null;
    let denyClaim = newMember;
    await page.route("**/rest/v1/rpc/creatorhive_profile", (route) => {
      const body = route.request().postDataJSON();
      if (body.operation === "check")
        return route.fulfill({
          json: { available: body.proposed_username !== "taken" },
        });
      if (body.operation === "save" && denyClaim)
        return route.fulfill({
          status: 409,
          json: {
            message: "That username is already taken. Try another.",
            code: "23505",
          },
        });
      if (body.operation === "save")
        memberProfile = {
          ...body.profile_data,
          username: body.proposed_username,
        };
      return route.fulfill({
        body: JSON.stringify(memberProfile),
        contentType: "application/json",
      });
    });
    const photo = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6TAAAAABJRU5ErkJggg==",
      "base64",
    );
    await page.route("https://lh3.googleusercontent.com/test-photo", (route) =>
      route.fulfill({ body: photo, contentType: "image/png" }),
    );
    let photoUploads = 0;
    let uploadedPhoto = "";
    await page.route("**/upload", (route) => {
      photoUploads++;
      const sha = route.request().headers()["x-sha-256"];
      expect(route.request().postDataBuffer()).toEqual(photo);
      expect(route.request().headers().authorization).toMatch(/^Nostr /);
      uploadedPhoto = `https://chat.creatorhive.ai/media/${sha}.png`;
      return route.fulfill({
        json: {
          url: uploadedPhoto,
          sha256: sha,
          size: photo.length,
          type: "image/png",
        },
      });
    });
    let bootstraps = 0;
    let denySign = false;
    await page.route("**/api/identity/bootstrap", (route) => {
      bootstraps++;
      return route.fulfill({
        json: {
          accountId: user.id,
          pubkey: getPublicKey(key),
          sessionToken: "ac".repeat(32),
          expiresAt: exp,
        },
      });
    });
    await page.route("**/api/identity/sign", (route) => {
      const body = route.request().postDataJSON();
      expect(body.session_token).toBe("ac".repeat(32));
      expect(route.request().headers().authorization).toBe(`Bearer ${jwt}`);
      if (denySign && body.event.kind === 9)
        return route.fulfill({
          status: 401,
          json: { error: "Your session has expired. Please sign in again." },
        });
      const event = body.event;
      return route.fulfill({
        json: finalizeEvent(
          {
            ...event,
            tags: [22242, 27235, 24242].includes(event.kind)
              ? [...event.tags, ["account-session", body.session_token]]
              : event.tags,
          },
          key,
        ),
      });
    });
    await page.route(
      "https://creatorhive-auth-test.supabase.co/auth/v1/authorize**",
      (route) =>
        route.fulfill({
          status: 302,
          headers: {
            location:
              "http://127.0.0.1:4174/chat?channel=markdown&code=fixture-code",
          },
        }),
    );
    await page.goto("/chat?channel=markdown");
    if (newMember) {
      await page.getByRole("button", { name: "Continue with Google" }).click();
    } else {
      await page.getByLabel("Email address").fill(user.email);
      await page
        .getByLabel("Password", { exact: true })
        .fill("a valid test password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
    }
    if (newMember) {
      await expect(page).toHaveURL("/onboarding");
      await expect(
        page.getByRole("heading", { name: "Make it yours." }),
      ).toBeVisible();
      await expect(page.getByLabel("Display name")).toHaveValue(
        "New Hive Member",
      );
      await waitForAnimations(page);
      await page.screenshot({
        path: "test-results/managed-onboarding-desktop.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByLabel("Display name")).toHaveValue(
        "New Hive Member",
      );
      await page.getByRole("button", { name: "Use Google photo" }).click();
      await expect(
        page.getByRole("img", { name: "Selected avatar" }),
      ).toBeVisible();
      await page.getByLabel("Display name").fill("A new creator");
      await expect(page.getByLabel("Username", { exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Claim your name." }),
      ).toBeFocused();
      await page.getByLabel("Username", { exact: true }).fill("taken");
      await expect(
        page.getByText("That username is taken. Try another."),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Claim username", exact: true })
        .click();
      await expect(page.getByRole("alert")).toContainText("available username");
      await page.getByLabel("Username", { exact: true }).fill("new_creator");
      await expect(page.getByText("@new_creator is available")).toBeVisible();
      await waitForAnimations(page);
      await page.screenshot({
        path: "test-results/managed-onboarding-mobile.png",
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page
        .getByRole("button", { name: "Claim username", exact: true })
        .click();
      await expect(page.getByRole("alert")).toContainText("already taken");
      await expect(page.getByText("@new_creator is yours.")).toHaveCount(0);
      expect(memberProfile).toBeNull();
      denyClaim = false;
      await page
        .getByRole("button", { name: "Claim username", exact: true })
        .click();
      await expect(page.getByRole("status")).toContainText(
        "@new_creator is yours.",
      );
      expect(memberProfile).toMatchObject({ username: "new_creator" });
      await expect(page.locator(".hive-claim")).toHaveAttribute(
        "data-celebrate",
        "true",
      );
      await waitForAnimations(page);
      await page.screenshot({
        path: "test-results/username-claimed-mobile.png",
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.screenshot({
        path: "test-results/username-claimed-desktop.png",
      });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(page.locator(".hive-claim-preview")).toHaveCSS(
        "animation-name",
        "none",
      );
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(page.getByRole("status")).toContainText(
        "@new_creator is yours.",
      );
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page
        .getByRole("checkbox", { name: "Vibe coding", exact: true })
        .check();
      await page
        .getByRole("checkbox", { name: "AI / ML", exact: true })
        .check();
      await page
        .getByLabel("What are you working on?", { exact: false })
        .fill("A private project");
      await page.getByRole("button", { name: "Enter the Hive" }).click();
      await expect(page.getByRole("alert")).toContainText(
        "Could not save your welcome progress",
      );
      await expect(page).toHaveURL("/onboarding");
      denyOnboardingSave = false;
      await page.getByRole("button", { name: "Enter the Hive" }).click();
      await expect(page).toHaveURL("/chat?channel=markdown");
      expect(photoUploads).toBe(1); // Retrying the completion marker must not upload twice.
      expect(
        fixture.published.some(
          (e) =>
            e.kind === 0 && JSON.parse(e.content).picture === uploadedPhoto,
        ),
      ).toBe(true);
      expect(memberProfile).toMatchObject({
        username: "new_creator",
        interests: ["vibe_coding", "ai_ml"],
        working_on: "A private project",
      });
      await expect(
        page.getByRole("complementary", { name: "Your private welcome" }),
      ).toBeVisible();
      expect(
        fixture.published.some(
          (e) => e.kind === 9 && e.content.includes("private project"),
        ),
      ).toBe(false);
      expect(user.user_metadata.creatorhive_onboarding).toHaveProperty(
        ["wss://chat.creatorhive.ai", "version"],
        1,
      );
      expect(
        fixture.published.some(
          (e) =>
            e.kind === 0 &&
            JSON.parse(e.content).display_name === "A new creator",
        ),
      ).toBe(true);
      // A browser with no tour marker still uses account metadata to skip the tour.
      await page.evaluate(() =>
        Object.keys(localStorage)
          .filter((k) => k.startsWith("creatorhive.onboarding."))
          .forEach((k) => {
            localStorage.removeItem(k);
          }),
      );
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto("/chat?channel=markdown");
    }
    const composer = page.getByRole("textbox", { name: "Message #markdown" });
    await expect(composer).toBeVisible();
    expect(
      await page.evaluate(() => localStorage.getItem("buzz.identity.nsec")),
    ).toBeNull();
    await page.reload();
    await expect(composer).toBeVisible();
    expect(bootstraps).toBeGreaterThan(1);
    denySign = true;
    await composer.fill("Keep this unsent draft");
    await composer.press("Enter");
    await expect(
      page.getByText("Your session has expired. Please sign in again.").first(),
    ).toBeVisible();
    await expect(composer).toHaveValue("Keep this unsent draft");
    expect(
      fixture.published.some((e) => e.content === "Keep this unsent draft"),
    ).toBe(false);
    denySign = false;
    await composer.press("Enter");
    await expect
      .poll(() =>
        fixture.published.some(
          (e) =>
            e.kind === 9 &&
            e.content === "Keep this unsent draft" &&
            e.pubkey === getPublicKey(key),
        ),
      )
      .toBe(true);
    await expect(composer).toHaveValue("");
    await page.goto("/agents");
    await page
      .getByRole("button", { name: "Create agent", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Promote a desktop agent…" }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Agent backup key")).toHaveCount(0);
  });
}

test("email access rejects invalid credentials, registers, and requests recovery", async ({
  page,
}) => {
  let signup: Record<string, unknown> | undefined;
  let recovery = "";
  await page.route("**/auth/v1/token**", (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      email: "member@example.invalid",
      password: "incorrect password",
    });
    return route.fulfill({
      status: 400,
      json: { code: "invalid_credentials", msg: "Invalid login credentials" },
    });
  });
  await page.route("**/auth/v1/signup**", (route) => {
    signup = route.request().postDataJSON();
    return route.fulfill({
      json: { user: { id: "test-user", identities: [] }, session: null },
    });
  });
  await page.route("**/auth/v1/recover**", (route) => {
    expect(route.request().postDataJSON().email).toBe("member@example.invalid");
    recovery = route.request().url();
    return route.fulfill({ json: {} });
  });
  await page.goto("/chat");
  await page.getByLabel("Email address").fill("member@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("incorrect password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Invalid login credentials",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("buzz.identity.nsec")),
  ).toBeNull();
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  await page
    .getByLabel("Password", { exact: true })
    .fill("a long test passphrase");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Check your email");
  expect(signup).toMatchObject({
    email: "member@example.invalid",
    password: "a long test passphrase",
  });
  await page.getByRole("button", { name: "Back to sign in" }).click();
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.getByRole("button", { name: "Send recovery email" }).click();
  await expect(page.getByRole("status")).toContainText(
    "recovery link is on its way",
  );
  expect(new URL(recovery).searchParams.get("redirect_to")).toBe(
    "http://127.0.0.1:4174/chat?account=recovery",
  );
});
