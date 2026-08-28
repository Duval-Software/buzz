/**
 * Media elements that fetch their bytes with Blossom auth.
 *
 * The relay gates media reads behind a signed header that plain media tags
 * cannot send, so these wrappers resolve an object URL first (see
 * media-auth.ts) and render a quiet placeholder until it arrives.
 */

import { useAuthedMediaUrl } from "@/features/chat/media-auth";

export function AuthedImage({
  url,
  alt,
  className,
  style,
}: {
  url: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const src = useAuthedMediaUrl(url);
  if (!src) {
    return (
      <div
        className={className}
        style={{ ...style, minHeight: "6rem" }}
        aria-label="loading attachment"
      />
    );
  }
  return <img src={src} alt={alt} className={className} style={style} />;
}

export function AuthedVideo({
  url,
  className,
  style,
}: {
  url: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const src = useAuthedMediaUrl(url);
  if (!src) {
    return (
      <div
        className={className}
        style={{ ...style, minHeight: "6rem" }}
        aria-label="loading video"
      />
    );
  }
  // biome-ignore lint/a11y/useMediaCaption: user uploads carry no caption track
  return (
    <video
      src={src}
      controls
      preload="metadata"
      className={className}
      style={style}
    />
  );
}

export function AuthedAudio({
  url,
  className,
}: {
  url: string;
  className?: string;
}) {
  const src = useAuthedMediaUrl(url);
  if (!src) {
    return <p className={className}>loading…</p>;
  }
  // biome-ignore lint/a11y/useMediaCaption: recorded speech carries no caption track
  return <audio src={src} controls preload="metadata" className={className} />;
}
