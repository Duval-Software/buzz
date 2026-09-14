/**
 * The agentkeeper client: how the browser manages CLOUD agents.
 *
 * Every call is NIP-98 signed by the member, same-origin at /keeper/* (Caddy
 * proxies to the service), so the signature's `u` tag names the host the
 * browser actually called and no CORS is involved.
 *
 * Key policy, enforced server-side and mirrored in the UI: members bring
 * their own provider API key. Only the operator's agents may run on the
 * platform key. The "echo" model is keyless: it tests the whole pipeline
 * without spending a token.
 */

import { makeNip98AuthHeader } from "@/shared/lib/nip98";
import { getSocket } from "@/shared/lib/nostr-socket";
import { signNostrEvent } from "@/shared/lib/nostr-signer";
import { relayWsUrl } from "@/shared/lib/relay-url";

const KIND_MANAGED_AGENT = 30177;

export type CloudAgent = {
  pubkey: string;
  name: string;
  model: string;
  respond_to: string;
  key_mode: string;
  paused: boolean;
  running: boolean;
  adopted: boolean;
  created_at: number;
  tokens_today: number;
};

export type CreateAgentInput = {
  name: string;
  system_prompt: string;
  model: string;
  respond_to: "mentions" | "owner-only";
  api_key: string;
  /** Set to promote an existing (desktop) agent instead of minting a key. */
  nsec?: string;
};

export type CloudModel = {
  id: string;
  provider: "echo" | "anthropic" | "openrouter";
  label: string;
};

// Old keepers do not advertise a catalog. Preserve only their known models.
export const legacyCloudModels: CloudModel[] = [
  { id: "echo", provider: "echo", label: "Echo (free test)" },
  { id: "haiku", provider: "anthropic", label: "Haiku" },
  { id: "sonnet", provider: "anthropic", label: "Sonnet" },
];

/** Show only server-supported providers; never send an OpenRouter key to an old keeper. */
export async function listCloudModels(): Promise<CloudModel[]> {
  try {
    const response = await fetch("/keeper/health", {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return legacyCloudModels;
    const body = await response.json();
    if (!Array.isArray(body.models)) return legacyCloudModels;
    return body.models.filter(
      (item: CloudModel) =>
        item &&
        typeof item.id === "string" &&
        item.id.length > 0 &&
        item.id.length <= 160 &&
        typeof item.label === "string" &&
        item.label.length <= 160 &&
        ["echo", "anthropic", "openrouter"].includes(item.provider),
    );
  } catch {
    return legacyCloudModels;
  }
}

async function keeperFetch(
  path: string,
  method: string,
  body?: unknown,
): Promise<Response> {
  const url = `${window.location.origin}${path}`;
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const auth = await makeNip98AuthHeader(url, method, { body: payload });
  return fetch(path, {
    method,
    headers: {
      Authorization: auth,
      ...(payload ? { "Content-Type": "application/json" } : {}),
    },
    body: payload,
  });
}

async function orThrow<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    try {
      const parsed = JSON.parse(text) as { error?: string };
      throw new Error(parsed.error || `keeper said ${response.status}`);
    } catch (cause) {
      if (cause instanceof Error && cause.message.startsWith("keeper")) {
        throw cause;
      }
      throw new Error(
        cause instanceof Error
          ? cause.message
          : `keeper said ${response.status}`,
      );
    }
  }
  return JSON.parse(text) as T;
}

export async function listCloudAgents(): Promise<CloudAgent[]> {
  const out = await orThrow<{ agents: CloudAgent[] }>(
    await keeperFetch("/keeper/agents", "GET"),
  );
  return out.agents ?? [];
}

export async function createCloudAgent(
  input: CreateAgentInput,
): Promise<CloudAgent> {
  const model = (await listCloudModels()).find(
    (model) => model.id === input.model,
  );
  if (!model)
    throw new Error(
      "This model is not available on the cloud server. Refresh and choose another model.",
    );
  if (
    model.provider === "openrouter" &&
    (!input.api_key.trim().startsWith("sk-or-") ||
      input.api_key.trim().length <= 6 ||
      /\s/.test(input.api_key.trim()) ||
      input.api_key.trim().length > 512)
  )
    throw new Error("Enter your own OpenRouter API key (sk-or-…).");
  const path = input.nsec ? "/keeper/agents/adopt" : "/keeper/agents";
  const agent = await orThrow<CloudAgent>(
    await keeperFetch(path, "POST", input),
  );
  // Ownership on the relay is member-signed, in the exact shape the desktop
  // writes, so this agent appears in every client's roster with its owner.
  await publishManagedRecord(agent.pubkey, input);
  return agent;
}

export async function pauseCloudAgent(pubkey: string): Promise<void> {
  await orThrow(
    await keeperFetch(`/keeper/agents/${pubkey}/pause`, "POST", {}),
  );
}

export async function resumeCloudAgent(pubkey: string): Promise<void> {
  await orThrow(
    await keeperFetch(`/keeper/agents/${pubkey}/resume`, "POST", {}),
  );
}

export async function deleteCloudAgent(pubkey: string): Promise<void> {
  await orThrow(await keeperFetch(`/keeper/agents/${pubkey}`, "DELETE"));
}

export type CloudTurn = {
  at: number;
  channel?: string;
  from: string;
  heard: string;
  said?: string;
  tokens_in?: number;
  tokens_out?: number;
  error?: string;
};

export async function cloudAgentLog(pubkey: string): Promise<CloudTurn[]> {
  const out = await orThrow<{ turns: CloudTurn[] }>(
    await keeperFetch(`/keeper/agents/${pubkey}/log`, "GET"),
  );
  return out.turns ?? [];
}

async function publishManagedRecord(
  agentPubkey: string,
  input: CreateAgentInput,
): Promise<void> {
  const content = JSON.stringify({
    name: input.name,
    persona_id: "agentkeeper",
    parallelism: 1,
    respond_to: input.respond_to,
  });
  const signed = await signNostrEvent({
    kind: KIND_MANAGED_AGENT,
    tags: [["d", agentPubkey]],
    content,
  });
  await getSocket(relayWsUrl()).publish(signed);
}

/** Retire the member-signed record after a delete, so rosters stay honest. */
export async function retireManagedRecord(agentPubkey: string): Promise<void> {
  const signed = await signNostrEvent({
    kind: KIND_MANAGED_AGENT,
    tags: [["d", agentPubkey]],
    content: JSON.stringify({ retired: true }),
  });
  await getSocket(relayWsUrl()).publish(signed);
}
