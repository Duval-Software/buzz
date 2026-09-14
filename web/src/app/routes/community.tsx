import { createFileRoute } from "@tanstack/react-router";
import { CommunityGate } from "@/features/identity/ui/CommunityGate";
import { CommunityPage } from "@/features/community/CommunityPage";
export const Route = createFileRoute("/community")({
  component: () => (
    <CommunityGate>
      <CommunityPage />
    </CommunityGate>
  ),
});
