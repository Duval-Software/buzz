# Community administration and announcement channels

This work is local and uncommitted. It does not assign real roles or change live channels.

## Connected surfaces

- `/community` is behind the existing `CommunityGate` and uses the shared navigation, identity, profile names and signed relay socket.
- Community access uses existing commands: 9030 adds a member, 9031 removes access, and 9032 changes a role. The existing relay enforces owner/admin/member authority. Owners can manage admins; admins can manage ordinary members. The UI asks for review and waits for the relay's acceptance; refusals remain visible.
- UI authority requires a valid relay-signed kind 13534 snapshot matching the NIP-11 `self` key. Missing capabilities, invalid signatures and unknown roles do not grant controls. Channel rosters retain owner/admin/member/guest/bot values; an unrecognized role is labeled unknown, never promoted.
- Community roles and channel roles remain distinct. No custom CreatorHive role has been mapped to privileges or assigned. Its intended audience still needs clarification. There is no account, billing or governance migration.

## Community presentation and discovery

Chat, Live, Pulse, Inbox, Agents, Workflows and Community settings share `CommunityShell` for channels, announcements, DMs, unread indicators, search, profile, mobile navigation and theme. Every non-chat member page uses `CommunityPage` for its header and scroll area (`SurfaceShell` is only a compatibility export of that same component). These pages do not mark a chat channel read. Shared layout, density and theme tokens live in `surfaces/ui/community-shell.css`; common feed, list and form styles live in `shared/styles/community.css` and use those tokens. New member pages must reuse this layout rather than implementing their own navigation or page-level palette. Login, onboarding and invite entry screens remain outside member navigation. Pulse retains its existing signed notes, replies and reactions.

The Studio Control chat treatment includes: sidebar, timeline, composer, light/dark theme and desktop member list. Messages, threads, reactions, attachments, search, profiles and the verified member roster reuse the existing relay hooks. The sidebar shows the full verified channel roster, sorted by presence and name; without a selected channel it uses the existing verified community roster query. It contains no sample people or counts. The detailed member/thread panels replace the sidebar; smaller screens open the roster with the Members button. Community roster roles are never used to authorize channel publishing.

Announcements is always discoverable in the chat sidebar at `/chat?view=announcements`. It opens an accessible channel named `announcements`, falling back to the first channel with admin-only publishing. If neither is returned by the relay, the page explains the missing setup/access and has no composer. This creates no channel and grants no access. A channel name does not imply publishing restrictions: the actual relay policy and verified channel role determine the composer. An admin still needs to provision the channel and membership, and the policy support below is required for staff-only publishing.

## Announcement policy

Migration `0029_channel_posting_policy.sql` adds `channels.posting_policy`: `all` (existing behavior) or `admins` (channel owners/admins publish). Visibility and read access are unchanged. The database rejects unknown values.

Channel owners/admins change the policy through existing kind 9002 metadata with `h` and one `posting_policy` tag. Relay-signed kind 39000 metadata publishes the current value. The browser exposes this in Members → Channel publishing only when the relay advertises `buzz-channel-posting-policy-v1` in NIP-11 `supported_extensions`.

The shared HTTP/WebSocket ingest gate covers channel content, replies, edits, forum posts/comments and future channel content kinds. The workflow sink independently checks the actual workflow owner's role using the same guard. Reads and reactions remain available; moderation, membership and deletion commands retain their own authorization. Announcement header/settings changes also require channel owner/admin authority. Roles are read from the tenant-scoped database, not from client tags or cached presence. The relay confirms the persisted policy before acknowledging a policy update, including duplicate-event retries.

## Before a release

- Deploy the relay and migration together. The currently deployed CreatorHive relay does not advertise the new policy; the local UI cannot enable announcements on it.
- The deployed relay currently omits CORS permission for `/info` from the browser app origins checked during development. Configure the intended frontend origin on the relay/gateway, or serve its public NIP-11 document through the frontend origin. The Vite development server has a narrow `/relay-info` → `/info` proxy to its configured relay for this public document only. No authenticated API is added to that proxy.
- Role changes and channel settings are real writes when a permitted user confirms them. All mutation tests for this work used isolated fixtures or a new local Postgres database; no production roles or channel settings were changed.
- The existing `/live` studio interactions remain sample data. See `../live/INTEGRATION.md` for membership/billing, voting, balances, terminal feed, queue, hardware allowlist and staff-switch integration requirements.

## Checks

Web: `pnpm --filter buzz-web check`, production build and `community-access.spec.ts`, `community-ui.spec.ts`, `markdown.spec.ts`, `live.spec.ts`.

Database migration compatibility: `cargo test -p buzz-db posting_policy_migration_preserves_existing_channels -- --ignored`, with `BUZZ_TEST_DATABASE_URL` pointing at a disposable database (this test resets its public schema). It upgrades an existing private channel from migration 28 and confirms its default publishing and visibility are retained.

Relay: `cargo test -p buzz-relay announcement_publishing_enforces_roles_and_alternative_paths -- --ignored --nocapture`, using `BUZZ_TEST_DATABASE_URL` pointing at an isolated migrated database. The regression uses real signed events and Postgres through the shared HTTP/NIP-42 ingestion path. It covers normal defaults, settings validation/authorization, member/guest/bot/outsider denial, no stored rejected events, old-message and missing-scope edits, owner/admin publication, role removal, reactions, database constraints and duplicate acknowledgement. It does not start network transport servers or physical devices.

The member frame uses a tinted outer canvas and one inset workspace on desktop; mobile content stays full width. Navigation is shared across all routes: Inbox, Announcements and Pulse; Studio and member rooms; collapsible channels/DMs; Agents and profile controls. Community settings is reached through Your profile. Channel pins and last channel are browser-local preferences scoped by relay and member; they do not grant access. Browse channels lists only the channels already returned for the member. Studio metadata remains sample data on Live; the sidebar does not invent an official live signal. Member-stream indicators use the existing stagekeeper room feed.
