import { createFileRoute } from "@tanstack/react-router";
import { CommunityGate } from "@/features/identity/ui/CommunityGate";
import { PulsePage } from "@/features/pulse/ui/PulsePage";

export const Route = createFileRoute("/pulse")({
  component: () => (
    <CommunityGate>
      <PulsePage />
    </CommunityGate>
  ),
});
