import { createFileRoute } from "@tanstack/react-router";
import { ChatPage } from "@/features/chat/ui/ChatPage";
import { CommunityGate } from "@/features/identity/ui/CommunityGate";

export const Route = createFileRoute("/chat")({
  // The gate renders the front door for anyone the relay has not accepted, so
  // ChatPage only ever mounts for an actual member and never has to render a
  // community it is not allowed to read.
  component: () => (
    <CommunityGate>
      <ChatPage />
    </CommunityGate>
  ),
});
