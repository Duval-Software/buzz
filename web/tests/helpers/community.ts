import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { nip19 } from "nostr-tools";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

/** Synthetic relay traffic, isolated from real community writes. */
export async function installCommunityFixture(
  page: Page,
  messageContent?: string,
  options: {
    pulseEvents?: {
      id: string;
      content: string;
      tags: string[][];
      pubkey?: string;
      kind?: number;
      created_at?: number;
    }[];
    noIdentity?: boolean;
    noChannels?: boolean;
    channelRefusals?: number;
    channelName?: string;
    channelAbout?: string;
    selfProfile?: Record<string, unknown>;
    closeProfileQuery?: boolean;
    rejectAuth?: boolean;
    role?: string;
    policy?: "all" | "admins";
    supportsPolicy?: boolean;
    denyCommands?: boolean;
    forgedRoster?: boolean;
  } = {},
) {
  const secret = generateSecretKey();
  const self = getPublicKey(secret);
  const relaySecret = generateSecretKey();
  const relayKey = getPublicKey(relaySecret);
  await page.route("**/info", (route) =>
    route.fulfill({
      json: {
        self: relayKey,
        supported_nips: [43],
        supported_extensions: options.supportsPolicy
          ? ["buzz-channel-posting-policy-v1"]
          : [],
      },
    }),
  );
  const builder = "bb".repeat(32);
  const media = `https://chat.creatorhive.ai/media/${"ab".repeat(32)}.png`;
  const body = [
    "## Build update",
    "",
    "**Shipped** *today* for **@Builder** :hive:",
    "First line\nSecond line",
    "",
    "- One feature\n- Another feature",
    "",
    "1. Review\n2. Release",
    "",
    "[Docs](https://example.com/docs) and https://example.com/notes",
    "",
    "Inline `@Builder :hive: <script>alert(1)</script>`",
    "",
    "```ts\nconst ready = true;\n// @Builder :hive:\n![image](https://example.com/code.png)\n```",
    "",
    "| Feature | Status |\n| --- | --- |\n| Markdown | Ready |",
    "",
    "[unsafe](javascript:alert%281%29) [data](data:text/html,test)",
    "<script>window.markdownExecuted = true</script>",
    '<img src="https://tracker.invalid/raw.png" onerror="window.markdownExecuted=true">',
    "",
    "inline ![remote alternative](https://tracker.invalid/pixel.png)",
    "",
    `![attachment](${media})`,
  ].join("\n");
  const event = (
    id: string,
    kind: number,
    content: string,
    tags: string[][],
    pubkey = builder,
  ) =>
    kind === 39002 || kind === 13534
      ? finalizeEvent(
          { kind, content, tags, created_at: Math.floor(Date.now() / 1000) },
          options.forgedRoster ? secret : relaySecret,
        )
      : {
          id,
          kind,
          content,
          tags,
          pubkey,
          created_at: Date.parse("2026-09-11T16:02:00Z") / 1000,
          sig: "00".repeat(64),
        };
  const published: {
    id: string;
    created_at: number;
    kind: number;
    tags: string[][];
    pubkey: string;
    sig: string;
    content: string;
  }[] = [];
  const receivedRemote: string[] = [];
  const channelRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("tracker.invalid"))
      receivedRemote.push(request.url());
  });
  await page.route("**/keeper/**", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Fixture: service unavailable" },
    }),
  );
  await page.route("https://tracker.invalid/**", (route) => route.abort());
  await page.route("https://stage.creatorhive.ai/**", (route) =>
    route.fulfill({ json: { rooms: [], session: "test" } }),
  );
  await page.route(`**${new URL(media).pathname}`, (route) =>
    route.fulfill({
      contentType: "image/png",
      body: readFileSync(
        new URL("../../public/icons/icon-192.png", import.meta.url),
      ),
    }),
  );
  if (!options.noIdentity)
    await page.addInitScript(
      (nsec) => localStorage.setItem("buzz.identity.nsec", nsec),
      nip19.nsecEncode(secret),
    );
  await page.routeWebSocket(/.*/, (socket) => {
    socket.onMessage((raw) => {
      const [kind, id, ...filters] = JSON.parse(String(raw));
      if (kind === "AUTH")
        socket.send(
          JSON.stringify([
            "OK",
            id.id,
            !options.rejectAuth,
            options.rejectAuth ? "restricted: not a relay member" : "",
          ]),
        );
      if (kind === "EVENT") {
        published.push(id);
        socket.send(
          JSON.stringify([
            "OK",
            id.id,
            !options.denyCommands,
            options.denyCommands ? "restricted: fixture denied" : "",
          ]),
        );
      }
      if (kind !== "REQ") return;
      if (filters.some((filter) => filter.kinds?.includes(39000))) {
        channelRequests.push(id);
        if (channelRequests.length <= (options.channelRefusals ?? 0)) {
          socket.send(
            JSON.stringify([
              "CLOSED",
              id,
              "rate-limited: too many concurrent requests",
            ]),
          );
          return;
        }
      }
      if (
        options.closeProfileQuery &&
        filters.some(
          (filter) =>
            filter.kinds?.includes(0) && filter.authors?.includes(self),
        )
      ) {
        socket.close();
        return;
      }
      const emit = (data: ReturnType<typeof event>) =>
        socket.send(JSON.stringify(["EVENT", id, data]));
      if (options.pulseEvents) {
        const history = [
          ...options.pulseEvents.map((note) => ({
            ...event(
              note.id,
              note.kind ?? 1,
              note.content,
              note.tags,
              note.pubkey === "self" ? self : (note.pubkey ?? builder),
            ),
            ...(note.created_at ? { created_at: note.created_at } : {}),
          })),
          ...(!options.denyCommands
            ? published.filter((e) => [1, 5, 7, 40003].includes(e.kind))
            : []),
        ];
        for (const entry of history) {
          if (
            filters.some(
              (filter) =>
                filter.kinds?.includes(entry.kind) &&
                (!filter["#e"] ||
                  entry.tags.some(
                    (tag) => tag[0] === "e" && filter["#e"].includes(tag[1]),
                  )),
            )
          )
            emit(entry);
        }
      }

      if (filters.some((filter) => filter.kinds?.includes(0)))
        emit(
          event("profile", 0, JSON.stringify({ display_name: "Builder" }), []),
        );
      if (
        options.selfProfile &&
        filters.some((filter) => filter.kinds?.includes(0))
      )
        emit(
          event(
            "self-profile",
            0,
            JSON.stringify(options.selfProfile),
            [],
            self,
          ),
        );
      if (
        !options.noChannels &&
        filters.some((filter) => filter.kinds?.includes(39000))
      ) {
        emit(
          event("channel", 39000, "", [
            ["d", "markdown"],
            ["name", options.channelName ?? "markdown"],
            ["about", options.channelAbout ?? ""],
            ["posting_policy", options.policy ?? "all"],
          ]),
        );
        emit(
          event("dm", 39000, "", [
            ["d", "dm"],
            ["name", "dm"],
            ["t", "dm"],
            ["p", self],
            ["p", builder],
          ]),
        );
      }
      if (filters.some((filter) => filter.kinds?.includes(39002)))
        emit(
          event("members", 39002, "", [
            ["d", "markdown"],
            ["p", self, "", options.role ?? "member"],
            ["p", builder, "", "owner"],
          ]),
        );
      if (filters.some((filter) => filter.kinds?.includes(13534)))
        emit(
          event("community-roster", 13534, "", [
            ["member", self, options.role ?? "member"],
            ["member", builder, options.role === "member" ? "owner" : "member"],
          ]),
        );
      if (filters.some((filter) => filter.kinds?.includes(20001)))
        emit(event("presence", 20001, "online", []));
      if (filters.some((filter) => filter.kinds?.includes(1)))
        emit(
          event(
            "pulse",
            1,
            "The replay bookmarks are coming together. Sharing the rough edges is the best part of building here.",
            [],
          ),
        );
      if (filters.some((filter) => filter.kinds?.includes(30177)))
        emit(
          event(
            "agent",
            30177,
            JSON.stringify({
              name: "Build companion",
              respond_to: "mentions",
              parallelism: 1,
            }),
            [["d", "cc".repeat(32)]],
          ),
        );
      if (filters.some((filter) => filter.kinds?.includes(30620)))
        emit(
          event(
            "workflow",
            30620,
            "name: Weekly build roundup\nenabled: true\non:\n  message: {}\nsteps:\n  - post: Share this week’s progress",
            [
              ["d", "roundup"],
              ["h", "markdown"],
            ],
          ),
        );
      const channel = filters.find(
        (filter) => filter.kinds?.includes(9) && filter["#h"],
      )?.["#h"][0];
      if (channel) {
        emit(
          event(`${channel}-root`, 9, messageContent ?? body, [
            ["h", channel],
            ["p", builder],
            ["emoji", "hive", media],
            ["imeta", `url ${media}`, "m image/png"],
          ]),
        );
        emit(
          event(
            `${channel}-reply`,
            9,
            "**Thread reply** with `code` and @Builder",
            [
              ["h", channel],
              ["e", `${channel}-root`, "", "reply"],
              ["p", builder],
            ],
          ),
        );
      }
      socket.send(JSON.stringify(["EOSE", id]));
    });
    socket.send(JSON.stringify(["AUTH", "markdown-test"]));
  });
  return { receivedRemote, published, self, builder, channelRequests };
}
