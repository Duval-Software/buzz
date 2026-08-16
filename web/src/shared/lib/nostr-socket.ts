/**
 * A long-lived relay connection with live subscriptions.
 *
 * `nostr-client.queryEvents` opens a socket, reads until EOSE, and closes. That
 * is right for a one-shot read and wrong for a chat client, where the whole
 * point is that a message someone else sends appears without a refresh.
 *
 * This keeps ONE socket open per relay and multiplexes many subscriptions over
 * it, which matters because a chat UI wants several at once (channel list,
 * messages for the open channel, presence) and browsers cap concurrent
 * connections. It also handles the parts that make a live connection survive
 * real networks: NIP-42 auth on (re)connect, reconnect with backoff, and
 * replaying subscriptions after a drop so no one has to reload the page.
 */

import { makeAuthEvent } from "nostr-tools/nip42";
import type { NostrEvent, NostrFilter } from "@/shared/lib/nostr-client";
import { signNostrEvent } from "@/shared/lib/nostr-signer";

export type SubscriptionHandlers = {
  /** Called for every matching event, both stored history and live arrivals. */
  onEvent: (event: NostrEvent) => void;
  /** Called once when the relay has finished sending stored events. */
  onEose?: () => void;
  /** Called if the relay refuses or closes this subscription. */
  onClosed?: (reason: string) => void;
};

export type ConnectionState =
  | "connecting"
  | "authenticating"
  | "ready"
  | "offline";

/**
 * Whether this relay has accepted who we are.
 *
 * Separate from ConnectionState on purpose. A Buzz relay answers NIP-42 with
 * `["OK", <auth-event-id>, false, "restricted: not a relay member"]` for a key
 * that is not in the community, and then refuses every subscription. Without a
 * distinct signal that reads as "connected fine, but you are not a member", a
 * new visitor sits on a spinner forever with no idea why — the community looks
 * broken instead of closed. "unknown" means we have not heard a verdict yet.
 */
export type AuthState = "unknown" | "accepted" | "denied";

type Subscription = {
  id: string;
  filters: NostrFilter[];
  handlers: SubscriptionHandlers;
};

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 15_000;

export class NostrSocket {
  private ws: WebSocket | null = null;
  private readonly subs = new Map<string, Subscription>();
  private readonly stateListeners = new Set<(s: ConnectionState) => void>();
  private state: ConnectionState = "offline";
  private attempt = 0;
  private closedByUs = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private nextId = 0;
  private authEventId: string | null = null;
  private authed = false;
  private openGraceTimer: ReturnType<typeof setTimeout> | null = null;
  private authState: AuthState = "unknown";
  private authReason = "";
  private readonly authListeners = new Set<
    (s: AuthState, reason: string) => void
  >();

  constructor(private readonly url: string) {}

  getState(): ConnectionState {
    return this.state;
  }

