import { Monitor, FileText } from "lucide-react";
import { CommunityDialog } from "@/features/surfaces/ui/CommunityDialog";
import { useNavigate } from "@tanstack/react-router";
import { loginAccount, registerAccount } from "@/features/identity/accounts";
import { CredentialForm } from "@/features/identity/ui/CredentialForm";
import { useMembership } from "@/features/identity/use-identity";
import { HiveBrand } from "@/features/surfaces/ui/SurfacesNav";
import { claimInviteInBrowser } from "@/features/invite/invite-api";
import {
  BUZZ_RELEASES_URL,
  type BuzzDownloadPlatform,
  detectBuzzDownloadPlatform,
  resolveBuzzDownloadUrlForPlatform,
} from "@/shared/lib/buzz-download";
import { relayHttpBaseUrl, relayWsUrl } from "@/shared/lib/relay-url";
import { Button } from "@/shared/ui/button";
import * as React from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { InviteJoinPolicyNotice } from "./InviteJoinPolicyNotice";

type JoinPolicy = {
  terms_markdown?: string;
  privacy_markdown?: string;
  age_attestation_required: boolean;
  version: string;
};

type PolicyDocument = { title: string; markdown: string };

/** Convert relay invite sentinels into user-facing recovery guidance. */
function inviteClaimErrorMessage(message: string): string {
  if (message.includes("invite_exhausted")) {
    return "This invite has reached its use limit. Ask for a new invite.";
  }
  if (message.includes("invite_expired")) {
    return "This invite has expired. Ask for a new invite.";
  }
  if (message.includes("invite_invalid")) {
    return "This invite is invalid. Check the link or ask for a new invite.";
  }
  return message;
}

