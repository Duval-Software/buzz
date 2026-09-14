import { Cloud } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  cloudAgentLog,
  createCloudAgent,
  deleteCloudAgent,
  listCloudAgents,
  listCloudModels,
  legacyCloudModels,
  type CloudModel,
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
 * code: a real model needs the member's own provider API key. Echo is the
 * keyless demo lane. The key is sent once over TLS to the keeper, sealed at
 * rest there, and never stored in the browser.
 */
export function CloudAgents() {
  const [models, setModels] = useState<CloudModel[]>(legacyCloudModels);
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
      const [agents, models] = await Promise.all([
        listCloudAgents(),
        listCloudModels(),
      ]);
      setAgents(agents);
      setModels(models);
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

  const selectedModel = models.find((model) => model.id === form.model);
  const isOpenRouter = selectedModel?.provider === "openrouter";
  const needsKey = selectedModel?.provider !== "echo";

  return (
    <section>
      <div className="hive-section-heading">
        <Cloud size={20} aria-hidden="true" />
        <div>
          <h2>My cloud agents</h2>
          <p>Your hosted agents and their runtime status.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setCreating((c) => !c);
            setAdopting(false);
            setForm((form) => ({ ...form, api_key: "", nsec: undefined }));
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
        <div className="hive-cloud-form">
          <div className="flex flex-wrap gap-2">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              aria-label="Agent name"
              placeholder="Agent name"
              maxLength={40}
              className="min-w-0 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-sm outline-none focus:border-neutral-600"
            />
            <select
              aria-label="Model"
              value={form.model}
              onChange={(e) =>
                setForm({
                  ...form,
                  model: e.target.value,
                  api_key:
                    models.find((model) => model.id === e.target.value)
                      ?.provider === selectedModel?.provider
                      ? form.api_key
                      : "",
                })
              }
              className="min-w-0 max-w-full rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm outline-none"
            >
              {(["echo", "anthropic", "openrouter"] as const).map(
                (provider) => (
                  <optgroup
                    key={provider}
                    label={
                      provider === "openrouter"
                        ? "OpenRouter"
                        : provider === "anthropic"
                          ? "Anthropic"
                          : "Test agent"
                    }
                  >
                    {models
                      .filter((model) => model.provider === provider)
                      .map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.label}
                        </option>
                      ))}
                  </optgroup>
                ),
              )}
            </select>
            <select
              aria-label="Who the agent responds to"
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
          {!models.some((model) => model.provider === "openrouter") && (
            <p className="mt-2 text-neutral-400 text-xs">
              OpenRouter models will appear here when the cloud service supports
              them.
            </p>
          )}
          <textarea
            maxLength={4000}
            aria-label="Agent persona"
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
                aria-label={
                  isOpenRouter
                    ? "Your OpenRouter API key"
                    : "Your Anthropic API key"
                }
                value={form.api_key}
                onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                placeholder={
                  isOpenRouter
                    ? "Your OpenRouter API key (sk-or-…)"
                    : "Your Anthropic API key (sk-ant-…)"
                }
                maxLength={512}
                type="password"
                autoComplete="off"
                className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 font-mono text-sm outline-none focus:border-neutral-600"
              />
              <p className="mt-1 text-neutral-600 text-xs">
                {isOpenRouter
                  ? "Model usage is billed to your OpenRouter account. "
                  : "Cloud agents use your own provider account. "}
                Your key is sent securely to the cloud service and stored
                encrypted. It is not saved on this device or included in
                community messages. Choose Echo for a free test.
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
              disabled={busy || !selectedModel}
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
                aria-label="Agent backup key"
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
        <div className="hive-notice" role="status">
          <strong>Cloud service unavailable</strong>
          <p>
            We can’t retrieve your hosted agents right now. Their running status
            is unknown.
          </p>
          <button
            type="button"
            className="mt-2 rounded border border-neutral-600 px-3 py-1.5"
            onClick={() => void refresh()}
          >
            Try again
          </button>
        </div>
      ) : null}

      {agents !== null && agents.length === 0 && !creating && !unavailable ? (
        <p className="px-4 py-2 text-neutral-600 text-sm">
          You haven’t created a cloud agent yet. Create one or bring an existing
          desktop agent to CreatorHive’s servers.
        </p>
      ) : null}

      {(agents ?? []).map((agent) => (
        <div key={agent.pubkey} className="hive-list-row">
          <div className="flex flex-wrap items-center gap-2">
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