  onStateChange(listener: (s: ConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  getAuthState(): { state: AuthState; reason: string } {
    return { state: this.authState, reason: this.authReason };
  }

  onAuthChange(listener: (s: AuthState, reason: string) => void): () => void {
    this.authListeners.add(listener);
    return () => this.authListeners.delete(listener);
  }

  private setAuthState(next: AuthState, reason = ""): void {
    if (this.authState === next && this.authReason === reason) {
      return;
    }
    this.authState = next;
    this.authReason = reason;
    for (const listener of this.authListeners) {
      listener(next, reason);
    }
  }

  /**
   * Resolve once the relay has ruled on this key, or when the wait runs out.
   *
   * Resolving with "unknown" on timeout rather than rejecting is deliberate:
   * a caller waiting on a verdict wants to know that none arrived, which is
   * different information from an error.
   */
  waitForAuth(
    timeoutMs = 8_000,
  ): Promise<{ state: AuthState; reason: string }> {
    if (this.authState !== "unknown") {
      return Promise.resolve(this.getAuthState());
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        unsubscribe();
        resolve(this.getAuthState());
      }, timeoutMs);
      const unsubscribe = this.onAuthChange((state, reason) => {
        if (state === "unknown") {
          return;
        }
        clearTimeout(timer);
        unsubscribe();
        resolve({ state, reason });
      });
    });
  }

  /**
   * Drop the connection and authenticate again from scratch.
   *
   * Needed after joining the community: the relay decided "not a member" for
   * this key on the current socket and will not revisit that on its own. A
   * fresh NIP-42 handshake is what makes a brand-new member's session work
   * without asking them to reload the page.
   */
  reconnect(): void {
    this.setAuthState("unknown");
    this.attempt = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      // Drop our handlers first so this teardown does not schedule its own
      // reconnect and race the one we are about to start.
      ws.onclose = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onopen = null;
      ws.close();
    }
    this.closedByUs = false;
    this.open();
  }

  private setState(next: ConnectionState): void {
    if (this.state === next) {
      return;
    }
    this.state = next;
    for (const listener of this.stateListeners) {
      listener(next);
    }
  }

  connect(): void {
    if (this.ws || this.reconnectTimer) {
      return;
    }
    this.closedByUs = false;
    this.open();
  }

  private open(): void {
    this.setState("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.authed = false;
      this.authEventId = null;
      this.setState("authenticating");
      // Do NOT subscribe yet. A Buzz relay answers an early REQ with
      // "auth-required: authenticate before subscribing" and CLOSES the
      // subscription, which looks exactly like an empty community. Wait for
      // the AUTH challenge. Relays that never challenge get a short grace
      // period and are then treated as open.
      this.openGraceTimer = setTimeout(() => {
        this.openGraceTimer = null;
        if (!this.authed) {
          this.authed = true;
          // A relay that never challenges is open, so everyone is "a member"
          // as far as this signal is concerned.
          this.setAuthState("accepted");
          this.resendAll();
        }
      }, 1_000);
    };

    ws.onmessage = (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(String(raw.data));
      } catch {
        return;
      }
      if (!Array.isArray(msg)) {
        return;
      }
      void this.handleMessage(msg as unknown[]);
    };

    ws.onerror = () => {
      // onclose always follows, so let that path own reconnection.
    };

    ws.onclose = () => {
      this.ws = null;
      this.authed = false;
      this.authEventId = null;
      if (this.closedByUs) {
        this.setState("offline");
        return;
      }
      this.setState("offline");
      this.scheduleReconnect();
    };
  }

  private async handleMessage(msg: unknown[]): Promise<void> {
    const type = msg[0];

    if (type === "AUTH" && typeof msg[1] === "string") {
      try {
        const unsigned = makeAuthEvent(this.url, msg[1]);
        const signed = await signNostrEvent(unsigned);
        this.authEventId = signed.id;
        this.send(["AUTH", signed]);
      } catch {
        // Without a usable signer we stay unauthenticated. Reads on a relay
        // that demands auth will be CLOSED, which surfaces to the caller
        // rather than hanging.
      }
      return;
    }

    if (type === "OK" && typeof msg[1] === "string") {
      if (msg[1] === this.authEventId) {
        if (this.openGraceTimer) {
          clearTimeout(this.openGraceTimer);
          this.openGraceTimer = null;
        }
        if (msg[2] === true) {
          this.authed = true;
          this.setAuthState("accepted");
          this.resendAll();
        } else {
          // The relay knows exactly who we are and is saying no. Report the
          // reason verbatim ("restricted: not a relay member") so the UI can
          // offer the fix instead of spinning.
          this.setAuthState("denied", String(msg[3] ?? "not authorised"));
        }
      }
      return;
    }

    if (type === "EVENT" && typeof msg[1] === "string") {
      const sub = this.subs.get(msg[1]);
      sub?.handlers.onEvent(msg[2] as NostrEvent);
      // The first event proves the relay is answering us, which for an
      // auth-required relay also proves auth succeeded.
      this.setState("ready");
      return;
    }

    if (type === "EOSE" && typeof msg[1] === "string") {
      this.setState("ready");
      this.subs.get(msg[1])?.handlers.onEose?.();
      return;
    }

    if (type === "NOTICE") {
      return;
    }

    if (type === "CLOSED" && typeof msg[1] === "string") {
      this.subs.get(msg[1])?.handlers.onClosed?.(String(msg[2] ?? ""));
      return;
    }
  }

  private send(payload: unknown[]): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private resendAll(): void {
    for (const sub of this.subs.values()) {
      this.send(["REQ", sub.id, ...sub.filters]);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closedByUs) {
      return;
    }
    // Exponential backoff with jitter, so a relay restart does not get a
    // thundering herd from every open tab at the same instant.
    const base = Math.min(
      RECONNECT_BASE_MS * 2 ** this.attempt,
      RECONNECT_MAX_MS,
    );
    const delay = base / 2 + Math.random() * (base / 2);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  /**
   * Start a live subscription. Returns an unsubscribe function.
   *
   * Events keep arriving after EOSE; that is the difference from `queryEvents`.
   */
  subscribe(
    filters: NostrFilter[],
    handlers: SubscriptionHandlers,
  ): () => void {
    const id = `s${this.nextId++}`;
    this.subs.set(id, { id, filters, handlers });
    this.connect();
    if (this.authed) {
      this.send(["REQ", id, ...filters]);
    }
    return () => {
      this.subs.delete(id);
      this.send(["CLOSE", id]);
    };
  }

  /**
   * One-shot query on the live connection: stored events until EOSE.
   *
   * Search and other on-demand reads want an answer, not a subscription; this
   * keeps them off queryEvents' one-socket-per-call path and inside the
   * already-authenticated connection, which matters because this relay
   * refuses REQs from unauthenticated sockets.
   */
  queryOnce(filters: NostrFilter[], timeoutMs = 10_000): Promise<NostrEvent[]> {
    return new Promise((resolve) => {
      const events: NostrEvent[] = [];
      const timer = setTimeout(() => {
        unsubscribe();
        resolve(events);
      }, timeoutMs);
      const unsubscribe = this.subscribe(filters, {
        onEvent: (event) => events.push(event),
        onEose: () => {
          clearTimeout(timer);
          unsubscribe();
          resolve(events);
        },
        onClosed: () => {
          clearTimeout(timer);
          unsubscribe();
          resolve(events);
        },
      });
    });
  }

  /** Publish a signed event. Resolves with the relay's OK verdict. */
  publish(event: NostrEvent): Promise<{ accepted: boolean; reason: string }> {
    return new Promise((resolve) => {
      const ws = this.ws;
      if (ws?.readyState !== WebSocket.OPEN) {
        resolve({ accepted: false, reason: "not connected" });
        return;
      }
      const timer = setTimeout(() => {
        ws.removeEventListener("message", onMessage);
        resolve({ accepted: false, reason: "timed out waiting for OK" });
      }, 10_000);

      const onMessage = (raw: MessageEvent) => {
        let msg: unknown;
        try {
          msg = JSON.parse(String(raw.data));
        } catch {
          return;
        }
        if (Array.isArray(msg) && msg[0] === "OK" && msg[1] === event.id) {
          clearTimeout(timer);
          ws.removeEventListener("message", onMessage);
          resolve({ accepted: Boolean(msg[2]), reason: String(msg[3] ?? "") });
        }
      };

      ws.addEventListener("message", onMessage);
      this.send(["EVENT", event]);
    });
  }

  close(): void {
    this.closedByUs = true;
    // Drop the verdict with the connection. Keeping "accepted" here would let
    // the NEXT identity inherit the last one's approval and be waved through
    // before the relay has ever seen it.
    this.setAuthState("unknown");
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.subs.clear();
    this.ws?.close();
    this.ws = null;
    this.setState("offline");
  }
}

const sockets = new Map<string, NostrSocket>();

/** One shared socket per relay URL, so every hook reuses the same connection. */
export function getSocket(url: string): NostrSocket {
  let socket = sockets.get(url);
  if (!socket) {
    socket = new NostrSocket(url);
    sockets.set(url, socket);
  }
  return socket;
}
