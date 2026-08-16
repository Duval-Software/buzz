/**
 * A small identicon: first letter of the name on a hue derived from the
 * pubkey.
 *
 * Deliberately NOT the profile's picture URL. Profile pictures are arbitrary
 * external URLs, and rendering them would make every reader's browser call
 * out to whatever host the author chose — an IP beacon in a chat timeline.
 * The desktop app runs a whole avatar verification pipeline before showing
 * one; until the web app has an equivalent, a deterministic disc is honest
 * and leaks nothing.
 */

export function AvatarDisc({
  pubkey,
  name,
  size = 24,
}: {
  pubkey: string;
  name: string;
  size?: number;
}) {
  // Stable hue from the key so a person keeps their color across sessions
  // and screens. First 6 hex chars are plenty of entropy for a hue wheel.
  const hue = Number.parseInt(pubkey.slice(0, 6) || "0", 16) % 360;
  const letter = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.5,
        backgroundColor: `hsl(${hue} 45% 28%)`,
        color: `hsl(${hue} 80% 85%)`,
      }}
    >
      {letter}
    </span>
  );
}
