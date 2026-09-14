/**
 * Who is in a channel.
 *
 * kind:39002 is the relay-signed membership list: addressable by the channel
 * id in `d`, one `p` tag per member with the role in the tag's fourth slot
 * ("owner" / "member"). Being relay-signed matters — membership is the
 * relay's decision, so the relay's signature is the authority, and a member
 * list a random key published would just be an opinion.
 */

import {
  isRelaySnapshot,
  useRelayInfo,
} from "@/features/community/community-access";
import { useEffect, useMemo, useRef, useState } from "react";
import { getSocket } from "@/shared/lib/nostr-socket";
import { relayWsUrl } from "@/shared/lib/relay-url";

const KIND_GROUP_MEMBERS = 39002;

export type ChannelMember = {
  pubkey: string;
  role: "owner" | "admin" | "member" | "guest" | "bot" | "unknown";
};

export function useMembers(channelId: string | null): ChannelMember[] {
  const { data: relayInfo } = useRelayInfo();
  const relayKey = relayInfo?.self;
  const socket = useMemo(() => getSocket(relayWsUrl()), []);
  const [members, setMembers] = useState<ChannelMember[]>([]);
  // Ordering bookkeeping, not render state: which membership snapshot is
  // newest only matters inside the subscription callback.
  const lastSeen = useRef(0);

  useEffect(() => {
    if (!channelId || !relayKey) {
      setMembers([]);
      return;
    }
    setMembers([]);
    lastSeen.current = 0;
    const unsubscribe = socket.subscribe(
      [{ kinds: [KIND_GROUP_MEMBERS], "#d": [channelId], limit: 1 }],
      {
        onEvent: (event) => {
          if (
            !isRelaySnapshot(event, relayKey) ||
            event.tags.find((t) => t[0] === "d")?.[1] !== channelId
          )
            return;
          // Addressable: the newest replaces, and the relay may replay it.
          if (event.created_at < lastSeen.current) {
            return;
          }
          lastSeen.current = event.created_at;
          setMembers(
            event.tags
              .filter((t) => t[0] === "p" && typeof t[1] === "string")
              .map((t) => ({
                pubkey: t[1].toLowerCase(),
                role: (["owner", "admin", "member", "guest", "bot"].includes(
                  t[3],
                )
                  ? t[3]
                  : "unknown") as ChannelMember["role"],
              })),
          );
        },
      },
    );
    return unsubscribe;
  }, [socket, channelId, relayKey]);

  return members;
}
