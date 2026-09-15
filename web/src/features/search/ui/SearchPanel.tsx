import { Search } from "lucide-react";
import { CommunityDialog } from "@/features/surfaces/ui/CommunityDialog";
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
 * Results retain their event id so chat can fetch and focus the exact message.
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
  onOpenChannel: (channelId: string, eventId?: string) => void;
  onClose: () => void;
}) {
  const names = useNames();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
    setError("");
    setHits(null);
    try {
      const events = await getSocket(relayWsUrl()).queryOnce([
        { kinds: [KIND_CHAT], search: q, limit: 30 },
      ]);
      const found = events
        .map(toHit)
        .filter((h): h is Hit => h !== null)
        .sort((a, b) => b.createdAt - a.createdAt);
      setHits(found);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not search. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <CommunityDialog
      label="Search the hive"
      description="Find messages across your community."
      icon={Search}
      onClose={onClose}
    >
      <div className="flex flex-col">
        <form onSubmit={run} className="flex items-center gap-2">
          <input
            ref={inputRef}
            data-dialog-autofocus
            aria-label="Search messages"
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
            {busy ? "Searching…" : error ? "Retry search" : "Search"}
          </button>
        </form>

        {error && (
          <p className="mt-3 text-red-400 text-sm" role="alert">
            {error}
          </p>
        )}
        <div className="flex-1 overflow-y-auto p-2" aria-busy={busy}>
          {error || busy ? null : hits === null ? (
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
                  onOpenChannel(hit.channelId, hit.id);
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
    </CommunityDialog>
  );
}
