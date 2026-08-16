import { useEffect, useRef, useState } from "react";
import { contentWithoutMediaLines } from "@/features/chat/message-media";
import type { Channel } from "@/features/chat/use-chat";
import { useNames } from "@/features/profile/use-profiles";
import type { NostrEvent } from "@/shared/lib/nostr-client";
import { getSocket } from "@/shared/lib/nostr-socket";
import { relayWsUrl } from "@/shared/lib/relay-url";

/**
 * Full-text search over the community (NIP-50).
 *
 * The relay routes a `search` filter to Postgres FTS, so this is one
 * round-trip on the already-authenticated socket. The filter MUST name kinds
 * explicitly: an open-ended search trips the relay's p-gate and comes back
 * 403 instead of empty, which reads as "search is broken" rather than "be
 * specific".
 *
 * Results open the channel they live in. Jumping to the exact message needs
 * timeline positioning the client does not have yet; opening the right room
 * with the snippet fresh in mind is honest and useful today.
 */

const KIND_CHAT = 9;

type Hit = {
  id: string;
  channelId: string;
  pubkey: string;
  snippet: string;
  createdAt: number;
};

function toHit(event: NostrEvent): Hit | null {
  const channelId = event.tags.find((t) => t[0] === "h")?.[1];
  if (!channelId) {
    return null;
  }
  const text = contentWithoutMediaLines(event.content);
  return {
    id: event.id,
    channelId,
    pubkey: event.pubkey,
    snippet: text.length > 160 ? `${text.slice(0, 160)}…` : text,
    createdAt: event.created_at,
  };
}

export function SearchPanel({
  channels,
  onOpenChannel,
  onClose,
}: {
  channels: Channel[];
  onOpenChannel: (channelId: string) => void;
  onClose: () => void;
}) {
  const names = useNames();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const channelName = (id: string) =>
    channels.find((c) => c.id === id)?.name ?? "unknown channel";

  async function run(event: React.FormEvent) {
    event.preventDefault();
    const q = query.trim();
    if (!q || busy) {
      return;
    }
    setBusy(true);
    try {
      const events = await getSocket(relayWsUrl()).queryOnce([
        { kinds: [KIND_CHAT], search: q, limit: 30 },
      ]);
      const found = events
        .map(toHit)
        .filter((h): h is Hit => h !== null)
        .sort((a, b) => b.createdAt - a.createdAt);
      setHits(found);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 pt-[10vh]">
      <div className="flex max-h-[70dvh] w-full max-w-xl flex-col rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-200">
        <form
          onSubmit={run}
          className="flex items-center gap-2 border-neutral-800 border-b p-3"
        >
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the hive"
            className="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-base outline-none placeholder:text-neutral-600 focus:border-neutral-600"
          />
          <button
            type="submit"
            disabled={busy || query.trim().length === 0}
            className="shrink-0 rounded-lg bg-amber-500 px-3 py-2 font-semibold text-neutral-950 text-sm disabled:opacity-40"
          >
            {busy ? "…" : "Search"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg border border-neutral-700 px-2.5 py-2 text-neutral-400 text-sm"
          >
            Close
          </button>
        </form>

        <div className="flex-1 overflow-y-auto p-2">
          {hits === null ? (
            <p className="px-2 py-4 text-neutral-500 text-sm">
              Search messages across every channel you can see.
            </p>
          ) : hits.length === 0 ? (
            <p className="px-2 py-4 text-neutral-500 text-sm">
              Nothing matched. The search is exact-ish: try a distinctive word.
            </p>
          ) : (
            hits.map((hit) => (
              <button
                key={hit.id}
                type="button"
                onClick={() => {
                  onOpenChannel(hit.channelId);
                  onClose();
                }}
                className="block w-full rounded-lg px-2 py-2 text-left hover:bg-neutral-900"
              >
                <span className="flex items-baseline gap-2 text-xs">
                  <span className="text-amber-400">
                    #{channelName(hit.channelId)}
                  </span>
                  <span className="font-medium text-neutral-300">
                    {names(hit.pubkey)}
                  </span>
                  <span className="text-neutral-600">
                    {new Date(hit.createdAt * 1000).toLocaleDateString()}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-neutral-400 text-sm">
                  {hit.snippet}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
