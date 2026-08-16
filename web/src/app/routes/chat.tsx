import { createFileRoute } from "@tanstack/react-router";
import { ChatPage } from "@/features/chat/ui/ChatPage";
import { CommunityGate } from "@/features/identity/ui/CommunityGate";

export const Route = createFileRoute("/chat")({
  // Deep links: ?channel= opens a channel (inbox and agents jump here),
  // ?room= opens a live video room (go-live announcements).
  validateSearch: (
    search: Record<string, unknown>,
  ): { channel?: string; room?: string } => ({
    channel: typeof search.channel === "string" ? search.channel : undefined,
    room: typeof search.room === "string" ? search.room : undefined,
  }),
  // The gate renders the front door for anyone the relay has not accepted, so
  // ChatPage only ever mounts for an actual member and never has to render a
  // community it is not allowed to read.
  component: () => (
    <CommunityGate>
      <ChatPage />
    </CommunityGate>
  ),
});
