/**
 * Where the stage service lives, if this deployment has one.
 *
 * stagekeeper hosts two unrelated-looking things: the video access wall and
 * the community join bridge. They share a service only because both need to
 * talk to the relay from a server that is allowed to, so both need this URL —
 * and neither feature should have to import from the other to get it.
 *
 * Null means the feature is not configured, and callers must degrade rather
 * than break: no stage URL simply means no video button and no in-app join.
 */
export function stageBaseUrl(): string | null {
  const url = import.meta.env.VITE_STAGE_URL;
  return url ? String(url).replace(/\/$/, "") : null;
}
