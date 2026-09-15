import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { HiveBrand } from "@/features/surfaces/ui/SurfacesNav";
import { readPublicProfile, type PublicProfile } from "../public-profile";
import { ProfileView } from "./ProfileView";
import { ProfileActions } from "./ProfileActions";

/** Public entry point deliberately has no identity bootstrap or relay subscription. */
export function PublicProfilePage({ username }: { username: string }) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const tag = document.createElement("meta");
    tag.name = "robots";
    tag.content = "noindex, nofollow";
    document.head.append(tag);
    return () => tag.remove();
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry repeats a failed profile read.
  useEffect(() => {
    let active = true;
    setProfile(null);
    setError("");
    void readPublicProfile(username)
      .then((p) => {
        if (active) {
          setProfile(p);
          document.title = `${p.display_name} (@${p.username}) · CreatorHive`;
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [username, retry]);
  return (
    <div className="hive-app portfolio-page">
      <header className="portfolio-nav">
        <HiveBrand />
        <Link to="/chat" search={{}}>
          Enter the Hive <span aria-hidden="true">↗</span>
        </Link>
      </header>
      <main>
        {profile ? (
          <ProfileView
            profile={profile}
            actions={<ProfileActions profile={profile} />}
          />
        ) : (
          <div className="portfolio-state">
            {error ? (
              <>
                <h1>Profile unavailable</h1>
                <p>This profile may be private or not published yet.</p>
                <button type="button" onClick={() => setRetry((n) => n + 1)}>
                  Retry
                </button>
                <Link to="/chat" search={{}}>
                  Sign in to CreatorHive
                </Link>
              </>
            ) : (
              <p role="status">Loading profile…</p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
