import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import { installCommunityFixture } from "../helpers/community";
import { waitForAnimations } from "../../../desktop/tests/helpers/animations";
import { socialPlatform } from "../../src/features/profile/social-platforms";

const profile = {
  username: "scott",
  display_name: "Sean Scott",
  bio: "Building useful things for curious people. Software, hardware, and the occasional late-night idea.",
  interests: ["software", "hardware"],
  build_status: "Building CreatorHive",
  build_url: "https://example.com/creatorhive",
  accent: "honey",
  collaborating: true,
  links: [{ label: "Website", url: "https://example.com" }],
  highlights: [
    {
      kind: "project",
      title: "UniDesk",
      description: "A quieter, more useful home for your work.",
      url: "https://example.com/unidesk",
      image: null,
    },
    {
      kind: "project",
      title: "The workshop",
      description: "Small experiments that become real things.",
      url: "https://example.com/workshop",
      image: null,
    },
    {
      kind: "pulse",
      event_id: "ab".repeat(32),
      text: "Shipped the first version today. The best part was building it together.",
    },
  ],
  avatar: null,
  cover: "ad8d1f1d-964c-44ea-9900-a155b7d5a46d",
  visibility: "public",
  published: true,
};

test("public portfolio loads directly without auth or chat, mobile and desktop", async ({
  page,
}) => {
  const privateRequests: string[] = [];
  page.on("request", (r) => {
    if (/\/api\/identity|\/query|\/rest\//.test(r.url()))
      privateRequests.push(r.url());
  });
  const sockets: string[] = [];
  page.on("websocket", (s) => sockets.push(s.url()));
  await page.route("**/api/profiles/scott", (r) =>
    r.fulfill({ json: profile }),
  );
  await page.route("**/api/profile-images/*", (r) =>
    r.fulfill({
      body: readFileSync("public/creatorhive-workshop.png"),
      contentType: "image/png",
    }),
  );
  await page.goto("/@scott");
  await expect(page.getByRole("heading", { name: "Sean Scott" })).toBeVisible();
  await page.getByRole("tab", { name: /Pulse/ }).click();
  await expect(
    page.getByText("Shipped the first version today.", { exact: false }),
  ).toBeVisible();
  expect(privateRequests).toEqual([]);
  expect(sockets).toEqual([]);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex, nofollow",
  );
  await page.getByRole("tab", { name: /Work/ }).click();
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/public-profile-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/public-profile-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sean Scott" })).toBeVisible();
  await page.goto("/chat");
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
});

test("private and removed profiles disclose no identity, with retry", async ({
  page,
}) => {
  let available = false;
  await page.route("**/api/profiles/scott", (r) =>
    available
      ? r.fulfill({ json: profile })
      : r.fulfill({ status: 404, json: { error: "Profile unavailable" } }),
  );
  await page.goto("/@scott");
  await expect(
    page.getByRole("heading", { name: "Profile unavailable" }),
  ).toBeVisible();
  await expect(page.getByText("Sean Scott")).toHaveCount(0);
  available = true;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("heading", { name: "Sean Scott" })).toBeVisible();
});