/** Landing page for a community invite link (`/invite/<code>`). */
export function InvitePage({ code }: { code: string }) {
  const navigate = useNavigate();
  const { identity, signOut, recheck } = useMembership();
  const [mode, setMode] = React.useState<"login" | "register">("register");
  const [policyError, setPolicyError] = React.useState(false);
  const relay = relayWsUrl();
  const host = relay.replace(/^wss?:\/\//, "");
  const [policy, setPolicy] = React.useState<JoinPolicy | null | undefined>(
    undefined,
  );
  const [document, setDocument] = React.useState<PolicyDocument | null>(null);
  const [ageConfirmed, setAgeConfirmed] = React.useState(false);
  const [agreementConfirmed, setAgreementConfirmed] = React.useState(false);
  const [opening, setOpening] = React.useState(false);
  const [joiningBrowser, setJoiningBrowser] = React.useState(false);
  const [browserJoinError, setBrowserJoinError] = React.useState<string | null>(
    null,
  );
  const [downloadUrl, setDownloadUrl] = React.useState(BUZZ_RELEASES_URL);
  const [needsMacChoice, setNeedsMacChoice] = React.useState(false);
  const [showMacChoice, setShowMacChoice] = React.useState(false);
  const [choosingMacDownload, setChoosingMacDownload] = React.useState(false);
  const choosingMacDownloadRef = React.useRef(false);
  const downloadTriggerRef = React.useRef<HTMLAnchorElement>(null);

  React.useEffect(() => {
    let active = true;
    detectBuzzDownloadPlatform(navigator).then(async (platform) => {
      if (!active) return;
      if (
        platform.operatingSystem === "macos" &&
        platform.architecture === "unknown"
      ) {
        setNeedsMacChoice(true);
        return;
      }
      const url = await resolveBuzzDownloadUrlForPlatform(platform);
      if (active) setDownloadUrl(url);
    });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    fetch(`${relayHttpBaseUrl()}/api/join-policy`, {
      signal: AbortSignal.timeout(15_000),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const config = (await response.json()) as { policy?: JoinPolicy };
        setPolicy(config.policy ?? null);
      })
      .catch(() => setPolicyError(true));
  }, []);

  const acceptPolicy = async (): Promise<string | undefined> => {
    if (!policy) return undefined;
    const response = await fetch(
      `${relayHttpBaseUrl()}/api/invites/accept-policy`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          code,
          policy_version: policy.version,
          age_confirmed: ageConfirmed,
        }),
      },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return ((await response.json()) as { receipt: string }).receipt;
  };

  const openInvite = async () => {
    setOpening(true);
    setBrowserJoinError(null);
    try {
      const receipt = await acceptPolicy();
      const query = new URLSearchParams({ relay, code });
      if (receipt) query.set("policy_receipt", receipt);
      window.location.href = `buzz://join?${query.toString()}`;
    } catch (error) {
      setBrowserJoinError(
        inviteClaimErrorMessage(
          error instanceof Error
            ? error.message
            : "Could not open this invite.",
        ),
      );
    } finally {
      setOpening(false);
    }
  };

  const joinInBrowser = async () => {
    setBrowserJoinError(null);
    setJoiningBrowser(true);
    try {
      const receipt = await acceptPolicy();
      await claimInviteInBrowser(code, receipt);
      recheck();
      // Keep the unlocked account in memory across the route transition.
      await navigate({ to: "/chat" });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not claim this invite.";
      setBrowserJoinError(inviteClaimErrorMessage(message));
    } finally {
      setJoiningBrowser(false);
    }
  };

  const browserSigningAvailable = !!identity;
  const disabled =
    policy === undefined ||
    opening ||
    joiningBrowser ||
    Boolean(policy?.age_attestation_required && !ageConfirmed) ||
    Boolean(
      policy &&
        (policy.terms_markdown || policy.privacy_markdown) &&
        !agreementConfirmed,
    );
  const hasPolicyRequirements = Boolean(
    policy &&
      (policy.age_attestation_required ||
        policy.terms_markdown ||
        policy.privacy_markdown),
  );
  const showDocument = (title: string, markdown: string) =>
    setDocument({ title, markdown });
  const closeMacChoice = React.useCallback(() => {
    setShowMacChoice(false);
  }, []);
  const chooseMacDownload = async (
    event: React.MouseEvent<HTMLAnchorElement>,
    platform: BuzzDownloadPlatform,
  ) => {
    event.preventDefault();
    if (choosingMacDownloadRef.current) return;
    choosingMacDownloadRef.current = true;
    setChoosingMacDownload(true);
    const downloadWindow = window.open("about:blank", "_blank");
    if (downloadWindow) downloadWindow.opener = null;
    setShowMacChoice(false);
    try {
      const url = await resolveBuzzDownloadUrlForPlatform(platform);
      downloadWindow?.location.replace(url);
    } finally {
      choosingMacDownloadRef.current = false;
      setChoosingMacDownload(false);
    }
  };

  return (
    <div className="hive-app hive-entry">
      <div className="space-y-4">
        <div className="w-full">
          <HiveBrand />
          <p className="hive-entry-kicker">An invitation to build together</p>
          <h1>You’re invited to CreatorHive</h1>
          <p className="break-all text-sm text-neutral-400">{host}</p>
          {identity ? (
            <div className="mt-6 space-y-2">
              <p>
                {identity.username
                  ? `Signed in as @${identity.username}`
                  : "Using your existing community profile"}
              </p>
              <button
                className="hive-entry-switch"
                disabled={joiningBrowser}
                type="button"
                onClick={async () => {
                  try {
                    await signOut();
                  } catch (error) {
                    setBrowserJoinError(
                      error instanceof Error
                        ? error.message
                        : "Could not sign out.",
                    );
                  }
                }}
              >
                Sign in to a different account
              </button>
            </div>
          ) : (
            <>
              <p className="mt-3 text-sm text-neutral-400">
                Create an account or sign in, then accept your invitation.
              </p>
              <CredentialForm
                key={mode}
                mode={mode}
                onSubmit={async (name, password) => {
                  if (mode === "register")
                    await registerAccount(name, password);
                  else await loginAccount(name, password);
                }}
              />
              <button
                type="button"
                className="hive-entry-switch"
                onClick={() =>
                  setMode(mode === "register" ? "login" : "register")
                }
              >
                {mode === "register"
                  ? "Already a member? Sign in"
                  : "New here? Create an account"}
              </button>
            </>
          )}
          {policyError && (
            <p role="alert" className="mt-4 text-sm text-red-300">
              Could not load this community’s join requirements. Reopen your
              invite to try again.
            </p>
          )}

          <div
            className={`grid w-full max-w-md overflow-hidden transition-[grid-template-rows,margin,opacity,transform] duration-[220ms] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${
              hasPolicyRequirements
                ? "mt-9 -mb-4 grid-rows-[1fr] opacity-100 translate-y-0"
                : "m-0 grid-rows-[0fr] opacity-0 -translate-y-1"
            }`}
          >
            <div className="min-h-0 overflow-hidden">
              {policy && hasPolicyRequirements ? (
                <InviteJoinPolicyNotice
                  ageConfirmed={ageConfirmed}
                  agreementConfirmed={agreementConfirmed}
                  onAgeConfirmedChange={setAgeConfirmed}
                  onAgreementConfirmedChange={setAgreementConfirmed}
                  onShowDocument={showDocument}
                  policy={policy}
                />
              ) : null}
            </div>
          </div>

          <div className="mt-9 w-full max-w-md space-y-2">
            {browserSigningAvailable ? (
              <Button
                className="hive-primary-button w-full"
                disabled={disabled}
                onClick={joinInBrowser}
              >
                {joiningBrowser ? "Joining…" : "Join in browser"}
              </Button>
            ) : null}
            {policy === null ? (
              <Button
                asChild
                className="h-10 w-full border border-neutral-600 bg-neutral-900 text-neutral-200 hover:bg-neutral-800"
              >
                <a
                  href={`buzz://join?relay=${encodeURIComponent(relay)}&code=${encodeURIComponent(code)}`}
                >
                  Accept invite in Buzz
                </a>
              </Button>
            ) : (
              <Button
                className="h-10 w-full border border-neutral-600 bg-neutral-900 text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={disabled}
                onClick={openInvite}
              >
                Accept invite in Buzz
              </Button>
            )}
            {browserJoinError ? (
              <p className="text-sm text-red-300" role="alert">
                {browserJoinError}
              </p>
            ) : null}
          </div>
        </div>
        <p className="flex flex-wrap items-center justify-center gap-y-1 py-4 text-sm text-neutral-400">
          Don&apos;t have the app?{" "}
          <a
            aria-expanded={needsMacChoice ? showMacChoice : undefined}
            aria-haspopup={needsMacChoice ? "dialog" : undefined}
            className="ml-1 font-medium text-neutral-200 underline-offset-4 hover:text-white hover:underline focus-visible:underline"
            href={downloadUrl}
            ref={downloadTriggerRef}
            rel="noreferrer"
            target="_blank"
            onClick={(event) => {
              if (!needsMacChoice) return;
              event.preventDefault();
              setShowMacChoice(true);
            }}
          >
            Download it now
          </a>
        </p>
      </div>

      {showMacChoice && (
        <CommunityDialog
          label="Which Mac do you have?"
          description="Choose the download for your Mac."
          icon={Monitor}
          onClose={closeMacChoice}
        >
          <div>
            <div className="grid gap-3">
              <a
                aria-disabled={choosingMacDownload}
                className="hive-dialog-option aria-disabled:pointer-events-none aria-disabled:opacity-50"
                href={BUZZ_RELEASES_URL}
                onClick={(event) =>
                  void chooseMacDownload(event, {
                    operatingSystem: "macos",
                    architecture: "arm64",
                  })
                }
              >
                <strong className="block text-lg">Newer Mac</strong>
                <span className="mt-1 block text-sm">
                  2021 or later, or a late-2020 Mac with an Apple M1 chip
                </span>
              </a>
              <a
                aria-disabled={choosingMacDownload}
                className="hive-dialog-option aria-disabled:pointer-events-none aria-disabled:opacity-50"
                href={BUZZ_RELEASES_URL}
                onClick={(event) =>
                  void chooseMacDownload(event, {
                    operatingSystem: "macos",
                    architecture: "x64",
                  })
                }
              >
                <strong className="block text-lg">Older Mac</strong>
                <span className="mt-1 block text-sm">
                  2019 or earlier, or a 2020 Mac with an Intel processor
                </span>
              </a>
            </div>
            <p className="mt-5 text-sm leading-5">
              <strong>Not sure?</strong> Open the Apple menu and choose{" "}
              <strong>About This Mac</strong>. “Chip: Apple M…” means Newer Mac.
              “Processor: Intel” means Older Mac.
            </p>
          </div>
        </CommunityDialog>
      )}

      {document && (
        <CommunityDialog
          label={document.title}
          icon={FileText}
          onClose={() => setDocument(null)}
        >
          <div className="prose prose-sm max-w-none">
            <Markdown remarkPlugins={[remarkGfm]}>{document.markdown}</Markdown>
          </div>
        </CommunityDialog>
      )}
    </div>
  );
}
