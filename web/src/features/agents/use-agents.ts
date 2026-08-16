/**
 * The agent roster: who the community's agents are and what they are doing.
 *
 * Three sources merged by agent pubkey:
 *
 * - kind:30177 managed-agent definitions. Authored by the agent's OWNER, with
 *   the agent's pubkey in `d` and a JSON config (name, persona, respond_to,
 *   parallelism) in content. This is the authoritative "this key is an agent
 *   run by that person" record, and it is what finally explains the
 *   profile-less keys that announce presence.
 * - kind:0 profiles with the bot flag, for agents that introduce themselves.
 * - Recent kind:9 messages authored by any known agent key, so the surface
 *   can honestly say when each agent last did something visible.
 *
 * Hosting is not here on purpose. Starting or stopping an agent process
 * happens where the process lives (a desktop or a server); a browser tab can
 * only ever be the control room, not the machine room.
 */

import { useEffect, useMemo, useState } from "react";
import { getSocket } from "@/shared/lib/nostr-socket";
import { relayWsUrl } from "@/shared/lib/relay-url";

const KIND_MANAGED_AGENT = 30177;
const KIND_CHAT = 9;

export type AgentConfig = {
  name?: string;
  persona_id?: string;
  parallelism?: number;
  respond_to?: string;
};

export type AgentInfo = {
  pubkey: string;
  /** Best display name: managed config beats profile beats truncation. */
  configName: string | null;
  owner: string | null;
  respondTo: string | null;
  parallelism: number | null;
  /** Newest visible message from this agent, if any loaded. */
  lastActive: number | null;
  lastChannel: string | null;
};

export function useAgents(botPubkeys: string[]): {
  agents: AgentInfo[];
  loading: boolean;
} {
  const socket = useMemo(() => getSocket(relayWsUrl()), []);
  const [managed, setManaged] = useState<
    Map<string, { owner: string; config: AgentConfig; at: number }>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [activity, setActivity] = useState<
    Map<string, { at: number; channel: string | null }>
  >(new Map());

  useEffect(() => {
    const unsubscribe = socket.subscribe(
      [{ kinds: [KIND_MANAGED_AGENT], limit: 100 }],
      {
        onEvent: (event) => {
          const agentPubkey = event.tags.find((t) => t[0] === "d")?.[1];
          if (!agentPubkey || !/^[0-9a-f]{64}$/.test(agentPubkey)) {
            return;
          }
          let config: AgentConfig = {};
          try {
            config = JSON.parse(event.content) as AgentConfig;
          } catch {
            // A malformed config is still an agent; show it by key.
          }
          setManaged((prev) => {
            const existing = prev.get(agentPubkey);
            if (existing && existing.at >= event.created_at) {
              return prev;
            }
            const next = new Map(prev);
            next.set(agentPubkey, {
              owner: event.pubkey.toLowerCase(),
              config,
              at: event.created_at,
            });
            return next;
          });
        },
        onEose: () => setLoading(false),
        onClosed: () => setLoading(false),
      },
    );
    return unsubscribe;
  }, [socket]);

  // One activity subscription over every known agent key. The key list only
  // changes when the roster does, so churn is rare; the joined string keeps
  // the dependency honest without resubscribing per render.
  const allKeys = useMemo(() => {
    const set = new Set<string>();
    for (const pk of managed.keys()) {
      set.add(pk);
    }
    for (const pk of botPubkeys) {
      set.add(pk.toLowerCase());
    }
    return [...set].sort();
  }, [managed, botPubkeys]);
  const keysJoined = allKeys.join(",");

  useEffect(() => {
    if (!keysJoined) {
      return;
    }
    const authors = keysJoined.split(",");
    const unsubscribe = socket.subscribe(
      [{ kinds: [KIND_CHAT], authors, limit: 100 }],
      {
        onEvent: (event) => {
          const pk = event.pubkey.toLowerCase();
          setActivity((prev) => {
            const existing = prev.get(pk);
            if (existing && existing.at >= event.created_at) {
              return prev;
            }
            const next = new Map(prev);
            next.set(pk, {
              at: event.created_at,
              channel: event.tags.find((t) => t[0] === "h")?.[1] ?? null,
            });
            return next;
          });
        },
      },
    );
    return unsubscribe;
  }, [socket, keysJoined]);

  const agents = useMemo(() => {
    const out: AgentInfo[] = allKeys.map((pubkey) => {
      const record = managed.get(pubkey);
      const seen = activity.get(pubkey);
      return {
        pubkey,
        configName: record?.config.name ?? null,
        owner: record?.owner ?? null,
        respondTo: record?.config.respond_to ?? null,
        parallelism: record?.config.parallelism ?? null,
        lastActive: seen?.at ?? null,
        lastChannel: seen?.channel ?? null,
      };
    });
    out.sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0));
    return out;
  }, [allKeys, managed, activity]);

  return { agents, loading };
}