async function signedIn(page: Page, selfProfile: Record<string, unknown> = {}) {
  const key = generateSecretKey();
  const fixture = await installCommunityFixture(page, "Community message", {
    noIdentity: true,
    identitySecret: key,
    selfProfile: { display_name: "Sean Scott", ...selfProfile },
  });
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = {
    id: "ab73b77f-f9bd-42d8-9425-2af4f31101a0",
    aud: "authenticated",
    role: "authenticated",
    email: "member@example.invalid",
    email_confirmed_at: new Date().toISOString(),
    app_metadata: {},
    user_metadata: {
      creatorhive_onboarding: { "wss://chat.creatorhive.ai": { version: 1 } },
    },
  };
  const jwt = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, exp, session_id: "65fbdc7e-e99c-47af-8911-f7d9d7153b7d", role: "authenticated" })).toString("base64url")}.test`;
  await page.addInitScript(
    ({ user, jwt, exp }) =>
      localStorage.setItem(
        "sb-creatorhive-auth-test-auth-token",
        JSON.stringify({
          access_token: jwt,
          token_type: "bearer",
          expires_in: 3600,
          expires_at: exp,
          refresh_token: "test-refresh",
          user,
        }),
      ),
    { user, jwt, exp },
  );
  await page.route("**/auth/v1/user", (r) => r.fulfill({ json: user }));
  await page.route("**/api/identity/bootstrap", (r) =>
    r.fulfill({
      json: {
        accountId: user.id,
        pubkey: getPublicKey(key),
        sessionToken: "ac".repeat(32),
        expiresAt: exp,
      },
    }),
  );
  await page.route("**/api/identity/sign", (r) => {
    const b = r.request().postDataJSON();
    return r.fulfill({
      json: finalizeEvent(
        {
          ...b.event,
          tags: [22242, 27235, 24242].includes(b.event.kind)
            ? [...b.event.tags, ["account-session", b.session_token]]
            : b.event.tags,
        },
        key,
      ),
    });
  });
  return fixture;
}

async function openProfileEditor(page: Page) {
  await page.getByRole("button", { name: "Account", exact: false }).click();
  await page
    .getByRole("button", { name: "Edit public profile", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Edit public profile", exact: true }),
  ).toBeVisible();
}

test("chat profile retries a missing endpoint and handles an unpublished member", async ({
  page,
}) => {
  const fixture = await signedIn(page);
  let attempt = 0;
  await page.route("**/api/identity/profile/search", (r) => {
    attempt += 1;
    return attempt === 1
      ? r.fulfill({ status: 404, body: "" })
      : r.fulfill({
          json:
            attempt === 2
              ? []
              : [{ username: "scott", display_name: "Sean Scott" }],
        });
  });
  await page.route("**/api/profiles/scott", (r) =>
    r.fulfill({
      json: { ...profile, cover: null, member_key: fixture.builder },
    }),
  );
  await page.goto("/chat");
  await page
    .getByRole("button", { name: "View Builder’s profile", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Builder" })).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Message Builder" }),
  ).toBeVisible();
  await expect(dialog).toContainText(
    "Profiles aren’t available on this server yet.",
  );
  await expect(dialog).not.toContainText("Account service is unavailable");
  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(dialog).toContainText(
    "This member hasn’t published a profile yet.",
  );
  await expect(dialog.getByRole("heading", { name: "Builder" })).toBeVisible();
  await dialog.locator("summary").click();
  await expect(
    dialog.getByRole("button", { name: "Share profile" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "Sean Scott" }),
  ).toBeVisible();
  await expect(
    dialog.locator(".portfolio-presence").getByRole("img", { name: "Online" }),
  ).toBeVisible();
  await page.evaluate(() => document.documentElement.classList.remove("light"));
  await waitForAnimations(page);
  await expect(
    dialog.getByRole("button", { name: "Message @scott" }),
  ).toBeInViewport();
  await dialog.screenshot({
    path: "../outputs/profile-card-review/profile-card-desktop.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.classList.add("light"));
  await waitForAnimations(page);
  await page.screenshot({
    path: "../outputs/profile-card-review/profile-card-mobile.png",
  });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await dialog
    .getByRole("button", { name: "View profile", exact: true })
    .click();
  await expect(dialog.getByRole("tab", { name: /Work/ })).toBeVisible();
  await expect(page).toHaveURL(/\/chat/);
  expect(attempt).toBe(3);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page
      .getByRole("button", { name: "View Builder’s profile", exact: true })
      .first(),
  ).toBeFocused();
});

test("social badges use exact destinations, not labels or lookalike domains", () => {
  expect(socialPlatform("https://www.twitch.tv/creator")?.name).toBe("Twitch");
  expect(socialPlatform("https://youtube.com/@creator")?.name).toBe("YouTube");
  expect(socialPlatform("https://twitter.com/creator")?.name).toBe(
    "X / Twitter",
  );
  for (const url of [
    "javascript:alert(1)",
    "https://twitch.tv.evil.test/creator",
    "https://twitch.tv@evil.test/creator",
    "https://user:password@twitch.tv/creator",
    "not a url",
  ]) {
    expect(socialPlatform(url)).toBeUndefined();
  }
});

test("customization saves social links, project images, order and appearance", async ({
  page,
}) => {
  await signedIn(page);
  let current = {
    ...profile,
    links: [] as typeof profile.links,
    highlights: [] as typeof profile.highlights,
    cover: null as string | null,
  };
  let saves = 0;
  const imageId = "d382fc1f-2b5c-4c54-805e-8a21bc4561df";
  await page.route("**/api/identity/profile/own", (r) =>
    r.fulfill({ json: current }),
  );
  await page.route("**/api/identity/profile/save", (r) => {
    saves += 1;
    const data = r.request().postDataJSON();
    current = { ...current, ...data.presentation, visibility: data.visibility };
    return r.fulfill({
      json: { saved: true, published: true, publication_enabled: true },
    });
  });
  await page.route("**/api/identity/profile/image", (r) =>
    r.fulfill({ json: { id: imageId } }),
  );
  await page.route("**/api/profile-images/*", (r) =>
    r.fulfill({
      contentType: "image/png",
      body: readFileSync("public/creatorhive-workshop.png"),
    }),
  );
  await page.goto("/chat?channel=markdown");
  await openProfileEditor(page);
  await page
    .getByRole("button", { name: "Socials & links", exact: true })
    .click();
  await page.getByRole("button", { name: "Twitch", exact: true }).click();
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await page
    .getByRole("button", { name: /^Save (profile|draft)$/, exact: true })
    .first()
    .click();
  await expect(page.getByLabel("Twitch URL", { exact: true })).toBeFocused();
  expect(saves).toBe(0);
  await page
    .getByLabel("Twitch URL", { exact: true })
    .fill("https://twitch.tv/hivebuilder");
  await page.getByRole("button", { name: "YouTube", exact: true }).click();
  await page
    .getByLabel("YouTube URL", { exact: true })
    .fill("https://youtube.com/@hivebuilder");
  await page.getByRole("button", { name: "X / Twitter", exact: true }).click();
  await page
    .getByLabel("X / Twitter URL", { exact: true })
    .fill("https://x.com/hivebuilder");
  await page.getByRole("button", { name: "Move link 3 up" }).click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("button", { name: "lavender accent" }).click();
  await page
    .getByLabel("Cover image", { exact: true })
    .setInputFiles("public/creatorhive-workshop.png");
  await expect(
    page
      .getByRole("button", { name: /^Save (profile|draft)$/, exact: true })
      .first(),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Featured work", exact: true })
    .click();
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  await page
    .getByLabel("Project title", { exact: true })
    .fill("Stream toolkit");
  await page
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("The tools behind my live builds.");
  await page
    .getByLabel("Project link", { exact: true })
    .fill("https://example.com/toolkit");
  await page
    .getByLabel("Project image", { exact: true })
    .setInputFiles("public/creatorhive-workshop.png");
  await expect(
    page
      .getByRole("button", { name: /^Save (profile|draft)$/, exact: true })
      .first(),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  await page
    .getByLabel("Project title", { exact: true })
    .nth(1)
    .fill("Creator studio");
  await page
    .getByRole("textbox", { name: "Description", exact: true })
    .nth(1)
    .fill("A home for our next big idea.");
  await page
    .getByLabel("Project link", { exact: true })
    .nth(1)
    .fill("https://example.com/studio");
  await page.getByRole("button", { name: "Move highlight 2 up" }).click();
  const preview = page.getByRole("complementary", { name: "Profile preview" });
  await expect(preview.locator(".portfolio-featured strong")).toHaveText(
    "Creator studio",
  );
  await expect(preview.locator(".portfolio-social-mark")).toHaveCount(3);
  await page
    .getByRole("button", { name: /^Save (profile|draft)$/, exact: true })
    .first()
    .click();
  await expect(page.getByRole("status")).toContainText("Profile saved.");
  expect(current.links.map((link) => link.label)).toEqual([
    "Twitch",
    "X / Twitter",
    "YouTube",
  ]);
  expect(current.highlights).toMatchObject([
    { title: "Creator studio" },
    { title: "Stream toolkit", image: imageId },
  ]);
  expect(current).toMatchObject({ accent: "lavender", cover: imageId });
  await page.reload();
  await openProfileEditor(page);
  await page
    .getByRole("button", { name: "Socials & links", exact: true })
    .click();
  await expect(page.getByLabel("Twitch URL", { exact: true })).toHaveValue(
    "https://twitch.tv/hivebuilder",
  );
  await page
    .getByRole("button", { name: "Featured work", exact: true })
    .click();
  await expect(
    page.getByLabel("Project title", { exact: true }).first(),
  ).toHaveValue("Creator studio");
  await page
    .getByRole("navigation", { name: "Profile customization" })
    .getByRole("button", { name: "Socials & links" })
    .click();
  await waitForAnimations(page);
  await page.screenshot({
    path: "../outputs/profile-card-review/profile-social-editor-desktop.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("navigation", { name: "Profile customization" })
    .getByRole("button", { name: "Featured work" })
    .click();
  await waitForAnimations(page);
  await page.screenshot({
    path: "../outputs/profile-card-review/profile-project-editor-mobile.png",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Preview as visitor" }).click();
  await expect(
    page.getByRole("heading", { name: "Featured projects" }),
  ).toBeVisible();
  await expect(page.locator(".portfolio-project h3").first()).toHaveText(
    "Creator studio",
  );
  await waitForAnimations(page);
  await page.screenshot({
    path: "../outputs/profile-card-review/profile-customized-mobile.png",
    fullPage: true,
  });
});

test("unclaimed owners keep their chat identity and can continue profile setup", async ({
  page,
}) => {
  const fixture = await signedIn(page, {
    about: "Making useful things with the Hive.",
    name: "unverified_handle",
    picture: "https://tracker.invalid/avatar.png",
  });
  await page.route("**/api/identity/profile/own", (r) =>
    r.fulfill({
      status: 409,
      json: { error: "Claim your username in onboarding first." },
    }),
  );
  await page.goto("/chat?channel=markdown");
  await page
    .getByRole("button", { name: "View Sean Scott’s profile", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Sean Scott" }),
  ).toBeVisible();
  await expect(dialog).toContainText("Making useful things with the Hive.");
  await expect(dialog).toContainText(
    "Claim your username in onboarding first.",
  );
  await expect(
    dialog.getByRole("link", { name: "Set up profile" }),
  ).toHaveAttribute("href", "/onboarding");
  await expect(dialog.locator(".portfolio-handle")).toHaveCount(0);
  await expect(dialog.getByText("Only you can see this draft")).toHaveCount(0);
  expect(fixture.receivedRemote).toEqual([]);
  await waitForAnimations(page);
  await dialog.screenshot({
    path: "../outputs/profile-card-review/profile-card-unclaimed.png",
  });
  await dialog.getByRole("link", { name: "Set up profile" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
});

test("members can open a conversation before publishing a profile", async ({
  page,
}) => {
  const fixture = await signedIn(page);
  await page.route("**/api/identity/profile/search", (r) =>
    r.fulfill({ json: [] }),
  );
  await page.goto("/chat?channel=markdown");
  await page
    .getByRole("button", { name: "View Builder’s profile", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(
    "This member hasn’t published a profile yet.",
  );
  await dialog.getByRole("button", { name: "Message Builder" }).click();
  await expect(page).toHaveURL(/channel=dm/);
  await expect(dialog).toHaveCount(0);
  expect(fixture.published.filter((event) => event.kind === 41010)).toEqual([
    expect.objectContaining({ tags: [["p", fixture.builder]] }),
  ]);
});

test("owners can open an unpublished profile without publishing it", async ({
  page,
}) => {
  await signedIn(page);
  let writes = 0;
  await page.route("**/api/identity/profile/own", (r) =>
    r.fulfill({ json: { ...profile, published: false, cover: null } }),
  );
  await page.route("**/api/identity/profile/save", (r) => {
    writes += 1;
    return r.fulfill({ json: {} });
  });
  await page.goto("/chat?channel=markdown");
  await page
    .getByRole("button", { name: "View Sean Scott’s profile", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Sean Scott" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Edit profile", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Share profile" }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Edit profile", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Edit public profile",
    exact: true,
  });
  await expect(
    editor.getByRole("textbox", { name: "Bio", exact: true }),
  ).toHaveValue(profile.bio);
  await expect(page).toHaveURL(/\/chat\?channel=markdown$/);
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Edit profile", exact: true }),
  ).toBeFocused();
  expect(writes).toBe(0);
});

test("public profile owners edit in a modal without leaving their profile", async ({
  page,
}) => {
  const fixture = await signedIn(page);
  await page.route("**/api/profiles/scott", (route) =>
    route.fulfill({
      json: { ...profile, owner: true, member_key: fixture.self, cover: null },
    }),
  );
  await page.route("**/api/identity/profile/own", (route) =>
    route.fulfill({ json: { ...profile, cover: null } }),
  );
  await page.goto("/@scott");
  const trigger = page.getByRole("button", {
    name: "Edit profile",
    exact: true,
  });
  await trigger.click();
  const editor = page.getByRole("dialog", {
    name: "Edit public profile",
    exact: true,
  });
  await expect(
    editor.getByRole("textbox", { name: "Bio", exact: true }),
  ).toHaveValue(profile.bio);
  await expect(page).toHaveURL(/\/@scott$/);
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("editor retains failed drafts, saves visibility and ordered projects without private fields", async ({
  page,
}) => {
  await signedIn(page);
  await page.route("**/api/identity/profile/own", (r) =>
    r.fulfill({
      json: {
        ...profile,
        highlights: profile.highlights.slice(0, 2),
        publication_enabled: false,
      },
    }),
  );
  let reject = true;
  let body: unknown = null;
  await page.route("**/api/identity/profile/save", (r) => {
    body = r.request().postDataJSON();
    return reject
      ? r.fulfill({
          status: 400,
          json: { error: "Please edit the blocked language." },
        })
      : r.fulfill({
          json: { saved: true, published: false, publication_enabled: false },
        });
  });
  await page.route("**/api/profile-images/*", (r) =>
    r.fulfill({ status: 404 }),
  );
  await page.goto("/chat?channel=markdown");
  await openProfileEditor(page);
  await expect(
    page.getByRole("heading", { name: "Edit public profile", exact: true }),
  ).toBeVisible();
  const editor = page.getByRole("dialog", {
    name: "Edit public profile",
    exact: true,
  });
  await expect(page).toHaveURL(/\/chat\?channel=markdown$/);
  await expect(
    editor.getByRole("textbox", { name: "Bio", exact: true }),
  ).toHaveValue(profile.bio);
  await page.evaluate(() => document.documentElement.classList.remove("light"));
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/public-profile-editor-desktop.png",
  });
  await page
    .getByRole("textbox", { name: "Bio", exact: true })
    .fill("A carefully selected public introduction.");
  await page
    .getByLabel("Currently building", { exact: true })
    .fill("Making the Hive feel like home");
  await page.getByLabel("Who can see this profile?").selectOption("members");
  await page
    .getByRole("button", { name: "Featured work", exact: true })
    .click();
  await page.getByRole("button", { name: "Move highlight 2 up" }).click();
  await page
    .getByRole("button", { name: /^Save (profile|draft)$/, exact: true })
    .first()
    .click();
  await expect(editor.getByRole("alert")).toContainText("blocked language");
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Bio", exact: true }),
  ).toHaveValue("A carefully selected public introduction.");
  reject = false;
  await page
    .getByRole("button", { name: /^Save (profile|draft)$/, exact: true })
    .first()
    .click();
  await expect(editor.getByRole("status")).toContainText("Draft saved");
  expect(body).toMatchObject({
    visibility: "members",
    presentation: {
      bio: "A carefully selected public introduction.",
      build_status: "Making the Hive feel like home",
      highlights: [{ title: "The workshop" }, { title: "UniDesk" }],
    },
  });
  expect(JSON.stringify(body)).not.toMatch(
    /account_id|working_on|sealed_secret|username/,
  );
  await page.getByRole("button", { name: "Preview as visitor" }).click();
  await expect(page.getByRole("heading", { name: "Sean Scott" })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Bio", exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/public-profile-editor-mobile.png",
  });
  const bounds = await editor.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds?.width).toBeLessThan(390);
  expect(bounds?.height).toBeLessThan(844);
  expect(
    await editor.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page).toHaveURL(/\/chat\?channel=markdown$/);
  await expect(
    page.getByRole("button", { name: "Edit public profile", exact: true }),
  ).toBeFocused();
});

test("onboarding reviews publication without publishing private answers", async ({
  page,
}) => {
  test.skip(
    process.env.PROFILE_ONBOARDING_TEST !== "1",
    "Run with VITE_PUBLIC_PROFILES=true PROFILE_ONBOARDING_TEST=1",
  );
  await signedIn(page);
  await page.route("**/rest/v1/rpc/creatorhive_profile", (r) =>
    r.fulfill({
      json: {
        username: "scott",
        display_name: "Sean Scott",
        interests: ["hardware"],
        working_on: "PRIVATE answer",
      },
    }),
  );
  await page.route("**/api/identity/profile/own", (r) =>
    r.fulfill({
      json: {
        ...profile,
        published: false,
        interests: [],
        bio: "",
        highlights: [],
        links: [],
        cover: null,
      },
    }),
  );
  let published: unknown = null;
  await page.route("**/api/identity/profile/save", (r) => {
    published = r.request().postDataJSON();
    return r.fulfill({
      json: { saved: true, published: true, publication_enabled: true },
    });
  });
  await page.goto("/onboarding");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Review profile" }),
  ).toBeVisible();
  expect(published).toBeNull();
  await page.getByRole("button", { name: "Review profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Meet the Hive." }),
  ).toBeVisible();
  await expect(page.getByText("PRIVATE answer")).toHaveCount(0);
  await page.getByLabel("Who can see your profile?").selectOption("members");
  await page.getByRole("button", { name: "Enter the Hive" }).click();
  await expect.poll(() => published).not.toBeNull();
  expect(published).toMatchObject({
    visibility: "members",
    presentation: { interests: [], bio: "" },
  });
  expect(JSON.stringify(published)).not.toContain("PRIVATE answer");
});

test("profile drafts recover after reload, validate before preview and clear on save", async ({
  page,
}) => {
  await signedIn(page);
  let current = { ...profile, cover: null, publication_enabled: false };
  let saves = 0;
  await page.route("**/api/identity/profile/own", (route) =>
    route.fulfill({ json: current }),
  );
  await page.route("**/api/identity/profile/save", (route) => {
    saves++;
    const body = route.request().postDataJSON();
    current = { ...current, ...body.presentation };
    return route.fulfill({ json: { published: false } });
  });
  await page.goto("/chat?channel=markdown");
  await openProfileEditor(page);
  const editor = page.getByRole("dialog", {
    name: "Edit public profile",
    exact: true,
  });
  await editor
    .getByRole("textbox", { name: "Bio", exact: true })
    .fill("A draft I can come back to.");
  await expect(
    editor.getByText("Unsaved changes", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await openProfileEditor(page);
  await expect(
    editor.getByRole("textbox", { name: "Bio", exact: true }),
  ).toHaveValue("A draft I can come back to.");
  await expect(
    editor.getByText("Restored your unsaved changes from this tab."),
  ).toBeVisible();
  await editor
    .getByRole("button", { name: "Socials & links", exact: true })
    .click();
  await editor.getByRole("button", { name: "Twitch", exact: true }).click();
  await editor.getByRole("button", { name: "Profile", exact: true }).click();
  await editor.getByRole("button", { name: "Preview as visitor" }).click();
  await expect(editor.getByLabel("Twitch URL", { exact: true })).toBeFocused();
  expect(saves).toBe(0);
  await editor
    .getByLabel("Twitch URL", { exact: true })
    .fill("https://twitch.tv/draftbuilder");
  await editor.getByRole("button", { name: "Preview as visitor" }).click();
  await expect(
    editor.getByRole("button", { name: "Back to editing" }),
  ).toBeVisible();
  await editor
    .getByRole("button", { name: /^Save (profile|draft)$/, exact: true })
    .click();
  await expect(
    editor.getByText("Draft saved.", { exact: false }),
  ).toBeVisible();
  expect(saves).toBe(1);
  await expect(
    editor.getByText("Unsaved changes", { exact: true }),
  ).toHaveCount(0);
  await editor.getByRole("button", { name: "Back to editing" }).click();
  await editor.getByRole("button", { name: "Profile", exact: true }).click();
  await editor
    .getByRole("textbox", { name: "Bio", exact: true })
    .fill("Throw this change away");
  await editor.getByRole("button", { name: "Discard changes" }).click();
  await expect(
    editor.getByRole("textbox", { name: "Bio", exact: true }),
  ).toHaveValue("A draft I can come back to.");
  await page.reload();
  await openProfileEditor(page);
  await expect(
    editor.getByText("Restored your unsaved changes from this tab."),
  ).toHaveCount(0);
  await expect(
    editor.getByRole("textbox", { name: "Bio", exact: true }),
  ).toHaveValue("A draft I can come back to.");
});

test("connected apps offers recovery when the account provider fails", async ({
  page,
}) => {
  await signedIn(page);
  let attempts = 0;
  await page.route("**/auth/v1/user/oauth/grants", (route) => {
    attempts++;
    return attempts === 1
      ? route.fulfill({ status: 400, json: { message: "Unavailable" } })
      : route.fulfill({ json: [] });
  });
  await page.goto("/chat?channel=markdown");
  await page.getByRole("button", { name: /^Account/ }).click();
  const section = page
    .getByRole("heading", { name: "Connected apps", exact: true })
    .locator("..");
  await expect(section.getByRole("alert")).toContainText(
    "Could not load connected apps",
  );
  await section.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    section.getByText("No apps have access to your account."),
  ).toBeVisible();
  expect(attempts).toBe(2);
});
