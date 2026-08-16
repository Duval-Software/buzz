/**
 * Direct messages, the Buzz way.
 *
 * A DM here is not a NIP-17 gift wrap: it is a relay-managed CHANNEL. Sending
 * kind:41010 with the other people's pubkeys as `p` tags makes the relay
 * create (or, for the same participant set, return — opens are idempotent,
 * verified live) a channel of type "dm" that only the participants can read.
 * Messages inside it are ordinary kind:9, so everything the client already
 * does — threads, reactions, typing, unread — works in DMs for free.
 *
 * The channel id comes back inside the OK message itself:
 *
 *     ["OK", <id>, true, "response:{\"channel_id\":\"…\",\"created\":true}"]
 *
 * which is why this parses the publish reason rather than waiting for the
 * kind:39000 to arrive (it does arrive, live, and populates the sidebar).
 */

import { getSocket } from "@/shared/lib/nostr-socket";
import { relayWsUrl } from "@/shared/lib/relay-url";
import { signNostrEvent } from "@/shared/lib/nostr-signer";

const KIND_DM_OPEN = 41010;

export async function openDm(otherPubkeys: string[]): Promise<string> {
  if (otherPubkeys.length === 0) {
    throw new Error("pick at least one person");
  }
  if (otherPubkeys.length > 8) {
    throw new Error("a DM holds at most 9 people");
  }
  const event = await signNostrEvent({
    kind: KIND_DM_OPEN,
    content: "",
    tags: otherPubkeys.map((pk) => ["p", pk.toLowerCase()]),
  });
  const { accepted, reason } = await getSocket(relayWsUrl()).publish(event);
  if (!accepted) {
    throw new Error(reason || "the relay refused to open the conversation");
  }
  const match = /^response:(\{.*\})$/.exec(reason);
  if (!match) {
    throw new Error("the relay did not return a conversation id");
  }
  const parsed = JSON.parse(match[1]) as { channel_id?: string };
  if (!parsed.channel_id) {
    throw new Error("the relay did not return a conversation id");
  }
  return parsed.channel_id;
}
