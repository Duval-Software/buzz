import { ProfileView } from "./ProfileView";
import type { PublicProfile } from "../public-profile";
/** New members explicitly see the fields becoming public before finishing. */
export function OnboardingProfilePreview({
  name,
  username,
  visibility,
  onVisibility,
}: {
  name: string;
  username: string;
  visibility: PublicProfile["visibility"];
  onVisibility: (v: PublicProfile["visibility"]) => void;
}) {
  return (
    <div className="portfolio-form">
      <ProfileView
        compact
        profile={{
          username,
          display_name: name,
          bio: "",
          accent: "honey",
          interests: [],
          links: [],
          highlights: [],
          avatar: null,
          cover: null,
          collaborating: false,
          visibility,
          published: false,
        }}
      />
      <label>
        Who can see your profile?
        <select
          value={visibility}
          onChange={(e) =>
            onVisibility(e.target.value as PublicProfile["visibility"])
          }
        >
          <option value="public">Anyone with the link</option>
          <option value="members">CreatorHive members only</option>
        </select>
      </label>
      <p>
        Your name and @username appear here. Your interests and project answer
        stay private. Add a public photo and selected work in Edit profile.
      </p>
    </div>
  );
}
