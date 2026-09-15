import { OnboardingProfilePreview } from "@/features/profile/ui/OnboardingProfilePreview";
import {
  savePublicProfile,
  ownPublicProfile,
  type PublicProfile,
} from "@/features/profile/public-profile";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  Camera,
  Code2,
  Sparkles,
  Check,
  BrainCircuit,
  Palette,
  Video,
  Cpu,
  Rocket,
  Compass,
} from "lucide-react";
import { useMembership } from "@/features/identity/use-identity";
import { publishProfile } from "@/features/profile/profile-store";
import { useProfile } from "@/features/profile/use-profiles";
import { Onboarding } from "@/shared/ui/onboarding";
import { HiveBrand } from "@/features/surfaces/ui/SurfacesNav";
import { useChannels } from "@/features/chat/use-chat";
import { uploadImage } from "@/features/chat/upload";
import { AuthedImage } from "@/features/chat/ui/AuthedMedia";
import { isRelayMediaUrl } from "@/features/chat/message-media";
import {
  completeManagedOnboarding,
  setOnboardingStatus,
} from "./onboarding-state";
import {
  interests,
  memberProfileRequest,
  type MemberProfile,
} from "./member-profile";
import { managedAccountsEnabled, supabase } from "@/shared/lib/supabase";
import { relayWsUrl } from "@/shared/lib/relay-url";
import "@/shared/styles/account-entry.css";
import "./onboarding.css";

const interestIcons = [
  Sparkles,
  Code2,
  BrainCircuit,
  Palette,
  Video,
  Cpu,
  Rocket,
  Compass,
];
const usernamePattern = /^[a-z][a-z0-9_]{2,23}$/;

