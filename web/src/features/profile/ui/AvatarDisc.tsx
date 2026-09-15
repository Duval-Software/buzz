import { useProfile } from "../use-profiles";
import { isRelayMediaUrl } from "@/features/chat/message-media";
import { useAuthedMediaUrl } from "@/features/chat/media-auth";

/** Show only authenticated relay photos; arbitrary profile URLs never become tracking pixels. */
export function AvatarDisc({
  pubkey,
  name,
  size = 24,
}: {
  pubkey: string;
  name: string;
  size?: number;
}) {
  const profile = useProfile(pubkey);
  const picture = profile?.raw.picture;
  // Stable hue from the key so a person keeps their color across sessions
  // and screens. First 6 hex chars are plenty of entropy for a hue wheel.
  const hue = Number.parseInt(pubkey.slice(0, 6) || "0", 16) % 360;
  const letter = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 select-none items-center justify-center rounded-xl font-semibold overflow-hidden"
      style={{
        width: `${size / 16}rem`,
        height: `${size / 16}rem`,
        fontSize: `${size / 32}rem`,
        backgroundColor: `hsl(${hue} 22% 26%)`,
        color: `hsl(${hue} 38% 82%)`,
      }}
    >
      {typeof picture === "string" && isRelayMediaUrl(picture) ? (
        <RelayAvatar url={picture} fallback={letter} />
      ) : (
        letter
      )}
    </span>
  );
}

function RelayAvatar({ url, fallback }: { url: string; fallback: string }) {
  const { src, failed, onError } = useAuthedMediaUrl(url);
  return src && !failed ? (
    <img
      src={src}
      alt=""
      onError={onError}
      className="w-full h-full object-cover"
    />
  ) : (
    fallback
  );
}
