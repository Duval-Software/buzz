/**
 * Talking to stagekeeper, the video access wall.
 *
 * stagekeeper is a separate service from the relay. It verifies a NIP-98
 * signature, checks the caller against the community roster AND the channel
 * policy (open channels are open to members; private ones only when the
 * community owner created them and the caller is in that channel; DMs never),
 * then mints a room-scoped LiveKit token.
 *
 * The client never sees a LiveKit API secret. It receives only a token good
 * for one room, and the rules that decided it are enforced server-side, so
 * nothing here needs to be trusted for access control.
 */

import { makeNip98AuthHeader } from "@/shared/lib/nip98";
import { stageBaseUrl } from "@/shared/lib/stage-url";

export type StageToken = {
  token: string;
  /** The LiveKit websocket URL to connect to. */
  url: string;
  room: string;
  identity: string;
};

export type StageChannel = {
  name: string;
  room: string;
  kind: "open" | "private";
};

export { stageBaseUrl };

/** The room name for a channel. Must match stagekeeper's `channelRoom`. */
export function channelRoom(channelId: string): string {
  return `ch-${channelId.replace(/-/g, "").toLowerCase().slice(0, 12)}`;
}

/**
 * POST to stagekeeper with a NIP-98 Authorization header.
 *
 * The signature covers the exact URL, method, and body hash, so it cannot be
 * replayed against a different endpoint or with different arguments.
 */
async function signedPost<T>(path: string, body: unknown): Promise<T> {
  const base = stageBaseUrl();
  if (!base) {
    throw new Error("video is not configured for this deployment");
  }
  const url = `${base}${path}`;
  const payload = JSON.stringify(body ?? {});
  const response = await fetch(url, {
    method: "POST",
    body: payload,
    headers: {
      "Content-Type": "application/json",
      Authorization: await makeNip98AuthHeader(url, "POST", { body: payload }),
    },
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 200) || `HTTP ${response.status}`);
  }
  if (!response.ok) {
    const message =
      typeof parsed === "object" && parsed !== null && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return parsed as T;
}

/** A token for a channel's video room, or a refusal explaining why not. */
export function requestChannelToken(
  channelId: string,
  role: "publish" | "watch" = "publish",
): Promise<StageToken> {
  return signedPost<StageToken>("/stage/token", {
    room: channelRoom(channelId),
    role,
  });
}

/**
 * A token for any room by name, at the role asked for.
 *
 * "watch" gets a subscribe-only token and a per-session identity
 * (`npub + "-w" + hex`), because LiveKit disconnects an identity that joins
 * twice and one person watching on a laptop and a phone is ordinary. Watchers
 * can still publish DATA, which is what makes raising a hand possible without
 * being on stage.
 */
export function requestRoomToken(
  room: string,
  role: "publish" | "watch",
): Promise<StageToken> {
  return signedPost<StageToken>("/stage/token", { room, role });
}

/**
 * The room a member broadcasts in. Must match stagekeeper's `ownRoom`.
 *
 * Used to tell "this is my room, I host it" from "I am a guest here", which is
 * the only thing that decides whether raised hands are actionable.
 */
export function ownRoom(pubkeyHex: string): string {
  return `stage-${pubkeyHex.slice(0, 12)}`;
}

/**
 * The always-on shared room, or null when this deployment has none.
 *
 * Must match the server's STAGE_OFFICE_ROOM: stagekeeper compares the room
 * name in a token request against that value to decide that any member may
 * publish there. A mismatch does not error anywhere visible; it just quietly
 * demotes the Lounge to a room nobody is allowed to speak in.
 */
export function loungeRoom(): string | null {
  const room = import.meta.env.VITE_LOUNGE_ROOM;
  return room ? String(room) : null;
}

/**
 * A personal OBS stream key.
 *
 * The key is a SECRET: anyone holding it can broadcast as this member into
 * their room. It is shown once and never stored client-side; asking again
 * rotates it server-side, which is also the recovery from a leak — the old key
 * simply stops working.
 */
export type StreamKey = {
  protocol: "whip" | "rtmp";
  room: string;
  stream_key: string;
  url: string;
  ingress_id: string;
  /** Present for WHIP: paste this one value into OBS 30+. */
  whip_endpoint?: string;
  /** Present for RTMP: server + key pair for older OBS. */
  obs_server?: string;
  obs_stream_key?: string;
  hint?: string;
};

/** Mint (or rotate) the caller's stream key for their own room. */
export function requestStreamKey(
  protocol: "whip" | "rtmp",
): Promise<StreamKey> {
  return signedPost<StreamKey>("/stage/streamkey", { protocol });
}

/** Kill every stream key bound to the caller's room. */
export function revokeStreamKeys(): Promise<{ revoked: number }> {
  return signedPost<{ revoked: number }>("/stage/streamkey/revoke", {});
}

/**
 * Bring a watcher on stage. Only the room's owner (or a configured host) may
 * do this, and stagekeeper enforces that — this call being available in the UI
 * is not what grants the authority.
 */
export function promoteParticipant(
  room: string,
  identity: string,
): Promise<{ can_publish: boolean }> {
  return signedPost<{ can_publish: boolean }>("/stage/promote", {
    room,
    identity,
  });
}

/** A short-lived bearer for polling read-only stage endpoints. */
export function requestStageSession(): Promise<{ session: string }> {
  return signedPost<{ session: string }>("/stage/session", {});
}

/** Rooms with someone in them right now. Needs a lobby session bearer. */
export async function listLiveRooms(
  session: string,
): Promise<{ name: string; num_participants: number }[]> {
  const base = stageBaseUrl();
  if (!base) {
    return [];
  }
  const response = await fetch(`${base}/stage/rooms`, {
    headers: { Authorization: `Bearer ${session}` },
  });
  if (!response.ok) {
    return [];
  }
  const body = (await response.json()) as {
    rooms?: { name: string; num_participants: number }[];
  };
  return body.rooms ?? [];
}
