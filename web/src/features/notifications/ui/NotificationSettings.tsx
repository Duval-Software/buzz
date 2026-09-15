import { useEffect, useState } from "react";
import {
  currentPushStatus,
  disablePush,
  enablePush,
  type PushStatus,
} from "@/features/notifications/push-client";

/**
 * Turning notifications on and off.
 *
 * Only ever from a real click: browsers refuse the permission prompt otherwise,
 * and asking on page load is the fastest way to get permanently blocked by
 * someone who was not ready to answer.
 *
 * Only channel mentions are supported by the shared push service.
 */
export function NotificationSettings() {
  const [status, setStatus] = useState<PushStatus | "loading" | "error">(
    "loading",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry checks browser subscription state again.
  useEffect(() => {
    let live = true;
    setError(null);
    setStatus("loading");
    currentPushStatus()
      .then((next) => {
        if (live) {
          setStatus(next);
        }
      })
      .catch(() => {
        if (live) {
          setStatus("error");
          setError("Could not check notifications. Try again.");
        }
      });
    return () => {
      live = false;
    };
  }, [retry]);

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
      setStatus(await currentPushStatus().catch(() => "error" as const));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 border-neutral-800 border-t pt-4">
      <span className="font-medium text-neutral-200 text-sm">
        Notifications
      </span>
      <p className="mt-1 text-neutral-500 text-xs">
        Alerts for channel mentions on this device. Direct-message push alerts
        aren’t available yet; your encrypted conversations stay private.
      </p>

      {status === "loading" ? (
        <p className="mt-2 text-neutral-500 text-xs" role="status">
          Checking notifications…
        </p>
      ) : status === "error" ? (
        <button
          type="button"
          className="mt-2 text-sm"
          onClick={() => setRetry((n) => n + 1)}
        >
          Retry
        </button>
      ) : status === "unconfigured" ? (
        <p className="mt-2 text-neutral-500 text-xs">
          Notifications aren’t available in this community yet.
        </p>
      ) : status === "install" ? (
        <p className="mt-2 text-neutral-500 text-xs">
          On iPhone and iPad, tap Share, then <b>Add to Home Screen</b>. Open
          CreatorHive from there to enable notifications.
        </p>
      ) : status === "unsupported" ? (
        <p className="mt-2 text-neutral-500 text-xs">
          This browser cannot do push notifications.
        </p>
      ) : status === "denied" ? (
        <p className="mt-2 text-neutral-500 text-xs">
          Notifications are blocked for this site. Your browser's site settings
          are the only place that can undo that.
        </p>
      ) : (
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          className={
            status === "on"
              ? "mt-2 rounded-lg border border-neutral-700 px-3 py-1.5 text-neutral-300 text-sm disabled:opacity-50"
              : "mt-2 rounded-lg bg-amber-500 px-3 py-1.5 font-semibold text-neutral-950 text-sm disabled:opacity-50"
          }
        >
          {busy
            ? "Updating…"
            : status === "on"
              ? "Turn off notifications"
              : "Turn on notifications"}
        </button>
      )}

      {error ? (
        <p className="mt-2 text-red-400 text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
