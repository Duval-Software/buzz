/**
 * Joining the community from inside the app.
 *
 * The friction this removes: before, a new person had to install a browser
 * extension, generate a Nostr key, and paste it somewhere — three steps that
 * are obvious to us and a wall to everyone else. Now they press one button.
 *
 * Two hops, because a browser cannot do it alone:
 *
 *   1. POST /stage/invite  -> one pre-minted invite code, and the URL the
 *                             relay expects the claim to be signed for
 *   2. POST /stage/join    -> our OWN signed claim, forwarded to the relay
 *
 * The key is generated in this browser and never leaves it. stagekeeper only
 * relays a request we signed, because the relay is on a different origin and
 * the browser cannot post there directly. Nobody but this device ever holds
 * the secret.
 *
 * The signature detail that is easy to get wrong: the NIP-98 event must be
 * signed for `claim_url` — the RELAY's endpoint — not for the stagekeeper URL
 * we actually POST to. The relay verifies the `u` tag against its own address,
 * so signing the proxy's URL produces a valid-looking header that the relay
 * rejects.
 */

import { makeNip98AuthHeader } from "@/shared/lib/nip98";
import { stageBaseUrl } from "@/shared/lib/stage-url";

type InviteGrant = {
  code: string;
  claim_url: string;
};

/** Whether this deployment can onboard people in-app at all. */
export function joinAvailable(): boolean {
  return stageBaseUrl() !== null;
}

async function readError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === "string") {
      return parsed.error;
    }
  } catch {
    // Not JSON. The raw text is still the most useful thing we have.
  }
  return text.slice(0, 200) || `HTTP ${response.status}`;
}

/**
 * Claim membership for the key this browser is holding.
 *
 * Throws with a message meant to be shown to a person, not logged. Note that a
 * failure after step 1 consumes an invite code: the pool is sized for that, and
 * silently retrying would be worse than losing one code.
 */
export async function joinCommunity(): Promise<void> {
  const base = stageBaseUrl();
  if (!base) {
    throw new Error("This deployment has no self-serve join.");
  }

  let grant: InviteGrant;
  const inviteResponse = await fetch(`${base}/stage/invite`, {
    method: "POST",
  });
  if (!inviteResponse.ok) {
    throw new Error(await readError(inviteResponse));
  }
  try {
    grant = (await inviteResponse.json()) as InviteGrant;
  } catch {
    throw new Error("The invite service returned something unreadable.");
  }
  if (!grant.code || !grant.claim_url) {
    throw new Error("The invite service did not return a usable invite.");
  }

  const body = JSON.stringify({ code: grant.code });
  const joinResponse = await fetch(`${base}/stage/join`, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/json",
      Authorization: await makeNip98AuthHeader(grant.claim_url, "POST", {
        body,
      }),
    },
  });
  if (!joinResponse.ok) {
    throw new Error(await readError(joinResponse));
  }
}
