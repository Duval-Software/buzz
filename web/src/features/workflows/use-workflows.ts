/**
 * Workflows: automation as data, exactly as the desktop and relay define it.
 *
 * A definition is kind:30620 — addressable, `d` = workflow id, `h` = the
 * channel it watches, content = the YAML. Saving an edit republishes the same
 * `d`; the newest replaces. Deleting is kind:5 with an `a` coordinate
 * (`30620:<owner>:<id>`), which only works on your own definitions because a
 * coordinate names its author.
 *
 * "Run now" is kind:46020 with the workflow's `d`. Run lifecycle events
 * (46001..46007, filtered by `#d`) are subscribed faithfully, with a caveat
 * inherited from upstream: the relay does not emit them yet, so history may
 * legitimately be empty. The UI says so instead of pretending.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NostrEvent } from "@/shared/lib/nostr-client";
import { getSocket } from "@/shared/lib/nostr-socket";
import { signNostrEvent } from "@/shared/lib/nostr-signer";
import { relayWsUrl } from "@/shared/lib/relay-url";

const KIND_WORKFLOW_DEF = 30620;
const KIND_DELETE = 5;
const KIND_TRIGGER = 46020;
const RUN_KINDS = [46001, 46002, 46003, 46004, 46005, 46006, 46007];

export type Workflow = {
  /** The `d` tag: stable identity across edits. */
  id: string;
  /** The newest event id carrying this definition, needed for deletion. */
  eventId: string;
  channelId: string | null;
  owner: string;
  yaml: string;
  updatedAt: number;
  /** Parsed best-effort from the YAML for display; the YAML stays the truth. */
  name: string;
  enabled: boolean;
};

export type WorkflowRun = {
  id: string;
  kind: number;
  createdAt: number;
  content: string;
  tags: string[][];
};

const RUN_LABEL: Record<number, string> = {
  46001: "triggered",
  46002: "step started",
  46003: "step completed",
  46004: "step failed",
  46005: "completed",
  46006: "failed",
  46007: "cancelled",
};

export function runLabel(kind: number): string {
  return RUN_LABEL[kind] ?? `event ${kind}`;
}