/** Account creation precedes this member-only flow. Only profile updates are published. */
export function OnboardingPage() {
  const { identity } = useMembership();
  const { channels } = useChannels();
  const profile = useProfile(identity?.pubkey ?? "");
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [suggestedName, setSuggestedName] = useState("");
  const [username, setUsername] = useState("");
  const [claimedUsername, setClaimedUsername] = useState("");
  const [justClaimed, setJustClaimed] = useState(false);
  const interestsStep = managedAccountsEnabled ? 2 : 1;
  const claimingStep = managedAccountsEnabled && step === 1;
  const publicProfilesEnabled =
    managedAccountsEnabled && import.meta.env.VITE_PUBLIC_PROFILES === "true";
  const lastStep = interestsStep + (publicProfilesEnabled ? 1 : 0);
  const reviewingProfile = publicProfilesEnabled && step === lastStep;
  const [visibility, setVisibility] =
    useState<PublicProfile["visibility"]>("public");
  const [selected, setSelected] = useState<string[]>([]);
  const [workingOn, setWorkingOn] = useState("");
  const [googlePhoto, setGooglePhoto] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [savedPhoto, setSavedPhoto] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(!managedAccountsEnabled);
  const [retry, setRetry] = useState(0);
  const [availability, setAvailability] = useState<
    "idle" | "checking" | "available" | "taken" | "error"
  >("idle");
  const heading = useRef<HTMLHeadingElement>(null);
  const name =
    nameDraft ?? profile?.displayName ?? identity?.username ?? suggestedName;
  const handle = username.trim().toLowerCase();
  const currentPicture = savedPhoto ?? profile?.raw.picture;

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry explicitly repeats a failed profile load.
  useEffect(() => {
    let active = true;
    if (!supabase) return;
    setReady(false);
    void Promise.all([supabase.auth.getSession(), memberProfileRequest("get")])
      .then(([session, saved]) => {
        if (!active) return;
        const metadata = session.data.session?.user.user_metadata;
        setSuggestedName(
          typeof metadata?.full_name === "string"
            ? metadata.full_name.slice(0, 60)
            : "",
        );
        const record = saved as MemberProfile | null;
        if (record) {
          setNameDraft(record.display_name);
          setUsername(record.username);
          setClaimedUsername(record.username);
          setSelected(record.interests);
          setWorkingOn(record.working_on);
        }
        const photo = metadata?.avatar_url;
        if (typeof photo === "string") {
          try {
            const url = new URL(photo);
            if (
              url.protocol === "https:" &&
              (url.hostname === "googleusercontent.com" ||
                url.hostname.endsWith(".googleusercontent.com"))
            )
              setGooglePhoto(photo);
          } catch {
            /* An invalid provider photo is simply not offered. */
          }
        }
        setReady(true);
        setError("");
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load your profile. Please retry.",
          );
      });
    return () => {
      active = false;
    };
  }, [retry]);

  useEffect(() => {
    if (!photoFile) {
      setPhotoPreview("");
      return;
    }
    const url = URL.createObjectURL(photoFile);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  useEffect(() => {
    if (!managedAccountsEnabled || !usernamePattern.test(handle)) {
      setAvailability("idle");
      return;
    }
    let active = true;
    setAvailability("checking");
    const timer = setTimeout(() => {
      void memberProfileRequest("check", handle)
        .then((data) => {
          if (active) setAvailability(data.available ? "available" : "taken");
        })
        .catch(() => {
          if (active) setAvailability("error");
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [handle]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: announce each step.
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  function choosePhoto(file: File) {
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      setError("Choose a JPG, PNG or WebP image smaller than 5 MB.");
      return;
    }
    setPhotoFile(file);
    setError("");
  }

  async function importGooglePhoto() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(googlePhoto, {
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok)
        throw new Error("Could not import that photo. Try uploading one.");
      choosePhoto(
        new File([await response.blob()], "google-profile.jpg", {
          type:
            response.headers.get("content-type")?.split(";")[0] ?? "image/jpeg",
        }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not import photo.",
      );
    } finally {
      setBusy(false);
    }
  }

  function profileValid() {
    if (!name.trim()) {
      setError("Enter a display name to continue.");
      return false;
    }
    return true;
  }

  async function claimUsername() {
    if (busy || !ready || !profileValid()) return;
    if (!usernamePattern.test(handle) || availability !== "available") {
      setError("Choose an available username before claiming it.");
      return;
    }
    setBusy(true);
    setError("");
    setJustClaimed(false);
    try {
      const saved = await memberProfileRequest("save", handle, {
        username: handle,
        display_name: name.trim(),
        interests: selected,
        working_on: workingOn.trim(),
      });
      setClaimedUsername(saved.username);
      setJustClaimed(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not claim this username. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!identity || busy || !ready || !profileValid()) return;
    if (managedAccountsEnabled && claimedUsername !== handle) {
      setError("Claim your username before entering the Hive.");
      setStep(1);
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (managedAccountsEnabled)
        await memberProfileRequest("save", handle, {
          username: handle,
          display_name: name.trim(),
          interests: selected,
          working_on: workingOn.trim(),
        });
      let picture = savedPhoto;
      if (photoFile) {
        picture = (await uploadImage(photoFile)).url;
        if (!isRelayMediaUrl(picture))
          throw new Error(
            "The photo service returned an unsupported location.",
          );
        setSavedPhoto(picture);
        setPhotoFile(null);
      }
      await publishProfile(identity.pubkey, name, picture);
      if (managedAccountsEnabled) await completeManagedOnboarding();
      if (publicProfilesEnabled) {
        const existingPublicProfile = await ownPublicProfile();
        const result = await savePublicProfile({
          ...existingPublicProfile,
          username: handle,
          display_name: name.trim(),
          visibility,
          published: false,
        });
        if (visibility === "public" && !result.published)
          throw new Error(
            "Public profiles are not enabled on this preview yet. Choose members only to continue, or try again after launch.",
          );
      }
      setOnboardingStatus(identity.pubkey, "done");
      try {
        sessionStorage.setItem(
          `creatorhive.welcome:${relayWsUrl()}:${identity.pubkey}`,
          JSON.stringify({ name: name.trim(), interests: selected }),
        );
      } catch {
        /* Welcome is optional; storage restrictions cannot block entry. */
      }
      const firstChannel =
        channels.find(
          (c) => c.kind === "channel" && c.name.toLowerCase() === "general",
        ) ?? channels.find((c) => c.kind === "channel");
      await navigate({
        to: "/chat",
        search: firstChannel ? { channel: firstChannel.id } : {},
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save your profile. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!identity) return null;
  return (
    <div className="hive-app hive-account-scene hive-onboarding">
      <header className="hive-account-header">
        <HiveBrand />
      </header>
      <div className="hive-onboarding-layout">
        <Onboarding
          value={step + 1}
          totalSteps={lastStep + 1}
          aria-labelledby="onboarding-title"
        >
          <Onboarding.Header>
            <div className="hive-onboarding-step-meta">
              <span>
                {reviewingProfile
                  ? "YOUR PUBLIC PROFILE"
                  : step === 0
                    ? "YOUR PROFILE"
                    : claimingStep
                      ? "YOUR NAME IN THE HIVE"
                      : "YOUR INTERESTS"}
              </span>
              <Onboarding.StepIndicator />
            </div>
            <h2 id="onboarding-title" ref={heading} tabIndex={-1}>
              {reviewingProfile
                ? "Meet the Hive."
                : step === 0
                  ? "Make it yours."
                  : claimingStep
                    ? claimedUsername === handle && handle
                      ? "It’s yours."
                      : "Claim your name."
                    : "What do you build?"}
            </h2>
            <p>
              {reviewingProfile
                ? "A home for your name. A place for your work."
                : step === 0
                  ? "Put a face to the things you’ll build."
                  : claimingStep
                    ? "One username. Unmistakably you."
                    : "Pick a few, or skip. You can change these anytime."}
            </p>
          </Onboarding.Header>
          {!ready ? (
            <p role="status">
              {error
                ? "Your profile couldn’t be loaded."
                : "Loading your profile…"}
            </p>
          ) : (
            <>
              <Onboarding.Step step={1}>
                <div className="hive-onboarding-photo">
                  <span className="hive-onboarding-photo-preview">
                    {photoPreview ? (
                      <img src={photoPreview} alt="Selected avatar" />
                    ) : typeof currentPicture === "string" &&
                      isRelayMediaUrl(currentPicture) ? (
                      <AuthedImage url={currentPicture} alt="" />
                    ) : (
                      name.trim()[0]?.toUpperCase() || <Camera />
                    )}
                  </span>
                  <div>
                    <label className="hive-onboarding-photo-label">
                      <Camera size={16} aria-hidden="true" /> Choose a photo
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={busy}
                        aria-label="Choose a profile photo"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) choosePhoto(file);
                          event.target.value = "";
                        }}
                      />
                    </label>
                    {googlePhoto && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void importGooglePhoto()}
                      >
                        Use Google photo
                      </button>
                    )}
                    {Boolean(photoFile || currentPicture) && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setPhotoFile(null);
                          setSavedPhoto("");
                        }}
                      >
                        Remove photo
                      </button>
                    )}
                  </div>
                </div>
                <form
                  id="onboarding-profile"
                  className="hive-credentials"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (profileValid()) {
                      setError("");
                      setStep(1);
                    }
                  }}
                >
                  <label>
                    Display name
                    <input
                      autoComplete="nickname"
                      value={name}
                      required
                      maxLength={60}
                      disabled={busy}
                      onChange={(event) => {
                        setNameDraft(event.target.value);
                        setError("");
                      }}
                    />
                  </label>
                </form>
              </Onboarding.Step>
              {managedAccountsEnabled && (
                <Onboarding.Step step={2}>
                  <div
                    className="hive-claim"
                    data-available={
                      availability === "available" &&
                      usernamePattern.test(handle)
                    }
                    data-claimed={claimedUsername === handle && !!handle}
                    data-celebrate={justClaimed && claimedUsername === handle}
                  >
                    <div className="hive-claim-preview" aria-hidden="true">
                      <Sparkles className="hive-claim-spark" size={22} />
                      <span>@</span>
                      <strong>{handle || "yourname"}</strong>
                      {claimedUsername === handle && !!handle && (
                        <Check className="hive-claim-check" size={20} />
                      )}
                    </div>
                    <form
                      id="onboarding-username"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void claimUsername();
                      }}
                    >
                      <label className="sr-only" htmlFor="claim-username">
                        Username
                      </label>
                      <div className="hive-username-input">
                        <span aria-hidden="true">@</span>
                        <input
                          id="claim-username"
                          aria-label="Username"
                          autoComplete="username"
                          autoCapitalize="none"
                          spellCheck={false}
                          value={username}
                          maxLength={24}
                          required
                          pattern="[a-zA-Z][a-zA-Z0-9_]{2,23}"
                          disabled={busy}
                          aria-describedby="username-availability"
                          onChange={(event) => {
                            setUsername(event.target.value);
                            setJustClaimed(false);
                            setError("");
                          }}
                        />
                      </div>
                    </form>
                    <p
                      id="username-availability"
                      className="hive-claim-status"
                      role="status"
                    >
                      {claimedUsername === handle && handle
                        ? `@${handle} is yours.`
                        : availability === "checking"
                          ? "Checking availability…"
                          : availability === "available"
                            ? `@${handle} is available`
                            : availability === "taken"
                              ? "That username is taken. Try another."
                              : availability === "error"
                                ? "Couldn’t check this username. Change it to retry; reserved names aren’t available."
                                : "3–24 letters, numbers or underscores. Start with a letter."}
                    </p>
                    <p className="hive-onboarding-note">
                      {claimedUsername === handle && handle
                        ? "Claimed and saved to your account. You can finish setting up at your own pace."
                        : claimedUsername
                          ? `Claiming a new name releases @${claimedUsername}.`
                          : "Available names aren’t reserved until you claim them."}
                    </p>
                  </div>
                </Onboarding.Step>
              )}
              <Onboarding.Step step={interestsStep + 1}>
                <fieldset className="hive-interest-options" disabled={busy}>
                  <legend className="sr-only">Your interests</legend>
                  {interests.map(([id, label], index) => {
                    const Icon = interestIcons[index];
                    return (
                      <label key={id}>
                        <input
                          type="checkbox"
                          value={id}
                          checked={selected.includes(id)}
                          onChange={(event) =>
                            setSelected(
                              event.target.checked
                                ? [...selected, id]
                                : selected.filter((value) => value !== id),
                            )
                          }
                        />
                        <Icon size={19} aria-hidden="true" />
                        <span>{label}</span>
                      </label>
                    );
                  })}
                </fieldset>
                <label className="hive-working-on">
                  What are you working on? <span>Optional</span>
                  <textarea
                    rows={2}
                    maxLength={240}
                    value={workingOn}
                    disabled={busy}
                    onChange={(event) => setWorkingOn(event.target.value)}
                    placeholder="An idea, a project, or something you’d love to learn…"
                  />
                </label>
                <p className="hive-onboarding-note">
                  Your interests and answer stay private. Nothing is posted to
                  chat.
                </p>
              </Onboarding.Step>
              {publicProfilesEnabled && (
                <Onboarding.Step step={lastStep + 1}>
                  <OnboardingProfilePreview
                    name={name}
                    username={handle}
                    visibility={visibility}
                    onVisibility={setVisibility}
                  />
                </Onboarding.Step>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="hive-onboarding-error">
              {error}
            </p>
          )}
          <Onboarding.Navigation disabled={busy}>
            {!managedAccountsEnabled && step === 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setOnboardingStatus(identity.pubkey, "done");
                  void navigate({ to: "/chat", search: {} });
                }}
              >
                Skip for now
              </button>
            )}
            {!ready && error ? (
              <button
                type="button"
                className="hive-primary-button"
                onClick={() => setRetry((n) => n + 1)}
              >
                Retry loading profile
              </button>
            ) : (
              ready && (
                <>
                  {step > 0 && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setError("");
                        setStep((current) => current - 1);
                      }}
                    >
                      Back
                    </button>
                  )}
                  {step === 0 ? (
                    <button
                      type="submit"
                      form="onboarding-profile"
                      className="hive-primary-button"
                      disabled={busy}
                    >
                      Continue <ArrowRight size={17} aria-hidden="true" />
                    </button>
                  ) : claimingStep ? (
                    claimedUsername === handle && handle ? (
                      <button
                        type="button"
                        className="hive-primary-button"
                        onClick={() => {
                          setError("");
                          setStep(interestsStep);
                        }}
                      >
                        Continue <ArrowRight size={17} aria-hidden="true" />
                      </button>
                    ) : (
                      <button
                        type="submit"
                        form="onboarding-username"
                        className="hive-primary-button"
                        disabled={busy}
                      >
                        {busy ? "Claiming…" : "Claim username"}{" "}
                        <ArrowRight size={17} aria-hidden="true" />
                      </button>
                    )
                  ) : publicProfilesEnabled && step === interestsStep ? (
                    <button
                      type="button"
                      className="hive-primary-button"
                      onClick={() => setStep(lastStep)}
                    >
                      Review profile <ArrowRight size={17} aria-hidden="true" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="hive-primary-button"
                      disabled={busy}
                      onClick={() => void finish()}
                    >
                      {busy ? "Saving…" : "Enter the Hive"}
                      <ArrowRight size={17} aria-hidden="true" />
                    </button>
                  )}
                </>
              )
            )}
          </Onboarding.Navigation>
        </Onboarding>
      </div>
    </div>
  );
}
