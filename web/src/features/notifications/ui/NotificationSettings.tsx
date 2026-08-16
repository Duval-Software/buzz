import { useEffect, useState } from "react";
import {
  currentPushStatus,
  disablePush,
  enablePush,
  needsHomeScreenInstall,
  type PushStatus,
} from "@/features/notifications/push-client";

/**
 * Turning notifications on and off.
 *
 * Only ever from a real click: browsers refuse the permission prompt otherwise,
 * and asking on page load is the fastest way to get permanently blocked by
 * someone who was not ready to answer.
 *
 * What arrives is mentions and direct messages, matching what the desktop app
 * notifies on. Every message in every channel would be unusable on a phone.
 */
export function NotificationSettings() {
  const [status, setStatus] = useState<PushStatus | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const installFirst = needsHomeScreenInstall();

  useEffect(() => {
    let live = true;
    currentPushStatus().then((next) => {
      if (live) {
        setStatus(next);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      if (status === "on") {
        await disablePush();
        setStatus("off");
      } else {
        await enablePush();
        setStatus("on");
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not change this.",
      );
      setStatus(await currentPushStatus());
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading") {
    return null;
  }

  return (
    <div className="mt-5 border-neutral-800 border-t pt-4">
      <span className="font-medium text-neutral-200 text-sm">
        Notifications
      </span>
      <p className="mt-1 text-neutral-500 text-xs">
        When someone mentions you in a channel. Not every message, and not
        direct messages: those are encrypted so that only your own devices can
        see one arrived.
      </p>

      {status === "unsupported" ? (
        <p className="mt-2 text-neutral-500 text-xs">
          This browser cannot do push notifications.
        </p>
      ) : status === "denied" ? (
        <p className="mt-2 text-neutral-500 text-xs">
          Notifications are blocked for this site. Your browser's site settings
          are the only place that can undo that.
        </p>
      ) : (
        <>
          {installFirst ? (
            <p className="mt-2 rounded-lg border border-neutral-800 p-2 text-neutral-400 text-xs">
              On iPhone and iPad: tap Share, then <b>Add to Home Screen</b>, and
              open the app from there. Safari only allows notifications for
              installed web apps.
            </p>
          ) : null}
          <button
            type="button"
            onClick={toggle}
            disabled={busy || installFirst}
            className={
              status === "on"
                ? "mt-2 rounded-lg border border-neutral-700 px-3 py-1.5 text-neutral-300 text-sm disabled:opacity-50"
                : "mt-2 rounded-lg bg-amber-500 px-3 py-1.5 font-semibold text-neutral-950 text-sm disabled:opacity-50"
            }
          >
            {busy
              ? "…"
              : status === "on"
                ? "Turn off notifications"
                : "Turn on notifications"}
          </button>
        </>
      )}

      {error ? (
        <p className="mt-2 text-red-400 text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
