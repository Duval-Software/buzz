import type { PresenceStatus } from "@/features/chat/use-presence";
import { cn } from "@/shared/lib/cn";

/**
 * The little dot beside a name.
 *
 * Offline renders nothing rather than a grey dot. Most people in a busy
 * channel's history are not online, and a column of grey dots is noise that
 * makes the two colours that matter harder to spot.
 */
export function PresenceDot({ status }: { status: PresenceStatus }) {
  if (status === "offline") {
    return null;
  }
  const online = status === "online";
  return (
    <span
      // Colour alone should not carry the meaning, so the label says it too.
      // role="img" is what makes the label valid on a decorative span: without
      // a role there is nothing for a screen reader to attach the name to.
      role="img"
      title={online ? "Online" : "Away"}
      aria-label={online ? "Online" : "Away"}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        online ? "bg-emerald-500" : "bg-amber-500",
      )}
    />
  );
}
