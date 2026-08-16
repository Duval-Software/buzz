/*
 * Service worker: the only part of this app that runs when the tab is closed.
 *
 * That is the whole reason it exists. The desktop app can notify because it is
 * always running with a live relay socket; a browser tab that has been closed
 * has no socket and no JavaScript. Web Push is the only mechanism that reaches
 * a closed browser, and it can only be received here.
 *
 * Deliberately NOT doing offline caching yet. A half-considered cache strategy
 * on a chat app serves stale conversations and is harder to debug than no cache
 * at all. The fetch handler below is a pass-through; caching can come later as
 * its own piece of work.
 */

self.addEventListener("install", () => {
  // Take over without waiting for every old tab to close, so a fixed worker
  // ships on the next visit rather than whenever someone quits their browser.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Pass through to the network. Present because an installable PWA is
  // expected to have a fetch handler, not because it does anything yet.
});

/**
 * A push arrived.
 *
 * The payload is encrypted end to end between our push service and this
 * browser (RFC 8291) — the push provider relaying it cannot read it. Even so
 * the sender keeps bodies short and does not include anything that would be
 * damaging on a lock screen.
 */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "CreatorHive";
  const options = {
    body: payload.body || "New activity in the Hive",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    // Collapse repeat notifications for one channel instead of stacking a
    // dozen of them on the lock screen.
    tag: payload.tag || "hive",
    renotify: true,
    data: { url: payload.url || "/chat" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/** Tapping the notification should land in the app, not a second copy of it. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    event.notification.data?.url || "/chat",
    self.location.origin,
  ).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          // Already open somewhere: focus that window rather than opening a
          // duplicate, which on a phone means two copies of the app.
          if (
            client.url.startsWith(self.location.origin) &&
            "focus" in client
          ) {
            client.navigate(target);
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      }),
  );
});
