# CreatorHive Live

Local implementation only. No deployment, billing, hardware, terminal process, or new backend is provisioned.

## Connected now

- `/live` is a TanStack route using the same `CommunityShell` as Chat: real channels, announcements, DMs, unread indicators, search, profile, mobile drawer and shared theme. Viewing Live passes no active chat channel, so it does not mark a channel read. Live content uses the shared palette; the video poster remains dark in both themes.
- Production uses CommunityGate and the existing Nostr identity/relay membership check. Relay membership is **not** a paid subscription or a staff role.
- YouTube video IDs and Twitch channel/parent hostnames generate real provider iframes. Autoplay is off. Playback, captions, unavailable-video notices, and geographic/embed restrictions remain with the provider; a direct provider link is available.
- Community links lead to existing Chat and Pulse. The companion conversation itself is sample activity, not a second chat client.

## Local preview

Run `corepack pnpm --filter buzz-web dev --mode production --host 127.0.0.1`, then open `http://localhost:5173/live`. Use localhost, because the existing stagekeeper CORS policy does not allow 127.0.0.1.

A developer without a relay identity can use `/live?preview=1` on the Vite **development server only**. The production bundle always uses CommunityGate, including with that query parameter. This only reveals local sample content, not authenticated data.

Open **Preview settings** at the foot of the page to exercise upcoming, live, offline, providers, depleted balances, failed actions, and a simulated staff kill switch. Settings and balances are in memory and reset on navigation/reload. All studio interactions are rehearsals, even if a real provider video is embedded.

Optional build defaults: `VITE_LIVE_YOUTUBE_ID`, `VITE_LIVE_TWITCH_CHANNEL`, `VITE_LIVE_TWITCH_PARENT`. The parent defaults to the current hostname; configure the exact hostname hosting the player, without a scheme, port, or path. No video/channel is fabricated by default. Select Live to review a configured player. Stream state, title, hosts, audience count, runtime, dates, roadmap, messages, terminal text, paid membership and balances are all fixtures. The $99/month copy is the requested product framing, not a confirmed checkout price or active entitlement.

Provider references: [YouTube iframe embeds](https://developers.google.com/youtube/iframe_api_reference), [Twitch embed requirements](https://dev.twitch.tv/docs/embed/).

## Backend seams still required

`sample-studio.ts` is a deterministic response simulator, **not a security boundary or production authorization implementation**. Do not connect its client-side action catalog/reducer directly to devices or use its balances as authority.

| Surface | Integration | Required enforcement |
| --- | --- | --- |
| Broadcast | Replace LivePage's sample session state with the studio's current session metadata | Validate provider identifiers and state; use server timestamps and real viewer counts; no fabricated fallback totals |
| Build log | Replace terminalLines with a read-only, bounded feed from the existing build-journal/terminal service | Remove secrets, private paths/data and control sequences **before publication**; render as plain text; no viewer input or command execution; disconnect/reconnect and retention policy |
| Roadmap | Load community/project-scoped proposals and signed vote receipts | Verify paid entitlement and membership server-side; atomic credit deduction, one vote per member/item, immutable proposal IDs, idempotency, current totals returned by server |
| Membership | Read paid entitlements, ledger, allocations and renewal terms | Existing Nostr identity identifies the caller; a verified billing source determines entitlement; server owns all balances, price and renewal data |
| Studio actions | Replace reducer dispatches with signed requests for a catalog action ID and idempotency key | Server-owned allowlist, role/entitlement checks, atomic points + interaction-credit reservation, global/per-member cooldown and rate limit, queue capacity, validation, completion receipts, refund exactly once on failure/cancellation |
| Staff pause | Replace simulated toggle with authenticated staff capability and service mutation | Check staff role on server, cancel queued work/refund reservations, immediately block dispatch, signal devices to stop safely; retain an audit record |

The device executor must independently enforce approved lighting presets, stationary robot motion, a fixed challenge set, preset camera angles with bounded return times, a short approved sound at at most 20% volume, and hydration reminders. It must never accept viewer-supplied scripts, terminal commands, device addresses, motion coordinates, sound files, or arbitrary hardware instructions. Production should fail closed when authorization, balance, queue, or staff-pause state cannot be verified. No device/network action exists in this implementation.

Prefer the repo's existing Nostr event/query conventions for roadmap/activity and its signed NIP-98 stagekeeper pattern where a separate studio service is required. No speculative endpoint paths or protocol kinds have been reserved here.

## Checks

- `corepack pnpm --filter buzz-web build`
- `corepack pnpm --filter buzz-web check`
- `CHECK_FILE_SIZES_BASE=HEAD corepack pnpm --filter buzz-web check:file-sizes` when only this branch was fetched
- `corepack pnpm --filter buzz-web check:pubkey-truncation`
- `corepack pnpm --filter buzz-web exec playwright test` (build first; ensure pnpm is on PATH for the existing test server command)

`tests/e2e/live.spec.ts` uses an isolated test identity and intercepted relay; it does not create production members or send production messages. It covers queue/cooldown/balance/refund rules, invalid identifiers, voting, responsive layouts, navigation, terminal read-only markup, both embed providers, and production auth gating. Provider iframe responses are mocked for deterministic tests; those tests do not prove third-party playback availability.

## Verified locally on September 8, 2026

- Production web build and TypeScript pass. Vite reports the existing large shared bundle warning.
- All six Live tests pass. Full web Playwright run: 10 passed, 2 existing homepage tests failed because they expect the upstream Buzz repository home, while this branch redirects `/` to `/chat`.
- Changed files pass Biome; file-size and public-key guards pass. Full web check is blocked by three existing accessibility errors in `features/chat/ui/AuthedMedia.tsx` (two unsupported labels and the misplaced caption suppression).
- Reviewed rendered first viewports at 390, 768, 1280 and 1920 pixels, plus studio controls on mobile and desktop. No horizontal overflow. Keyboard operation and reduced-motion mode checked.
- Safari: verified Live navigation from authenticated Chat, direct `/live` loading, real YouTube playback, and Twitch's native offline player using `parent=localhost`. Twitch live playback was not available on the test channel at review time.
- Everything remains local and uncommitted. Nothing pushed or deployed.
