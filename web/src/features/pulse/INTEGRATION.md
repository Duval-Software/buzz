# Pulse build feed

Local implementation; no deployment or real community posts were made during verification.

## Connected through existing services

- Chronological kind:1 notes, kind:7 likes, kind:5 deletions, kind:40003 edits, and kind:1984 moderator reports use the existing signed relay connection. Mutations only succeed in the UI after relay acknowledgement. Failed writes keep drafts and display relay errors.
- Root-note metadata uses `hive-post` (progress/shipped/feedback), `hive-project` (display name), and `hive-build` (HTTP(S) project URL). Metadata is descriptive, not an authorization boundary. Other clients can display the ordinary note body without understanding these tags.
- Feedback resolution is an author edit preserving attachment/project tags and carrying `hive-feedback=resolved` and `hive-outcome`. Edits are applied only for the original author; foreign edit/delete overlays are ignored. The relay remains the authority. Edit timestamps advance at least one second so rapid edits have stable ordering on replay.
- Replies carry the existing `e` reply reference and a `p` tag for the person being answered. This addresses the reply to their existing Inbox. No separate push-delivery guarantee is introduced.
- Image uploads reuse Blossom with the existing 10 MB cap. MP4 demos use the same signed upload path with a conservative 25 MB browser limit; the relay still validates formats, codecs, duration, and content. Attachments render through the shared authenticated media components. Arbitrary Markdown images do not fetch third-party resources.
- Authors can edit/delete their posts. Reports use the existing relay moderation queue; this change does not build another moderator console. Deleting a parent leaves replies as orphan updates. Saved copies are outside deletion's guarantee.

## Deliberate limits

- Follow build is local to this browser, scoped by relay + member + build author + canonical URL. It filters the currently loaded feed. No cross-device follow storage, notification subscription, or new project backend exists. The UI states this explicitly.
- The current feed requests 100 notes and scoped overlays. It is not paginated project history.
- Build links reject non-HTTP(S) schemes and embedded credentials. Keep the same URL on later updates to group a build. The author is included in the follow key to prevent another member's use of that link joining the followed stream.
- Recap a live build is a manual writing template covering what changed, member input, next steps, and replay timestamps. It does not fetch stream data, invent attribution, confer staff status, or post automatically. Official notices remain in Announcements.
- Existing member admission and event permissions remain server-enforced. No payments, entitlement, agents, or hardware paths were added.
- Drafts stay in page memory when the composer closes; navigating away or reloading does not persist them. Removing an attachment from a draft does not delete its uploaded media object; existing media retention applies.

## Checks

Run the existing web check/build and Playwright suite. `pulse.spec.ts` covers signed publishing/uploading, project metadata, local follows across reloads, attachment-preserving edits, resolution ordering, deletes, foreign overlays, reports, reply addressing, invalid URLs, rejected writes, and desktop/mobile feed/composer screenshots. These use synthetic relay traffic, not production writes. Hosted mutation compatibility and moderator review operations still need an authorized deployment smoke test.
