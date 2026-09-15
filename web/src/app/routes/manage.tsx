import { createFileRoute } from "@tanstack/react-router";
import { CommunityGate } from "@/features/identity/ui/CommunityGate";
import { ModerationPage } from "@/features/moderation/ModerationPage";
export const Route = createFileRoute("/manage")({
  component: () => (
    <CommunityGate>
      <ModerationPage />
    </CommunityGate>
  ),
});
