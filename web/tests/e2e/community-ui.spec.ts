import { expect, test } from "@playwright/test";
import { installCommunityFixture } from "../helpers/community";
import { waitForAnimations } from "../../../desktop/tests/helpers/animations";

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 768, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`community surfaces and keyboard navigation at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await installCommunityFixture(
      page,
      [
        "## Build update",
        "The replay bookmarks are ready for a first look. **Pick up exactly where you left off**, without scrubbing through the whole stream.",
        "- Save a moment while watching\n- Jump back to the decision behind a change\n- Share a timestamp with another member",
        "The next step is trying it with a real build session. What would make this useful for your workflow?",
      ].join("\n\n"),
    );
    const capture = async (name: string) => {
      await waitForAnimations(page);
      await page.screenshot({
        path: testInfo.outputPath(`${name}-${viewport.width}.png`),
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    };
    await page.goto("/chat?channel=markdown");
    await expect(page.locator(".message-markdown h2")).toHaveText(
      "Build update",
    );
    const header = await page.locator(".hive-chat-header").boundingBox();
    if (!header) throw new Error("Channel header is missing");
    expect(header.y + header.height).toBeLessThanOrEqual(100);
    await expect(page.locator("html")).toHaveCSS(
      "font-size",
      viewport.width < 768 ? "18px" : "20px",
    );
    if (viewport.width === 1440) {
      const memberRow = await page
        .getByRole("complementary", { name: "Member list" })
        .getByRole("listitem")
        .first()
        .boundingBox();
      expect(memberRow?.height).toBeLessThanOrEqual(56);
    }
    await page.locator(".hive-timeline").evaluate((el) => {
      el.scrollTop = 0;
    });
    await capture("chat");
    if (viewport.width === 390) {
      await expect(
        page.getByRole("navigation", { name: "Community", exact: true }),
      ).not.toBeVisible();
      await page.getByRole("button", { name: "Channels", exact: true }).click();
      await expect(
        page.getByRole("navigation", { name: "Community", exact: true }),
      ).toBeVisible();
      await capture("navigation");
      const theme = page.getByRole("button", { name: /Theme:/ });
      const previousTheme = (await theme.getAttribute("aria-label")) ?? "";
      await theme.focus();
      await page.keyboard.press("Enter");
      await expect(theme).not.toHaveAttribute("aria-label", previousTheme);
      await page.keyboard.press("Escape");
    }
    await page.getByRole("button", { name: "Members", exact: true }).click();
    await expect(
      page.getByText("2 in this channel", { exact: false }),
    ).toBeVisible();
    await capture("members");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "1 reply →", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Thread", exact: true }),
    ).toBeVisible();
    await capture("thread");
    await page.keyboard.press("Escape");
    if (viewport.width === 390)
      await page.getByRole("button", { name: "Channels", exact: true }).click();
    await page
      .getByRole("button", { name: "Your profile", exact: false })
      .click();
    const dialog = page.getByRole("dialog", { name: "Your account" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByLabel("Display name", { exact: true }),
    ).toBeVisible();
    await capture("profile");
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await page.goto("/chat?channel=markdown");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const searchDialog = page.getByRole("dialog", { name: "Search the hive" });
    await expect(searchDialog.getByRole("textbox")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    expect(
      await searchDialog.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
    await page.keyboard.press("Escape");
    if (viewport.width === 390)
      await page.getByRole("button", { name: "Channels", exact: true }).click();
    await page
      .getByRole("button", { name: "New message", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "New message" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.goto("/chat?channel=dm");
    await expect(
      page.getByRole("textbox", { name: "Message Builder" }),
    ).toBeVisible();
    for (const [route, title] of [
      ["pulse", "Pulse"],
      ["inbox", "Inbox"],
      ["workflows", "Workflows"],
      ["agents", "Agents"],
      ["live", "CreatorHive Live"],
      ["community", "Community settings"],
    ]) {
      await page.goto(`/${route}`);
      await expect(
        page.getByRole("heading", { name: title, exact: true }),
      ).toBeVisible();
      await expect(page.locator(".hive-chat-sidebar")).toHaveCount(1);
      if (route === "agents")
        await expect(
          page.getByText("Cloud service unavailable", { exact: true }),
        ).toBeVisible();
      if (route === "workflows") {
        await page
          .getByRole("button", { name: "Weekly build roundup", exact: false })
          .click();
        await expect(
          page.getByLabel("Workflow definition", { exact: true }),
        ).toHaveAttribute("readonly", "");
      }
      await capture(route);
      if (viewport.width === 390) {
        await page.getByLabel("Open community navigation").click();
        if (route !== "community")
          await expect(
            page
              .locator(".hive-chat-sidebar")
              .locator(
                `a[href="/${route === "workflows" ? "agents" : route}"]:visible`,
              ),
          ).toHaveAttribute("aria-current", "page");
      }
    }
  });
}

test("presence expires without another member heartbeat", async ({ page }) => {
  await page.clock.install();
  await installCommunityFixture(page);
  await page.goto("/chat?channel=markdown");
  await expect(page.getByText("2 members online")).toBeVisible();
  await page.clock.runFor(210_000);
  await expect(page.getByText("1 member online")).toBeVisible();
});

test("every member page inherits the same shell and theme", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "dark" });
  await installCommunityFixture(page);
  await page.goto("/chat?channel=markdown");
  const appearance = () =>
    page.locator(".hive-chat-sidebar").evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        width: el.getBoundingClientRect().width,
        background: style.backgroundColor,
        font: style.fontFamily,
      };
    });
  for (const theme of ["dark", "light"]) {
    if (theme === "light")
      await page.getByRole("button", { name: /Theme:/ }).click();
    await expect(page.locator("html")).toHaveClass(theme);
    const expected = await appearance();
    for (const route of [
      "chat",
      "live",
      "pulse",
      "inbox",
      "agents",
      "workflows",
      "community",
    ]) {
      if (route === "workflows") {
        await page.getByText("Advanced", { exact: true }).click();
        await page
          .getByRole("link", { name: "Workflows", exact: true })
          .click();
      } else if (route === "community") {
        await page.getByRole("button", { name: /Your profile/ }).click();
        await page
          .getByRole("link", { name: "Community settings", exact: true })
          .click();
      } else {
        await page
          .locator(`.hive-chat-sidebar a[href^="/${route}"]`)
          .first()
          .click();
      }
      await expect(page).toHaveURL(new RegExp(`/${route}(\\?|$)`));
      await expect(page.locator("html")).toHaveClass(theme);
      await expect(page.locator(".hive-chat-sidebar")).toHaveCount(1);
      await expect.poll(appearance).toEqual(expected);
      await expect(
        page.getByRole("button", { name: "Announcements", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Search the Hive", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: /Theme:/ })).toBeVisible();
      expect(
        await page
          .locator(".hive-chat-header h1")
          .evaluate((el) => getComputedStyle(el).fontSize),
      ).toBe("18.75px");
      if (route !== "chat") {
        expect(
          await page.locator(".hive-community-page").evaluate((el) => {
            const style = getComputedStyle(el);
            const app = el.closest(".hive-chat-workspace");
            return (
              app !== null &&
              style.color !== style.backgroundColor &&
              style.backgroundColor === getComputedStyle(app).backgroundColor
            );
          }),
        ).toBe(true);
      }
    }
  }
});

test("onboarding stays readable before an identity exists", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/chat");
  await expect(
    page.getByRole("heading", { name: "Welcome back to the Hive" }),
  ).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({ path: testInfo.outputPath("welcome-390.png") });
});

test("unavailable attachments show a useful error for fetch and decode failures", async ({
  page,
}) => {
  await installCommunityFixture(page);
  for (const status of [503, 200]) {
    await page.route("**/media/**", (route) =>
      route.fulfill({ status, contentType: "text/html", body: "not an image" }),
    );
    await page.goto("/chat?channel=markdown");
    await expect(
      page.getByText(
        "Attachment unavailable. Try reopening this conversation.",
      ),
    ).toBeVisible();
  }
});

test("studio chat uses real context, themes, and channel-scoped actions", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "dark" });
  const fixture = await installCommunityFixture(
    page,
    "The welcome flow is ready for a first look. **What should we improve next?**",
    {
      selfProfile: { display_name: "Sean" },
      channelName: "the-workshop",
      channelAbout: "A little progress, shared every day.",
    },
  );
  await page.goto("/chat?channel=markdown");
  const context = page.getByRole("complementary", { name: "Member list" });
  await expect(
    context.getByRole("heading", { name: "Members 2" }),
  ).toBeVisible();
  await expect(
    context.getByRole("listitem").filter({ hasText: "Builder" }),
  ).toBeVisible();
  await expect(context.getByText("owner", { exact: true })).toBeVisible();
  await expect(
    context.getByText("#the-workshop", { exact: true }),
  ).toBeVisible();
  await expect(context.getByRole("listitem")).toHaveCount(2);
  await expect(page.locator(".hive-chat-date")).toHaveCount(1);
  await expect(
    page.getByRole("img", { name: "attachment", exact: true }),
  ).toHaveJSProperty("complete", true);
  for (const mode of ["dark", "light"]) {
    if (mode === "light")
      await page.getByRole("button", { name: /Theme:/ }).click();
    await expect(page.locator("html")).toHaveClass(mode);
    const message = page.locator(".hive-message .message-markdown").first();
    await expect(message.locator("p").first()).toHaveCSS(
      "color",
      await message.evaluate((el) => getComputedStyle(el).color),
    );
    await waitForAnimations(page);
    await page.screenshot({
      path: testInfo.outputPath(`studio-chat-${mode}.png`),
    });
  }
  await page.getByRole("button", { name: "1 reply →", exact: true }).click();
  await expect(context).not.toBeVisible();
  await page
    .getByRole("textbox", { name: "Reply in thread" })
    .fill("Keep the first step simple.");
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await expect
    .poll(() =>
      fixture.published.some(
        (e) =>
          e.kind === 9 &&
          e.content === "Keep the first step simple." &&
          e.tags.some((t) => t[0] === "h" && t[1] === "markdown"),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(context).toBeVisible();
  await page.getByRole("button", { name: /^Builder(?: \d+)?$/ }).click();
  await expect(page).toHaveURL(/channel=dm/);
  await expect(
    page.getByRole("textbox", { name: "Message Builder" }),
  ).toBeVisible();
  await expect(
    context.getByRole("link", { name: /A seat in the studio/ }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "# the-workshop", exact: true })
    .click();
  await expect(page).toHaveURL(/channel=markdown/);
  await page
    .getByRole("textbox", { name: "Message #the-workshop" })
    .fill("Ready for the next build.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect
    .poll(() =>
      fixture.published.some(
        (e) =>
          e.kind === 9 &&
          e.content === "Ready for the next build." &&
          e.tags.some((t) => t[0] === "h" && t[1] === "markdown"),
      ),
    )
    .toBe(true);
  await page.locator(".hive-message").first().hover();
  await page
    .getByRole("button", { name: "React 👍", exact: true })
    .first()
    .click();
  await expect
    .poll(() =>
      fixture.published.some(
        (e) =>
          e.kind === 7 &&
          e.tags.some((t) => t[0] === "h" && t[1] === "markdown"),
      ),
    )
    .toBe(true);
});

for (const [role, policy] of [
  ["member", "admins"],
  ["owner", "admins"],
  ["member", "all"],
] as const) {
  test(`Announcements entry respects ${role} access and ${policy} publishing`, async ({
    page,
  }) => {
    await installCommunityFixture(page, "This week in CreatorHive.", {
      role,
      policy,
      channelName: "announcements",
    });
    await page.goto("/chat?channel=dm");
    await page
      .getByRole("button", { name: "Announcements", exact: true })
      .click();
    await expect(page).toHaveURL(/view=announcements/);
    await expect(
      page.getByRole("heading", { name: /#announcements$/, level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Announcements", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    if (role === "member" && policy === "admins") {
      await expect(
        page.getByRole("textbox", { name: "Message #announcements" }),
      ).toHaveCount(0);
      await expect(
        page.getByText(
          "Announcements · Only channel owners and admins can publish. You can read and react here.",
          { exact: true },
        ),
      ).toBeVisible();
    } else
      await expect(
        page.getByRole("textbox", { name: "Message #announcements" }),
      ).toBeVisible();
  });
}

test("Announcements stays discoverable without a channel and explains missing access", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installCommunityFixture(page, undefined, { noChannels: true });
  await page.goto("/chat");
  await page.getByRole("button", { name: "Channels", exact: true }).click();
  await page
    .getByRole("button", { name: "Announcements", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Announcements", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Announcements aren’t available to your account yet/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toHaveCount(0);
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("announcements-unavailable-390.png"),
  });
});

for (const forgedRoster of [false, true]) {
  test(`member sidebar uses only the verified community roster without a channel (${forgedRoster})`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: "dark" });
    await installCommunityFixture(page, undefined, {
      noChannels: true,
      forgedRoster,
      selfProfile: { display_name: "Sean" },
    });
    await page.goto("/chat?view=announcements");
    const roster = page.getByRole("complementary", { name: "Member list" });
    await expect(roster).toBeVisible();
    await expect(
      roster.getByText("CreatorHive community", { exact: true }),
    ).toBeVisible();
    await expect(roster.getByRole("listitem")).toHaveCount(
      forgedRoster ? 0 : 2,
    );
    if (forgedRoster)
      await expect(
        roster.getByText(/The member list isn’t available/),
      ).toBeVisible();
    else {
      await expect(
        roster.getByRole("listitem").filter({ hasText: "Builder" }),
      ).toBeVisible();
      await waitForAnimations(page);
      await page.screenshot({
        path: testInfo.outputPath("member-sidebar-desktop.png"),
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(roster).not.toBeVisible();
      await page.getByRole("button", { name: "Members", exact: true }).click();
      await expect(
        page.getByText("2 in the community · 2 around", { exact: true }),
      ).toBeVisible();
      await waitForAnimations(page);
      await page.screenshot({
        path: testInfo.outputPath("member-list-mobile.png"),
      });
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Announcements", exact: true }),
      ).toBeVisible();
    }
  });
}

test("Chat and Live share navigation, theme, and channel destinations", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "dark" });
  await installCommunityFixture(page, undefined, {
    selfProfile: { display_name: "Sean" },
  });
  await page.goto("/chat?channel=markdown");
  const shellStyles = () =>
    page.locator(".hive-chat-sidebar").evaluate((el) => ({
      width: el.getBoundingClientRect().width,
      background: getComputedStyle(el).backgroundColor,
      color: getComputedStyle(el).color,
    }));
  const chatStyles = await shellStyles();
  await page.getByRole("link", { name: "Live studio", exact: true }).click();
  await expect(page).toHaveURL(/\/live$/);
  await expect(
    page.getByRole("link", { name: "Live studio", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  expect(await shellStyles()).toEqual(chatStyles);
  await expect(
    page.getByRole("button", { name: "Announcements", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Builder/ })).toBeVisible();
  await page
    .getByRole("button", { name: "Search the Hive", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Search the hive" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  for (const mode of ["dark", "light"]) {
    if (mode === "light")
      await page.getByRole("button", { name: /Theme:/ }).click();
    await expect(page.locator("html")).toHaveClass(mode);
    await waitForAnimations(page);
    await page.screenshot({
      path: testInfo.outputPath(`live-shell-${mode}.png`),
    });
  }
  await page.getByRole("button", { name: "# markdown", exact: true }).click();
  await expect(page).toHaveURL(/channel=markdown/);
  await expect(page.locator("html")).toHaveClass("light");
  await expect(
    page.getByRole("textbox", { name: "Message #markdown" }),
  ).toBeVisible();
  await page.goto("/live");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open community navigation" }).click();
  await expect(
    page.getByRole("button", { name: "Announcements", exact: true }),
  ).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("live-shell-mobile-navigation.png"),
  });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Announcements", exact: true }),
  ).not.toBeVisible();
});

test("Pulse shares the community shell and retains signed posting, replies and likes", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "dark" });
  const fixture = await installCommunityFixture(page, undefined, {
    selfProfile: { display_name: "Sean" },
  });
  await page.goto("/live");
  const sidebarWidth = (await page.locator(".hive-chat-sidebar").boundingBox())
    ?.width;
  await page.getByRole("link", { name: "Pulse", exact: true }).click();
  await expect(page).toHaveURL(/\/pulse$/);
  await expect
    .poll(
      async () =>
        (await page.locator(".hive-chat-sidebar").boundingBox())?.width,
    )
    .toBe(sidebarWidth);
  await expect(
    page.getByRole("link", { name: "Pulse", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("button", { name: "Announcements", exact: true }),
  ).toBeVisible();
  const feed = page.getByRole("region", { name: "Community updates" });
  await expect(
    feed.getByText(/The replay bookmarks are coming together/),
  ).toBeVisible();
  for (const mode of ["dark", "light"]) {
    if (mode === "light")
      await page.getByRole("button", { name: /Theme:/ }).click();
    await expect(page.locator("html")).toHaveClass(mode);
    await expect(feed.locator(".hive-note").first()).toHaveCSS(
      "background-color",
      await page
        .locator(".hive-pulse")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    );
    await waitForAnimations(page);
    await page.screenshot({
      path: testInfo.outputPath(`pulse-shell-${mode}.png`),
    });
  }
  await feed.getByRole("button", { name: "Like", exact: true }).click();
  await expect
    .poll(() =>
      fixture.published.some(
        (e) =>
          e.kind === 7 && e.tags.some((t) => t[0] === "e" && t[1] === "pulse"),
      ),
    )
    .toBe(true);
  await feed.getByRole("button", { name: "Reply", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Write your reply" })
    .fill("This is looking good.");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect
    .poll(() =>
      fixture.published.some(
        (e) =>
          e.kind === 1 &&
          e.content === "This is looking good." &&
          e.tags.some(
            (t) => t[0] === "e" && t[1] === "pulse" && t[3] === "reply",
          ),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "New update", exact: true }).click();
  await page
    .getByRole("textbox", { name: "What are you building?" })
    .fill("A small build update.");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect
    .poll(() =>
      fixture.published.some(
        (e) =>
          e.kind === 1 &&
          e.content === "A small build update." &&
          !e.tags.some((t) => t[0] === "h" || t[0] === "e"),
      ),
    )
    .toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open community navigation" }).click();
  await expect(
    page.getByRole("button", { name: "Announcements", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Announcements", exact: true }),
  ).not.toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("pulse-shell-mobile.png"),
  });
});

for (const width of [1440, 390]) {
  test(`Workflows is an advanced Agents tool at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await installCommunityFixture(page);
    await page.goto("/agents");
    const navigation = page.getByRole("navigation", {
      name: "Community",
      exact: true,
    });
    await expect(navigation.locator('a[href="/workflows"]')).toHaveCount(0);
    const workflows = page.getByRole("link", {
      name: "Workflows",
      exact: true,
    });
    await expect(workflows).not.toBeVisible();
    await page.getByText("Advanced", { exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(workflows).toBeVisible();
    await workflows.click();
    await expect(page).toHaveURL(/\/workflows$/);
    await expect(
      page.getByRole("heading", { name: "Workflows", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Weekly build roundup/ }).click();
    await expect(
      page.getByLabel("Workflow definition", { exact: true }),
    ).toHaveAttribute("readonly", "");
    if (width === 390)
      await page.getByLabel("Open community navigation").click();
    await expect(
      page.locator('.hive-chat-sidebar a[href="/agents"]:visible'),
    ).toHaveAttribute("aria-current", "page");
    if (width === 390) await page.keyboard.press("Escape");
    await page.getByRole("link", { name: "← Back to Agents" }).click();
    await expect(page).toHaveURL(/\/agents$/);
  });
}

