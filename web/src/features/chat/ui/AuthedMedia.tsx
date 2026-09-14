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
  const { src, failed, onError } = useAuthedMediaUrl(url);
  if (failed)
    return (
      <p className="hive-media-error" role="status">
        Attachment unavailable. Try reopening this conversation.
      </p>
    );
  if (!src) {
    return (
      <div
        className={className}
        style={{ ...style, minHeight: "6rem" }}
        role="status"
        aria-label="Loading attachment"
      />
    );
  }
  return (
    <img
      onError={onError}
      src={src}
      alt={alt}
      className={className}
      style={style}
    />
  );
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
  const { src, failed, onError } = useAuthedMediaUrl(url);
  if (failed)
    return (
      <p className="hive-media-error" role="status">
        Attachment unavailable. Try reopening this conversation.
      </p>
    );
  if (!src) {
    return (
      <div
        className={className}
        style={{ ...style, minHeight: "6rem" }}
        role="status"
        aria-label="Loading video"
      />
    );
  }
  return (
    // biome-ignore lint/a11y/useMediaCaption: user uploads carry no caption track
    <video
      onError={onError}
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
  const { src, failed, onError } = useAuthedMediaUrl(url);
  if (failed)
    return (
      <p className="hive-media-error" role="status">
        Attachment unavailable. Try reopening this conversation.
      </p>
    );
  if (!src) {
    return <p className={className}>loading…</p>;
  }
  return (
    // biome-ignore lint/a11y/useMediaCaption: recorded speech carries no caption track
    <audio
      onError={onError}
      src={src}
      controls
      preload="metadata"
      className={className}
    />
  );
}
