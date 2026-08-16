import { useState } from "react";
import { useChannels } from "@/features/chat/use-chat";
import { useMembership } from "@/features/identity/use-identity";
import { useNames } from "@/features/profile/use-profiles";
import { SurfaceShell } from "@/features/surfaces/ui/SurfaceShell";
import {
  runLabel,
  templateYaml,
  useWorkflowRuns,
  useWorkflows,
  type Workflow,
} from "@/features/workflows/use-workflows";
import { cn } from "@/shared/lib/cn";

function when(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function WorkflowDetail({
  workflow,
  channelName,
  mine,
  onSave,
  onDelete,
  onRun,
  onClose,
}: {
  workflow: Workflow;
  channelName: string;
  mine: boolean;
  onSave: (yaml: string) => Promise<string | null>;
  onDelete: () => Promise<string | null>;
  onRun: () => Promise<string | null>;
  onClose: () => void;
}) {
  const [yaml, setYaml] = useState(workflow.yaml);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const runs = useWorkflowRuns(workflow.id);
  const dirty = yaml !== workflow.yaml;

  async function act(fn: () => Promise<string | null>, ok: string) {
    setNotice(null);
    const failure = await fn();
    setNotice(failure ? `⚠️ ${failure}` : ok);
  }

  return (
    <div className="border-neutral-800 border-t bg-neutral-900/40 px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-base">{workflow.name}</h3>
        <span className="text-neutral-500 text-xs">watches #{channelName}</span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded-lg border border-neutral-700 px-2 py-1 text-neutral-300 text-xs"
        >
          Close
        </button>
      </div>

      <textarea
        value={yaml}
        onChange={(e) => setYaml(e.target.value)}
        readOnly={!mine}
        rows={Math.min(18, Math.max(8, yaml.split("\n").length + 1))}
        spellCheck={false}
        className={cn(
          "mt-3 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-xs leading-relaxed outline-none",
          mine ? "focus:border-neutral-600" : "opacity-80",
        )}
      />
      {!mine ? (
        <p className="mt-1 text-neutral-600 text-xs">
          Read-only: this workflow belongs to someone else.
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {mine ? (
          <button
            type="button"
            disabled={!dirty}
            onClick={() => void act(() => onSave(yaml), "Saved.")}
            className="rounded-lg bg-amber-500 px-3 py-1.5 font-semibold text-neutral-950 text-xs disabled:opacity-40"
          >
            Save changes
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void act(onRun, "Trigger sent.")}
          className="rounded-lg border border-neutral-700 px-3 py-1.5 text-neutral-300 text-xs hover:border-neutral-500"
        >
          Run now
        </button>
        {mine ? (
          confirming ? (
            <button
              type="button"
              onClick={() => void act(onDelete, "Deleted.")}
              className="rounded-lg bg-red-900 px-3 py-1.5 text-red-200 text-xs"
            >
              Really delete?
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-lg border border-neutral-700 px-3 py-1.5 text-neutral-400 text-xs"
            >
              Delete
            </button>
          )
        ) : null}
        {notice ? (
          <span className="text-neutral-400 text-xs">{notice}</span>
        ) : null}
      </div>

      <h4 className="mt-4 font-semibold text-neutral-500 text-xs uppercase tracking-wide">
        Run history
      </h4>
      {runs.length === 0 ? (
        <p className="mt-1 text-neutral-600 text-xs">
          No run events recorded. The relay does not publish run history yet;
          watch the target channel to see a workflow act.
        </p>
      ) : (
        <ul className="mt-1">
          {runs.map((run) => (
            <li key={run.id} className="flex gap-2 py-0.5 text-xs">
              <span className="text-neutral-500">{when(run.createdAt)}</span>
              <span>{runLabel(run.kind)}</span>
              {run.content ? (
                <span className="truncate text-neutral-400">{run.content}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function WorkflowsPage() {
  const { identity } = useMembership();
  const pubkey = (identity?.pubkey ?? "").toLowerCase();
  const { workflows, loading, save, remove, runNow } = useWorkflows();
  const { channels } = useChannels();
  const names = useNames();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newYaml, setNewYaml] = useState(templateYaml);
  const [newChannel, setNewChannel] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const regular = channels.filter((c) => c.kind === "channel");
  const channelName = (id: string | null) =>
    channels.find((c) => c.id === id)?.name ?? id?.slice(0, 8) ?? "unknown";

  async function onCreate() {
    const channel = newChannel || regular[0]?.id;
    if (!channel) {
      setNotice("⚠️ no channel to attach it to");
      return;
    }
    setNotice(null);
    const id = crypto.randomUUID();
    const failure = await save(id, channel, newYaml);
    if (failure) {
      setNotice(`⚠️ ${failure}`);
      return;
    }
    setCreating(false);
    setNewYaml(templateYaml());
    setOpenId(id);
  }

  return (
    <SurfaceShell
      title="Workflows"
      subtitle="Automation the whole room can read"
      action={
        <button
          type="button"
          onClick={() => setCreating((c) => !c)}
          className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 font-semibold text-neutral-950 text-sm"
        >
          {creating ? "Cancel" : "New workflow"}
        </button>
      }
    >
      <div className="mx-auto max-w-2xl">
        {creating ? (
          <div className="border-neutral-800 border-b px-4 py-4">
            <label
              className="block text-neutral-500 text-xs"
              htmlFor="wf-channel"
            >
              Channel it watches
            </label>
            <select
              id="wf-channel"
              value={newChannel || regular[0]?.id || ""}
              onChange={(e) => setNewChannel(e.target.value)}
              className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm outline-none"
            >
              {regular.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                </option>
              ))}
            </select>
            <textarea
              value={newYaml}
              onChange={(e) => setNewYaml(e.target.value)}
              rows={12}
              spellCheck={false}
              className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-neutral-600"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void onCreate()}
                className="rounded-lg bg-amber-500 px-3 py-1.5 font-semibold text-neutral-950 text-xs"
              >
                Create
              </button>
              {notice ? (
                <span className="text-neutral-400 text-xs">{notice}</span>
              ) : null}
            </div>
          </div>
        ) : null}

        {loading && workflows.length === 0 ? (
          <p className="px-4 py-6 text-neutral-500 text-sm">loading…</p>
        ) : workflows.length === 0 && !creating ? (
          <p className="px-4 py-6 text-neutral-500 text-sm">
            No workflows yet. Create the first one: a YAML definition that
            watches a channel and acts when its trigger fires.
          </p>
        ) : (
          workflows.map((workflow) => (
            <div key={workflow.id}>
              <button
                type="button"
                onClick={() =>
                  setOpenId(openId === workflow.id ? null : workflow.id)
                }
                className="flex w-full items-center gap-3 border-neutral-800 border-b px-4 py-3 text-left hover:bg-neutral-900"
              >
                <span aria-hidden="true">⚡</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <b className="text-sm">{workflow.name}</b>
                    {!workflow.enabled ? (
                      <span className="rounded border border-neutral-700 px-1 text-neutral-500 text-xs">
                        disabled
                      </span>
                    ) : null}
                  </span>
                  <span className="block text-neutral-500 text-xs">
                    #{channelName(workflow.channelId)} · by{" "}
                    {names(workflow.owner)} · {when(workflow.updatedAt)}
                  </span>
                </span>
              </button>
              {openId === workflow.id ? (
                <WorkflowDetail
                  workflow={workflow}
                  channelName={channelName(workflow.channelId)}
                  mine={workflow.owner === pubkey}
                  onSave={(yaml) =>
                    save(workflow.id, workflow.channelId ?? "", yaml)
                  }
                  onDelete={() => remove(workflow)}
                  onRun={() => runNow(workflow)}
                  onClose={() => setOpenId(null)}
                />
              ) : null}
            </div>
          ))
        )}
      </div>
    </SurfaceShell>
  );
}
