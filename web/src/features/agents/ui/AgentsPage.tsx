import { Bot } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useAgents, type AgentInfo } from "@/features/agents/use-agents";
import { CloudAgents } from "@/features/agents/ui/CloudAgents";
import { usePresence } from "@/features/chat/use-presence";
import { useChannels } from "@/features/chat/use-chat";
import { PresenceDot } from "@/features/chat/ui/PresenceDot";
import { openDm } from "@/features/dm/open-dm";
import { useMembership } from "@/features/identity/use-identity";
import { AvatarDisc } from "@/features/profile/ui/AvatarDisc";
import {
  getProfilesSnapshot,
  subscribeProfiles,
} from "@/features/profile/profile-store";
import { useNames } from "@/features/profile/use-profiles";
import { SurfaceShell } from "@/features/surfaces/ui/SurfaceShell";
import { useSyncExternalStore } from "react";

function ago(ts: number | null): string {
  if (!ts) {
    return "No messages in the loaded history";
  }
  const delta = Date.now() / 1000 - ts;
  if (delta < 120) {
    return "Last message just now";
  }
  if (delta < 3600) {
    return `Last message ${Math.round(delta / 60)}m ago`;
  }
  if (delta < 86400) {
    return `Last message ${Math.round(delta / 3600)}h ago`;
  }
  return `Last message ${Math.round(delta / 86400)}d ago`;
}

function AgentCard({
  agent,
  name,
  ownerName,
  channelName,
  status,
  onMessage,
  busy,
}: {
  agent: AgentInfo;
  name: string;
  ownerName: string | null;
  channelName: string | null;
  status: "online" | "away" | "offline";
  onMessage: () => void;
  busy: boolean;
}) {
  return (
    <div className="hive-list-row flex items-start gap-3 border-neutral-800 border-b">
      <AvatarDisc pubkey={agent.pubkey} name={name} size={34} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <b className="text-sm">{name}</b>
          <PresenceDot status={status} />
          <span className="hive-agent-tag">agent</span>
        </div>
        <p className="hive-agent-details">
          <span>
            {ownerName ? `Managed by ${ownerName}` : "Community agent"}
          </span>
          {agent.respondTo ? <span>Responds to {agent.respondTo}</span> : null}
          <br />
          <span>
            {ago(agent.lastActive)}
            {channelName ? ` in #${channelName}` : ""}
          </span>
          {agent.parallelism ? (
            <span>Up to {agent.parallelism} parallel turns</span>
          ) : null}
        </p>
      </div>
      <button
        type="button"
        onClick={onMessage}
        disabled={busy}
        className="shrink-0 rounded-lg border border-neutral-700 px-2.5 py-1.5 text-neutral-300 text-xs hover:border-neutral-500 disabled:opacity-50"
      >
        {busy ? "…" : "Message"}
      </button>
    </div>
  );
}

export function AgentsPage() {
  const { identity } = useMembership();
  const pubkey = identity?.pubkey ?? "";
  const snapshot = useSyncExternalStore(
    subscribeProfiles,
    getProfilesSnapshot,
    getProfilesSnapshot,
  );
  const botPubkeys = useMemo(
    () =>
      [...snapshot.profiles.entries()]
        .filter(([, profile]) => profile.bot)
        .map(([pk]) => pk),
    [snapshot],
  );
  const { agents, loading } = useAgents(botPubkeys);
  const { statusOf } = usePresence(pubkey);
  const { channels } = useChannels();
  const names = useNames();
  const navigate = useNavigate();
  const [busyPk, setBusyPk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const channelName = (id: string | null) =>
    channels.find((c) => c.id === id)?.name ?? null;

  async function message(agent: AgentInfo) {
    setBusyPk(agent.pubkey);
    setError(null);
    try {
      const dmId = await openDm([agent.pubkey]);
      void navigate({ to: "/chat", search: { channel: dmId } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "could not open a DM");
      setBusyPk(null);
    }
  }

  const online = agents.filter((a) => statusOf(a.pubkey) !== "offline");
  const offline = agents.filter((a) => statusOf(a.pubkey) === "offline");

  return (
    <SurfaceShell title="Agents">
      <div className="hive-feed">
        <CloudAgents />
        {error ? (
          <p className="px-4 pt-3 text-red-400 text-sm" role="alert">
            {error}
          </p>
        ) : null}
        {loading && agents.length === 0 ? (
          <p className="px-4 py-6 text-neutral-500 text-sm">
            looking for agents…
          </p>
        ) : agents.length === 0 ? (
          <div className="hive-empty">
            <Bot aria-hidden="true" />
            <h3>Room for a new collaborator.</h3>
            <p>
              Registered community agents will appear here. Ask in #developers
              to get started.
            </p>
          </div>
        ) : (
          <section aria-label="Community agent directory">
            <div className="hive-section-heading">
              <Bot size={20} aria-hidden="true" />
              <div>
                <h2>Community directory</h2>
                <p>
                  {agents.length} registered identities · presence is not
                  running-task status
                </p>
              </div>
            </div>
            {online.length > 0 ? (
              <h2 className="px-4 pt-4 pb-1 font-semibold text-neutral-500 text-xs uppercase tracking-wide">
                Around now · {online.length}
              </h2>
            ) : null}
            {online.map((agent) => (
              <AgentCard
                key={agent.pubkey}
                agent={agent}
                name={agent.configName ?? names(agent.pubkey)}
                ownerName={agent.owner ? names(agent.owner) : null}
                channelName={channelName(agent.lastChannel)}
                status={statusOf(agent.pubkey)}
                onMessage={() => void message(agent)}
                busy={busyPk === agent.pubkey}
              />
            ))}
            {offline.length > 0 ? (
              <h2 className="px-4 pt-4 pb-1 font-semibold text-neutral-500 text-xs uppercase tracking-wide">
                Offline · {offline.length}
              </h2>
            ) : null}
            {offline.map((agent) => (
              <AgentCard
                key={agent.pubkey}
                agent={agent}
                name={agent.configName ?? names(agent.pubkey)}
                ownerName={agent.owner ? names(agent.owner) : null}
                channelName={channelName(agent.lastChannel)}
                status="offline"
                onMessage={() => void message(agent)}
                busy={busyPk === agent.pubkey}
              />
            ))}
            <p className="hive-panel-note">
              Presence is based on recent connections. Desktop agents run on
              their owner’s device; cloud runtime status appears above when the
              service is reachable.
            </p>
          </section>
        )}
        <details className="mt-6 border-t border-neutral-800 pt-4">
          <summary className="cursor-pointer text-sm text-neutral-400">
            Advanced
          </summary>
          <div className="py-4">
            <Link
              to="/workflows"
              className="text-sm text-amber-300 underline underline-offset-4"
            >
              Workflows
            </Link>
            <p className="mt-2 text-sm text-neutral-500">
              Create and manage channel automations.
            </p>
          </div>
        </details>
      </div>
    </SurfaceShell>
  );
}
