import { useQuery } from "@tanstack/react-query";
import { verifyEvent } from "nostr-tools/pure";
import { useMembership } from "@/features/identity/use-identity";
import type { NostrEvent } from "@/shared/lib/nostr-client";
import { getSocket } from "@/shared/lib/nostr-socket";
import { signNostrEvent } from "@/shared/lib/nostr-signer";
import { relayHttpBaseUrl, relayWsUrl } from "@/shared/lib/relay-url";

export type CommunityRole = "owner" | "admin" | "member";
export type CommunityMember = { pubkey: string; role: CommunityRole };
export const POSTING_POLICY_EXTENSION = "buzz-channel-posting-policy-v1";

type RelayInfo = {
  self?: string;
  supported_nips?: number[];
  supported_extensions?: string[];
};

/** Fetch capability evidence from this relay, never infer support from UI state. */
export function useRelayInfo() {
  return useQuery({
    queryKey: ["relay-info", relayWsUrl()],
    queryFn: async ({ signal }): Promise<RelayInfo> => {
      const response = await fetch(
        import.meta.env.DEV ? "/relay-info" : `${relayHttpBaseUrl()}/info`,
        { signal },
      );
      if (!response.ok) throw new Error("Relay capabilities unavailable.");
      return response.json();
    },
    staleTime: 60_000,
    retry: false,
  });
}

/** Only relay-authored, cryptographically valid snapshots confer UI authority. */
export function isRelaySnapshot(event: NostrEvent, relayKey?: string): boolean {
  try {
    return Boolean(relayKey && event.pubkey === relayKey && verifyEvent(event));
  } catch {
    return false;
  }
}

export function useCommunityMembers() {
  const info = useRelayInfo();
  const { identity } = useMembership();
  return useQuery({
    queryKey: [
      "community-members",
      relayWsUrl(),
      info.data?.self,
      identity?.pubkey,
    ],
    enabled: Boolean(
      identity && info.data?.self && info.data.supported_nips?.includes(43),
    ),
    queryFn: async (): Promise<CommunityMember[]> => {
      const events = await getSocket(relayWsUrl()).queryOnce([
        { kinds: [13534], authors: [info.data?.self ?? ""], limit: 1 },
      ]);
      const event = events
        .filter((e) => e.kind === 13534 && isRelaySnapshot(e, info.data?.self))
        .sort((a, b) => b.created_at - a.created_at)[0];
      if (!event)
        throw new Error(
          "The relay did not provide a verified membership list.",
        );
      const members = new Map<string, CommunityMember>();
      for (const tag of event.tags) {
        if (tag[0] !== "member" && tag[0] !== "p") continue;
        const pubkey = tag[1]?.toLowerCase();
        const role = tag[0] === "member" ? tag[2] : tag[3];
        if (
          /^[0-9a-f]{64}$/.test(pubkey ?? "") &&
          (role === "owner" || role === "admin" || role === "member")
        )
          members.set(pubkey, { pubkey, role });
      }
      return [...members.values()];
    },
    staleTime: 0,
    refetchInterval: 30_000,
    retry: false,
  });
}

/** Publish using the existing signed command and await the relay's actual verdict. */
export async function publishCommunityCommand(
  kind: 9002 | 9030 | 9031 | 9032,
  tags: string[][],
) {
  const event = await signNostrEvent({
    kind,
    tags,
    content: "",
    created_at: Math.floor(Date.now() / 1000),
  });
  const result = await getSocket(relayWsUrl()).publish(event);
  if (!result.accepted)
    throw new Error(result.reason || "The relay refused this change.");
}
