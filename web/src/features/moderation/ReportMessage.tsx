import { useState } from "react";
import { CommunityDialog } from "@/features/surfaces/ui/CommunityDialog";
import { signNostrEvent } from "@/shared/lib/nostr-signer";
import { getSocket } from "@/shared/lib/nostr-socket";
import { relayWsUrl } from "@/shared/lib/relay-url";
import "./moderation.css";

/** Reports exactly one selected message, including in private conversations. */
export function ReportMessage({
  id,
  author,
  content,
}: {
  id: string;
  author: string;
  content: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="Report message"
        disabled={sent}
        onClick={() => setOpen(true)}
        className="rounded px-1.5 text-neutral-400 text-xs hover:bg-neutral-800"
      >
        {sent ? "reported" : "report"}
      </button>
      {open && (
        <CommunityDialog
          label="Report message"
          busy={busy}
          onClose={() => setOpen(false)}
        >
          <form
            className="staff-confirm"
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              setBusy(true);
              setError("");
              try {
                const report = await signNostrEvent({
                  kind: 1984,
                  content: reason.trim(),
                  tags: [
                    ["e", id, "other"],
                    ["p", author],
                  ],
                });
                const result = await getSocket(relayWsUrl()).publish(report);
                if (!result.accepted)
                  throw new Error(
                    result.reason || "Could not submit the report.",
                  );
                setSent(true);
                setOpen(false);
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Could not submit the report.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>Only this message will be shared with the moderation team.</p>
            <blockquote className="staff-text">
              {content.slice(0, 1000)}
            </blockquote>
            <label>
              What happened?
              <textarea
                required
                minLength={3}
                maxLength={1800}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <button type="submit" disabled={busy || reason.trim().length < 3}>
              {busy ? "Sending…" : "Send report"}
            </button>
          </form>
        </CommunityDialog>
      )}
    </>
  );
}
