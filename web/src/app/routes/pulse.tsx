import { createFileRoute } from "@tanstack/react-router";
import { CommunityGate } from "@/features/identity/ui/CommunityGate";
import { PulsePage } from "@/features/pulse/ui/PulsePage";

export const Route = createFileRoute("/pulse")({
  validateSearch: (search: Record<string, unknown>): { update?: string } => ({
    update:
      typeof search.update === "string" && /^[a-f0-9]{64}$/i.test(search.update)
        ? search.update.toLowerCase()
        : undefined,
  }),
  component: () => (
    <CommunityGate>
      <PulsePage />
    </CommunityGate>
  ),
});
