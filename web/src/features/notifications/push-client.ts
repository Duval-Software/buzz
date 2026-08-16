/**
 * Web Push: the only way to reach someone whose tab is closed.
 *
 * The desktop app notifies by keeping a relay socket open all day. A browser
 * cannot do that — close the tab and there is no socket and no JavaScript. So
 * notifications work completely differently here, and pretending otherwise is
 * how a chat app ends up silent on phones.
 *
 * The shape:
 *
 *   browser  -> asks its push provider for an endpoint (this file)
 *            -> registers that endpoint with hivepush, signed with NIP-98
 *   hivepush -> watches the relay for events that mention a registered member
 *            -> sends an encrypted push to their endpoint
 *   sw.js    -> receives it and shows the notification
 *
 * Channel mentions only. Direct messages are gift wraps, and the relay serves
 * those solely to the pubkey they are addressed to, so a shared push service
 * cannot be told one arrived without holding that person's key. The desktop
 * app manages DM alerts only because it IS the recipient.
 *
 * Payloads are encrypted end to end (RFC 8291) with keys the push provider
 * does not have, so Apple and Google relay the bytes without being able to
 * read them. The sender still keeps bodies brief: a lock screen is a public
 * place.
 *
 * iOS caveat worth knowing: Safari only allows push for a web app that has
 * been added to the Home Screen. In a normal iOS browser tab, subscribing is
 * simply unavailable, which is why `pushSupported()` is checked before any of
 * this is offered.
 */

import { makeNip98AuthHeader } from "@/shared/lib/nip98";

/** Where hivepush lives. Same origin in production, so no CORS involved. */
function pushBaseUrl(): string {
  const configured = import.meta.env.VITE_PUSH_URL;
  return configured ? String(configured).replace(/\/$/, "") : "";
}

/** The VAPID public key this deployment's push service signs with. */
function vapidPublicKey(): string | null {
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  return key ? String(key) : null;
}

/** Whether this browser can do push at all. */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    vapidPublicKey() !== null
  );
}

/** Whether the app was launched from the Home Screen / as an installed app. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const iosStandalone = (
    window.navigator as Navigator & { standalone?: boolean }
  ).standalone;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    iosStandalone === true
  );
}

/** iOS refuses push in a plain browser tab; it must be added to the Home Screen. */
export function needsHomeScreenInstall(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  const ua = navigator.userAgent;
  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS reports itself as a Mac; the touch points give it away.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return isIos && !isStandalone();
}

/**
 * VAPID keys travel as base64url; PushManager wants raw bytes.
 *
 * Built on an explicit ArrayBuffer because `applicationServerKey` requires a
 * view over one specifically, and a plain Uint8Array is typed as possibly
 * backed by a SharedArrayBuffer.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) {
    return null;
  }
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

export type PushStatus = "unsupported" | "denied" | "off" | "on";

export async function currentPushStatus(): Promise<PushStatus> {
  if (!pushSupported()) {
    return "unsupported";
  }
  if (Notification.permission === "denied") {
    return "denied";
  }
  const registration = await navigator.serviceWorker.getRegistration("/");
  const existing = await registration?.pushManager.getSubscription();
  return existing ? "on" : "off";
}

async function postSigned(path: string, body: unknown): Promise<void> {
  const url = `${pushBaseUrl()}${path}`;
  const payload = JSON.stringify(body);
  const absolute = new URL(url, window.location.origin).href;
  const response = await fetch(url, {
    method: "POST",
    body: payload,
    headers: {
      "Content-Type": "application/json",
      // Signed over the absolute URL, because that is what the server
      // reconstructs and compares against.
      Authorization: await makeNip98AuthHeader(absolute, "POST", {
        body: payload,
      }),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text.slice(0, 200) || `HTTP ${response.status}`);
  }
}

/**
 * Turn notifications on: permission, subscription, then registration.
 *
 * Throws with a message meant for a person. The permission prompt only ever
 * appears from a real click, which is why this is not called on load.
 */
export async function enablePush(): Promise<void> {
  const vapid = vapidPublicKey();
  if (!vapid) {
    throw new Error("Notifications are not configured for this deployment.");
  }
  if (needsHomeScreenInstall()) {
    throw new Error(
      "On iPhone and iPad, add this app to your Home Screen first — Safari only allows notifications for installed web apps.",
    );
  }

  const registration =
    (await navigator.serviceWorker.getRegistration("/")) ??
    (await registerServiceWorker());
  if (!registration) {
    throw new Error("This browser would not start the notification worker.");
  }
  await navigator.serviceWorker.ready;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      "Notifications are blocked for this site. You can turn them back on in your browser's site settings.",
    );
  }

  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      // Required to be true by every browser: we may not send silent pushes.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid),
    }));

  await postSigned("/push/subscribe", subscription.toJSON());
}

/** Turn notifications off here and stop the server sending to this device. */
export async function disablePush(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) {
    return;
  }
  // Tell the server first. If unsubscribing locally succeeded but the server
  // still had the endpoint, it would keep sending into the void until a push
  // provider finally reported the subscription as gone.
  await postSigned("/push/unsubscribe", { endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}