test("sidebar preferences, search, disclosures and studio state", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installCommunityFixture(page);
  await page.goto("/chat?channel=markdown");
  const sidebar = page.locator(".hive-chat-sidebar");
  await expect(
    sidebar.getByRole("link", { name: "Chat", exact: true }),
  ).toHaveCount(0);
  await expect(
    sidebar.getByRole("link", { name: "Settings", exact: true }),
  ).toHaveCount(0);
  const section = sidebar.locator(".hive-sidebar-section").first();
  await section.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(
    section.getByRole("button", { name: "# markdown", exact: true }),
  ).not.toBeVisible();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Browse channels" }).click();
  const browser = page.getByRole("dialog", { name: "Browse channels" });
  await browser.getByLabel("Filter channels").fill("missing");
  await expect(browser.getByText("No channels found.")).toBeVisible();
  await browser.getByLabel("Filter channels").fill("mark");
  await browser.getByRole("button", { name: "Pin markdown" }).click();
  await expect(
    browser.getByRole("button", { name: "Pin markdown" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(sidebar.locator(".hive-channel-pin")).toHaveCount(1);
  await page.getByRole("link", { name: "Live studio", exact: true }).click();
  await page.getByRole("link", { name: "CreatorHive home" }).click();
  await expect(page).toHaveURL(/channel=markdown/);
  await page.keyboard.press("Control+k");
  await expect(
    page.getByRole("dialog", { name: "Search the hive" }).getByRole("textbox"),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  const streams = sidebar.locator(".hive-member-streams");
  await expect(
    streams.getByRole("button", { name: "Go live" }),
  ).not.toBeVisible();
  await streams.locator("summary").click();
  await expect(streams.getByText("No members live right now.")).toBeVisible();
  await expect(streams.getByRole("button", { name: "Go live" })).toBeVisible();
  await expect(sidebar.locator(".hive-live-dot")).toHaveCount(0);
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("spatial-sidebar-desktop.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Channels", exact: true }).click();
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("spatial-sidebar-mobile.png"),
  });
  await page.getByRole("link", { name: "Pulse", exact: true }).click();
  await expect(page).toHaveURL(/\/pulse$/);
  await expect(sidebar).not.toBeInViewport();
});

