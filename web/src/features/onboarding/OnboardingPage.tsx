import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Activity,
  ArrowRight,
  Check,
  MessageSquare,
  Radio,
} from "lucide-react";
import { useMembership } from "@/features/identity/use-identity";
import { publishDisplayName } from "@/features/profile/profile-store";
import { useProfile } from "@/features/profile/use-profiles";
import { HiveBrand } from "@/features/surfaces/ui/SurfacesNav";
import { setOnboardingStatus } from "./onboarding-state";
import "./onboarding.css";

const steps = ["Meet the Hive", "Your profile", "Your first stop"];
const destinations = [
  {
    path: "/chat",
    title: "Join the conversation",
    label: "Chat",
    icon: MessageSquare,
    copy: "Meet members, ask a question, or find someone to build with.",
  },
  {
    path: "/live",
    title: "Step into the studio",
    label: "Live",
    icon: Radio,
    copy: "Watch the build, follow decisions, and help shape what ships.",
  },
  {
    path: "/pulse",
    title: "See what’s happening",
    label: "Pulse",
    icon: Activity,
    copy: "Catch up on ideas, work in progress, and community updates.",
  },
] as const;

/** An optional welcome flow. It never enrolls, charges, or posts for a member. */
export function OnboardingPage() {
  const { identity } = useMembership();
  const profile = useProfile(identity?.pubkey ?? "");
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [destination, setDestination] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const name = nameDraft ?? profile?.displayName ?? identity?.username ?? "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: announce each newly displayed step to keyboard users.
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  if (!identity) return null;

  async function finish(skip = false) {
    if (!identity || busy) return;
    setBusy(true);
    setError("");
    try {
      if (!skip) await publishDisplayName(identity.pubkey, name);
      setOnboardingStatus(identity.pubkey, "done");
      await navigate({ to: skip ? "/chat" : destinations[destination].path });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save your profile. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hive-app hive-onboarding">
      <header>
        <HiveBrand />
        <button
          type="button"
          disabled={busy}
          onClick={() => void finish(true)}
          className="hive-onboarding-skip"
        >
          Skip for now
        </button>
      </header>
      <div className="hive-onboarding-layout">
        <aside>
          <p className="hive-onboarding-eyebrow">YOUR FIRST FEW MINUTES</p>
          <h1>
            Find your place
            <br />
            in the Hive<span>.</span>
          </h1>
          <p>
            A community of people turning ideas into things you can use. There’s
            room for yours.
          </p>
          <ol
            aria-label="Getting started progress"
            className="hive-onboarding-progress"
          >
            {steps.map((title, index) => (
              <li
                key={title}
                aria-current={step === index ? "step" : undefined}
                data-complete={step > index}
              >
                <span aria-hidden="true">
                  {step > index ? <Check size={15} /> : `0${index + 1}`}
                </span>
                <span>{title}</span>
              </li>
            ))}
          </ol>
          <p className="hive-onboarding-aside-note">
            Start small. Say hello. Share something unfinished.
          </p>
        </aside>
        <section
          aria-labelledby="onboarding-title"
          className="hive-onboarding-content"
        >
          <p className="hive-onboarding-eyebrow">STEP {step + 1} OF 3</p>
          <h2 id="onboarding-title" ref={heading} tabIndex={-1}>
            {step === 0
              ? "Good ideas grow together."
              : step === 1
                ? "What should we call you?"
                : "Where shall we start?"}
          </h2>
          {step === 0 ? (
            <>
              <p>
                Welcome to CreatorHive. Get to know the people, the projects,
                and the process behind what we’re building.
              </p>
              <svg
                className="hive-onboarding-art"
                viewBox="0 0 480 155"
                fill="none"
                aria-hidden="true"
              >
                <path d="M90 70H390" stroke="currentColor" strokeWidth="1" />
                {[90, 240, 390].map((x, index) => (
                  <g key={x} transform={`translate(${x} 70)`}>
                    <path
                      d="M0 -42 36 -21V21L0 42 -36 21V-21Z"
                      className={
                        index === 1
                          ? "hive-onboarding-cell is-center"
                          : "hive-onboarding-cell"
                      }
                    />
                    <circle r={index === 1 ? 7 : 4} fill="currentColor" />
                  </g>
                ))}
                <g
                  fill="currentColor"
                  fontSize="11"
                  textAnchor="middle"
                  letterSpacing="2"
                >
                  <text x="90" y="144">
                    MEET
                  </text>
                  <text x="240" y="144">
                    BUILD
                  </text>
                  <text x="390" y="144">
                    SHARE
                  </text>
                </g>
              </svg>
              <div className="hive-onboarding-welcome">
                <p>
                  <strong>A conversation worth joining</strong>Ask for help,
                  offer a perspective, and make something with other members.
                </p>
                <p>
                  <strong>An open door to the studio</strong>Follow the work on
                  Live and catch up with the community in Pulse.
                </p>
              </div>
            </>
          ) : step === 1 ? (
            <>
              <p>
                Your display name appears beside your messages and work. You can
                change it in your account anytime.
              </p>
              <form
                id="onboarding-profile"
                className="hive-credentials"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!name.trim()) {
                    setError("Enter a display name to continue.");
                    return;
                  }
                  setError("");
                  setStep(2);
                }}
              >
                <label>
                  Display name
                  <input
                    autoComplete="nickname"
                    value={name}
                    required
                    maxLength={60}
                    onChange={(event) => {
                      setNameDraft(event.target.value);
                      setError("");
                    }}
                    aria-describedby="onboarding-name-note"
                  />
                </label>
                <p id="onboarding-name-note" className="hive-onboarding-note">
                  {identity.username
                    ? `Your sign-in username stays @${identity.username}.`
                    : "Your existing profile and community access stay with you."}
                </p>
              </form>
              <div className="hive-onboarding-profile-preview">
                <span aria-hidden="true">
                  {name.trim().slice(0, 1).toUpperCase() || "?"}
                </span>
                <div>
                  <strong>{name.trim() || "Your name"}</strong>
                  <small>How you’ll appear in the community</small>
                </div>
              </div>
            </>
          ) : (
            <>
              <p>
                Pick a first stop, {name.trim()}. Everything is available from
                the community navigation.
              </p>
              <fieldset
                className="hive-onboarding-destinations"
                disabled={busy}
              >
                <legend className="sr-only">Your first stop</legend>
                {destinations.map(
                  ({ path, title, copy, icon: Icon }, index) => (
                    <label key={path}>
                      <input
                        type="radio"
                        name="first-stop"
                        value={path}
                        checked={destination === index}
                        onChange={() => setDestination(index)}
                      />
                      <Icon size={22} aria-hidden="true" />
                      <span>
                        <strong>{title}</strong>
                        <small>{copy}</small>
                      </span>
                    </label>
                  ),
                )}
              </fieldset>
              <p className="hive-onboarding-note">
                Your display name will be saved to your community profile. No
                message is posted for you.
              </p>
            </>
          )}
          {error && (
            <p role="alert" className="hive-onboarding-error">
              {error}
            </p>
          )}
          <footer>
            {step > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setError("");
                  setStep(step - 1);
                }}
              >
                Back
              </button>
            )}
            {step === 1 ? (
              <button
                className="hive-primary-button"
                type="submit"
                form="onboarding-profile"
                key="profile-submit"
              >
                Continue <ArrowRight size={17} aria-hidden="true" />
              </button>
            ) : (
              <button
                className="hive-primary-button"
                type="button"
                disabled={busy}
                onClick={() => (step === 0 ? setStep(1) : void finish())}
              >
                {busy
                  ? "Saving your profile…"
                  : step === 0
                    ? "Make yourself at home"
                    : `Save & open ${destinations[destination].label}`}
                <ArrowRight size={17} aria-hidden="true" />
              </button>
            )}
          </footer>
        </section>
      </div>
    </div>
  );
}
