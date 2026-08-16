import { createFileRoute } from "@tanstack/react-router";
import { CommunityGate } from "@/features/identity/ui/CommunityGate";
import { InboxPage } from "@/features/inbox/ui/InboxPage";

export const Route = createFileRoute("/inbox")({
  component: () => (
    <CommunityGate>
      <InboxPage />
    </CommunityGate>
  ),
});