test("channel history stays shared when leaving chat and returning", async ({
  page,
}) => {
  const fixture = await installCommunityFixture(page);
  await page.goto("/chat?channel=markdown");
  await expect(
    page.getByRole("textbox", { name: "Message #markdown" }),
  ).toBeVisible();
  for (const route of ["pulse", "inbox", "agents", "live"]) {
    await page
      .locator(`.hive-chat-sidebar a[href="/${route}"]`)
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/${route}$`));
    await expect(
      page.getByRole("button", { name: "# markdown", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "# markdown", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "Message #markdown" }),
    ).toBeVisible();
  }
  expect(fixture.channelRequests).toHaveLength(1);
});

test("a temporarily refused channel query recovers without showing an empty account", async ({
  page,
}) => {
  const fixture = await installCommunityFixture(page, undefined, {
    channelRefusals: 1,
  });
  await page.goto("/chat?channel=markdown");
  await expect(page.getByRole("alert")).toContainText(
    "Channels couldn’t load.",
  );
  await expect(
    page.getByText("No channels available to your account yet."),
  ).not.toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Message #markdown" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).not.toBeVisible();
  expect(fixture.channelRequests).toHaveLength(2);
});

test("manual channel retry recovers a refused request", async ({ page }) => {
  const options = { channelRefusals: 10 };
  await installCommunityFixture(page, undefined, options);
  await page.goto("/chat?channel=markdown");
  await expect(
    page.getByRole("button", { name: "Retry channels" }),
  ).toBeVisible();
  options.channelRefusals = 0;
  await page.getByRole("button", { name: "Retry channels" }).click();
  await expect(
    page.getByRole("textbox", { name: "Message #markdown" }),
  ).toBeVisible();
});
