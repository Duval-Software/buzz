import type { ReactNode } from "react";
import { joinCommunity } from "@/features/identity/join";
import { Welcome } from "@/features/identity/ui/Welcome";
import { useMembership } from "@/features/identity/use-identity";
import { getSocket } from "@/shared/lib/nostr-socket";
import { relayWsUrl } from "@/shared/lib/relay-url";

/** How many times to re-authenticate after joining before giving up. */
const REAUTH_ATTEMPTS = 3;
const REAUTH_GAP_MS = 1_200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Decides whether to show the community or the front door.
 *
 * The join is treated as ONE action from the person's point of view, even
 * though it is a key, a claim, and a fresh handshake underneath. The button
 * stays busy until the relay has actually accepted them, so nobody is dropped
 * into an empty-looking app while membership is still settling — and nobody is
 * asked to press Join twice, which would burn a second invite code.
 */
export function CommunityGate({ children }: { children: ReactNode }) {
  const { status, reason, ensureIdentity, adoptIdentity } = useMembership();

  async function handleJoin(): Promise<void> {
    // The claim is signed by this key, so it has to exist first.
    ensureIdentity();
    await joinCommunity();

    // The relay already decided "not a member" on the open socket and will not
    // revisit that by itself. Re-handshake until it sees the new membership.
    const socket = getSocket(relayWsUrl());
    for (let attempt = 0; attempt < REAUTH_ATTEMPTS; attempt += 1) {
      socket.reconnect();
      const verdict = await socket.waitForAuth(6_000);
      if (verdict.state === "accepted") {
        return;
      }
      await sleep(REAUTH_GAP_MS);
    }
    throw new Error(
      "You are in, but the relay has not picked it up yet. Wait a moment and reload this page.",
    );
  }

  if (status === "member") {
    return <>{children}</>;
  }

  if (status === "checking") {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-neutral-950 text-neutral-500">
        Connecting to the community…
      </main>
    );
  }

  return (
    <Welcome
      status={status}
      reason={reason}
      onJoin={handleJoin}
      onAdopt={adoptIdentity}
    />
  );
}
