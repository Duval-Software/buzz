import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * The frame every non-chat surface lives in.
 *
 * One slim header: a way back to chat, the surface's name, and an optional
 * action slot. The body scrolls; the header does not. Deliberately no channel
 * sidebar here — these surfaces are community-wide, and duplicating the chat
 * chrome would mean maintaining it twice.
 */
export function SurfaceShell({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-dvh flex-col bg-neutral-950 text-neutral-200">
      <header className="flex items-center gap-3 border-neutral-800 border-b px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <Link
          to="/chat"
          className="shrink-0 rounded-lg border border-neutral-700 px-2.5 py-1.5 text-neutral-300 text-sm hover:border-neutral-500"
        >
          ← Chat
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold text-base">{title}</h1>
          {subtitle ? (
            <p className="truncate text-neutral-500 text-xs">{subtitle}</p>
          ) : null}
        </div>
        {action}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
