import { createFileRoute } from "@tanstack/react-router";
import { CommunityGate } from "@/features/identity/ui/CommunityGate";
import { OnboardingPage } from "@/features/onboarding/OnboardingPage";

export const Route = createFileRoute("/onboarding")({
  component: () => (
    <CommunityGate>
      <OnboardingPage />
    </CommunityGate>
  ),
});
