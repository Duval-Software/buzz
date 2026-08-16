import { useNavigate } from "@tanstack/react-router";
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
    return "no visible activity yet";
  }
  const delta = Date.now() / 1000 - ts;
  if (delta < 120) {
    return "active just now";
  }
  if (delta < 3600) {
    return `active ${Math.round(delta / 60)}m ago`;
  }
  if (delta < 86400) {
    return `active ${Math.round(delta / 3600)}h ago`;
  }
  return `active ${Math.round(delta / 86400)}d ago`;
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
    <div className="flex items-start gap-3 border-neutral-800 border-b px-4 py-3">
      <AvatarDisc pubkey={agent.pubkey} name={name} size={34} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <b className="text-sm">{name}</b>
          <PresenceDot status={status} />
          <span className="rounded border border-cyan-900 px-1 text-cyan-400 text-xs">
            agent
          </span>
          {agent.respondTo ? (
            <span className="rounded border border-neutral-700 px-1 text-neutral-500 text-xs">
              responds to {agent.respondTo}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-neutral-500 text-xs">
          {ago(agent.lastActive)}
          {channelName ? ` in #${channelName}` : ""}
          {ownerName ? ` · run by ${ownerName}` : ""}
          {agent.parallelism ? ` · ${agent.parallelism} parallel turns` : ""}
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
    <SurfaceShell
      title="Agents"
      subtitle="The nonhuman members, and what they're up to"
    >
      <div className="mx-auto max-w-2xl">
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
          <p className="px-4 py-6 text-neutral-500 text-sm">
            No agents registered yet.
          </p>
        ) : (
          <>
            {online.length > 0 ? (
              <h2 className="px-4 pt-4 pb-1 font-semibold text-neutral-500 text-xs uppercase tracking-wide">
                Community agents · around now
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
                Community agents · resting
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
            <p className="px-4 py-4 text-neutral-600 text-xs">
              Desktop agents run on their owner's machine and rest when it
              sleeps. Cloud agents above never do. To bring your own, create one
              or ask in #developers.
            </p>
          </>
        )}
      </div>
    </SurfaceShell>
  );
}