/** Cheap display fields without a YAML parser: name and enabled flag. */
function scrapeYaml(yaml: string): { name: string; enabled: boolean } {
  const name = /^name:\s*["']?(.+?)["']?\s*$/m.exec(yaml)?.[1] ?? "unnamed";
  const enabled = !/^enabled:\s*false\s*$/m.test(yaml);
  return { name, enabled };
}

function toWorkflow(event: NostrEvent): Workflow | null {
  const id = event.tags.find((t) => t[0] === "d")?.[1];
  if (!id) {
    return null;
  }
  const { name, enabled } = scrapeYaml(event.content);
  return {
    id,
    eventId: event.id,
    channelId: event.tags.find((t) => t[0] === "h")?.[1] ?? null,
    owner: event.pubkey.toLowerCase(),
    yaml: event.content,
    updatedAt: event.created_at,
    name,
    enabled,
  };
}

export function useWorkflows(): {
  workflows: Workflow[];
  loading: boolean;
  save: (id: string, channelId: string, yaml: string) => Promise<string | null>;
  remove: (workflow: Workflow) => Promise<string | null>;
  runNow: (workflow: Workflow) => Promise<string | null>;
} {
  const socket = useMemo(() => getSocket(relayWsUrl()), []);
  const [byId, setById] = useState<Map<string, Workflow>>(new Map());
  const [loading, setLoading] = useState(true);
  const newest = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const unsubscribe = socket.subscribe(
      [{ kinds: [KIND_WORKFLOW_DEF], limit: 100 }],
      {
        onEvent: (event) => {
          const workflow = toWorkflow(event);
          if (!workflow) {
            return;
          }
          // Addressable: keep only the newest per d.
          const seen = newest.current.get(workflow.id) ?? 0;
          if (event.created_at < seen) {
            return;
          }
          newest.current.set(workflow.id, event.created_at);
          setById((prev) => {
            const next = new Map(prev);
            next.set(workflow.id, workflow);
            return next;
          });
        },
        onEose: () => setLoading(false),
        onClosed: () => setLoading(false),
      },
    );
    return unsubscribe;
  }, [socket]);

  const workflows = useMemo(
    () => [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt),
    [byId],
  );

  const save = useCallback(
    async (id: string, channelId: string, yaml: string) => {
      const signed = await signNostrEvent({
        kind: KIND_WORKFLOW_DEF,
        tags: [
          ["d", id],
          ["h", channelId],
        ],
        content: yaml,
      });
      const { accepted, reason } = await socket.publish(signed);
      if (!accepted) {
        return reason || "the relay refused the definition";
      }
      const workflow = toWorkflow(signed);
      if (workflow) {
        newest.current.set(workflow.id, signed.created_at);
        setById((prev) => new Map(prev).set(workflow.id, workflow));
      }
      return null;
    },
    [socket],
  );

  const remove = useCallback(
    async (workflow: Workflow) => {
      // Two deletions on purpose. The desktop's a-coordinate form is accepted
      // by the relay but VERIFIED LIVE not to purge the stored definition, so
      // an event-id deletion rides along; the relay honors that one. Each
      // kind:5 carries exactly one target (relay rule).
      const byCoord = await signNostrEvent({
        kind: KIND_DELETE,
        tags: [["a", `${KIND_WORKFLOW_DEF}:${workflow.owner}:${workflow.id}`]],
        content: "",
      });
      await socket.publish(byCoord);
      const signed = await signNostrEvent({
        kind: KIND_DELETE,
        tags: [
          ...(workflow.channelId ? [["h", workflow.channelId]] : []),
          ["e", workflow.eventId],
        ],
        content: "",
      });
      const { accepted, reason } = await socket.publish(signed);
      if (!accepted) {
        return reason || "the relay refused the delete";
      }
      newest.current.delete(workflow.id);
      setById((prev) => {
        const next = new Map(prev);
        next.delete(workflow.id);
        return next;
      });
      return null;
    },
    [socket],
  );

  const runNow = useCallback(
    async (workflow: Workflow) => {
      const signed = await signNostrEvent({
        kind: KIND_TRIGGER,
        tags: [["d", workflow.id]],
        content: "",
      });
      const { accepted, reason } = await socket.publish(signed);
      return accepted ? null : reason || "the relay refused the trigger";
    },
    [socket],
  );

  return { workflows, loading, save, remove, runNow };
}

/** Lifecycle events for one workflow, newest first. May be empty upstream. */
export function useWorkflowRuns(workflowId: string | null): WorkflowRun[] {
  const socket = useMemo(() => getSocket(relayWsUrl()), []);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);

  useEffect(() => {
    setRuns([]);
    if (!workflowId) {
      return;
    }
    const unsubscribe = socket.subscribe(
      [{ kinds: RUN_KINDS, "#d": [workflowId], limit: 50 }],
      {
        onEvent: (event) => {
          setRuns((prev) => {
            if (prev.some((r) => r.id === event.id)) {
              return prev;
            }
            const next = [
              ...prev,
              {
                id: event.id,
                kind: event.kind,
                createdAt: event.created_at,
                content: event.content,
                tags: event.tags,
              },
            ];
            next.sort((a, b) => b.createdAt - a.createdAt);
            return next;
          });
        },
      },
    );
    return unsubscribe;
  }, [socket, workflowId]);

  return runs;
}

/** A safe starter definition: fires only when someone says the magic word. */
export function templateYaml(): string {
  return `name: My first workflow
description: Replies when someone says "buzz buzz"
enabled: true
trigger:
  on: message_posted
  filter: 'contains(trigger_text, "buzz buzz")'
steps:
  - id: reply
    action: send_message
    text: "🐝 The hive hears you, {{trigger.author}}!"
`;
}
