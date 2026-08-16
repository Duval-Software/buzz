import { useCallback, useEffect, useState } from "react";
import {
  cloudAgentLog,
  createCloudAgent,
  deleteCloudAgent,
  listCloudAgents,
  pauseCloudAgent,
  resumeCloudAgent,
  retireManagedRecord,
  type CloudAgent,
  type CloudTurn,
  type CreateAgentInput,
} from "@/features/agents/keeper";
import { AvatarDisc } from "@/features/profile/ui/AvatarDisc";
import { cn } from "@/shared/lib/cn";

/**
 * The cloud tier: agents that live on CreatorHive's servers and never sleep.
 *
 * The form enforces the key policy in copy before the keeper enforces it in
 * code: a real model needs the member's own Anthropic API key. Echo is the
 * keyless demo lane. The key is sent once over TLS to the keeper, sealed at
 * rest there, and never stored in the browser.
 */
export function CloudAgents() {
  const [agents, setAgents] = useState<CloudAgent[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [creating, setCreating] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [logFor, setLogFor] = useState<string | null>(null);
  const [logTurns, setLogTurns] = useState<CloudTurn[]>([]);

  const [form, setForm] = useState<CreateAgentInput>({
    name: "",
    system_prompt: "",
    model: "echo",
    respond_to: "mentions",
    api_key: "",
    nsec: undefined,
  });

  const refresh = useCallback(async () => {
    try {
      setAgents(await listCloudAgents());
      setUnavailable(false);
    } catch {
      // A member who has never made an agent should not see an error wall
      // just because the keeper is down; the section explains itself.
      setUnavailable(true);
      setAgents([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "that did not work");
    } finally {
      setBusy(false);
    }
  }

  async function onCreate() {
    if (!form.name.trim()) {
      setError("give it a name");
      return;
    }
    if (adopting && !form.nsec?.trim()) {
      setError("paste the agent's nsec key to promote it");
      return;
    }
    await act(async () => {
      await createCloudAgent({
        ...form,
        nsec: adopting ? form.nsec?.trim() : undefined,
      });
      setCreating(false);
      setAdopting(false);
      setForm({
        name: "",
        system_prompt: "",
        model: "echo",
        respond_to: "mentions",
        api_key: "",
        nsec: undefined,
      });
    });
  }

  async function onDelete(agent: CloudAgent) {
    await act(async () => {
      await deleteCloudAgent(agent.pubkey);
      await retireManagedRecord(agent.pubkey);
    });
  }

  async function showLog(pubkey: string) {
    if (logFor === pubkey) {
      setLogFor(null);
      return;
    }
    setLogFor(pubkey);
    try {
      setLogTurns(await cloudAgentLog(pubkey));
    } catch {
      setLogTurns([]);
    }
  }

  const needsKey = form.model !== "echo";

  return (
    <section className="border-neutral-800 border-b pb-4">
      <div className="flex items-center gap-2 px-4 pt-4 pb-1">
        <h2 className="font-semibold text-neutral-500 text-xs uppercase tracking-wide">
          My cloud agents
        </h2>
        <span className="rounded border border-emerald-800 px-1 text-emerald-400 text-xs">
          always on
        </span>
        <button
          type="button"
          onClick={() => {
            setCreating((c) => !c);
            setAdopting(false);
          }}
          className="ml-auto rounded-lg bg-amber-500 px-2.5 py-1 font-semibold text-neutral-950 text-xs"
        >
          {creating ? "Cancel" : "Create agent"}
        </button>
      </div>

      {error ? (
        <p className="px-4 py-1 text-red-400 text-sm" role="alert">
          {error}
        </p>
      ) : null}

      {creating ? (
        <div className="mx-4 mt-2 rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
          <div className="flex gap-2">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Agent name"
              maxLength={40}
              className="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-sm outline-none focus:border-neutral-600"
            />
            <select
              value={form.model}
              onChange={(e) =>
                setForm({
                  ...form,
                  model: e.target.value as CreateAgentInput["model"],
                })
              }
              className="rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm outline-none"
            >
              <option value="echo">echo (free test)</option>
              <option value="haiku">haiku</option>
              <option value="sonnet">sonnet</option>
            </select>
            <select
              value={form.respond_to}
              onChange={(e) =>
                setForm({
                  ...form,
                  respond_to: e.target.value as CreateAgentInput["respond_to"],
                })
              }
              className="rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm outline-none"
            >
              <option value="mentions">answers mentions</option>
              <option value="owner-only">answers only me</option>
            </select>
          </div>
          <textarea
            value={form.system_prompt}
            onChange={(e) =>
              setForm({ ...form, system_prompt: e.target.value })
            }
            placeholder="Persona: who is this agent, what does it know, how does it talk?"
            rows={3}
            className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-sm outline-none focus:border-neutral-600"
          />
          {needsKey ? (
            <div className="mt-2">
              <input
                value={form.api_key}
                onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                placeholder="Your Anthropic API key (sk-ant-…)"
                type="password"
                autoComplete="off"
                className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 font-mono text-sm outline-none focus:border-neutral-600"
              />
              <p className="mt-1 text-neutral-600 text-xs">
                Cloud agents run on your key and your budget. It is sent once
                over TLS, stored encrypted on the server, never in this browser.
                Pick echo to try the plumbing without one.
              </p>
            </div>
          ) : (
            <p className="mt-2 text-neutral-600 text-xs">
              Echo agents are free: no API key, canned replies, real everything
              else. Switch the model later by recreating it.
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onCreate()}
              className="rounded-lg bg-amber-500 px-3 py-1.5 font-semibold text-neutral-950 text-xs disabled:opacity-40"
            >
              {busy ? "…" : adopting ? "Promote to cloud" : "Create"}
            </button>
            <button
              type="button"
              onClick={() => setAdopting((a) => !a)}
              className="rounded-lg border border-neutral-700 px-3 py-1.5 text-neutral-300 text-xs"
            >
              {adopting ? "Mint a new key instead" : "Promote a desktop agent…"}
            </button>
          </div>
          {adopting ? (
            <div className="mt-2">
              <input
                value={form.nsec ?? ""}
                onChange={(e) => setForm({ ...form, nsec: e.target.value })}
                placeholder="The agent's nsec key, exported from the desktop app"
                type="password"
                autoComplete="off"
                className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 font-mono text-sm outline-none focus:border-neutral-600"
              />
              <p className="mt-1 text-amber-400/80 text-xs">
                Stop the agent in the desktop app first. One key must never run
                in two homes, or it will answer everything twice.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {unavailable && !creating ? (
        <p className="px-4 py-2 text-neutral-600 text-sm">
          The cloud agent service is not reachable right now.
        </p>
      ) : null}

      {agents !== null && agents.length === 0 && !creating && !unavailable ? (
        <p className="px-4 py-2 text-neutral-600 text-sm">
          None yet. Cloud agents live on CreatorHive's servers and never sleep.
          Create one, or promote a desktop agent.
        </p>
      ) : null}

      {(agents ?? []).map((agent) => (
        <div key={agent.pubkey} className="px-4 py-2">
          <div className="flex items-center gap-2">
            <AvatarDisc pubkey={agent.pubkey} name={agent.name} size={26} />
            <b className="text-sm">{agent.name}</b>
            <span
              className={cn(
                "rounded border px-1 text-xs",
                agent.running
                  ? "border-emerald-800 text-emerald-400"
                  : "border-neutral-700 text-neutral-500",
              )}
            >
              {agent.running ? "running" : agent.paused ? "paused" : "stopped"}
            </span>
            <span className="text-neutral-600 text-xs">
              {agent.model} · {agent.respond_to}
              {agent.tokens_today > 0
                ? ` · ${Math.round(agent.tokens_today / 1000)}k tokens today`
                : ""}
            </span>
            <span className="ml-auto flex gap-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    agent.paused
                      ? resumeCloudAgent(agent.pubkey)
                      : pauseCloudAgent(agent.pubkey),
                  )
                }
                className="rounded-lg border border-neutral-700 px-2 py-1 text-neutral-300 text-xs disabled:opacity-40"
              >
                {agent.paused ? "Resume" : "Pause"}
              </button>
              <button
                type="button"
                onClick={() => void showLog(agent.pubkey)}
                className="rounded-lg border border-neutral-700 px-2 py-1 text-neutral-300 text-xs"
              >
                Log
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onDelete(agent)}
                className="rounded-lg border border-red-900 px-2 py-1 text-red-400 text-xs disabled:opacity-40"
              >
                Delete
              </button>
            </span>
          </div>
          {logFor === agent.pubkey ? (
            <div className="mt-1 rounded-lg border border-neutral-800 bg-neutral-950 p-2">
              {logTurns.length === 0 ? (
                <p className="text-neutral-600 text-xs">No turns yet.</p>
              ) : (
                logTurns
                  .slice(-10)
                  .reverse()
                  .map((turn) => (
                    <p
                      key={`${turn.at}-${turn.from}`}
                      className="py-0.5 text-neutral-400 text-xs"
                    >
                      <span className="text-neutral-600">
                        {new Date(turn.at * 1000).toLocaleTimeString()}
                      </span>{" "}
                      heard {turn.heard}
                      {turn.said ? <> → said {turn.said}</> : null}
                      {turn.error ? (
                        <span className="text-red-400"> ({turn.error})</span>
                      ) : null}
                    </p>
                  ))
              )}
            </div>
          ) : null}
        </div>
      ))}
    </section>
  );
}
