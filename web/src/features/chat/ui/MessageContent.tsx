import { Children, createElement, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "@/features/chat/use-chat";
import { segmentContent } from "@/features/chat/rich-text";
import { formatVoiceNoteDuration } from "@/features/chat/voice-note";
import {
  AuthedAudio,
  AuthedImage,
  AuthedVideo,
} from "@/features/chat/ui/AuthedMedia";
import { useNames } from "@/features/profile/use-profiles";
import { cn } from "@/shared/lib/cn";
import "./message-markdown.css";

/**
 * The message body with mentions and custom emoji rendered inline.
 *
 * Mention names resolve through the event's `p` tags: the tag names WHO is
 * notified, the profile store names what they are called, and the text is
 * highlighted wherever that name follows an `@`. Nothing is trusted from the
 * text alone — an "@Name" with no matching `p` tag stays plain text.
 */
export function MessageContent({
  message,
  selfPubkey,
}: {
  message: Pick<ChatMessage, "content" | "mentions" | "emoji" | "media">;
  selfPubkey: string;
}) {
  const names = useNames();
  const mentionNames = new Map<string, string>();
  for (const pubkey of message.mentions) {
    mentionNames.set(names(pubkey), pubkey);
  }
  function decorate(children: ReactNode): ReactNode {
    return Children.map(children, (child) => {
      if (typeof child !== "string") return child;
      return segmentContent(child, mentionNames, message.emoji).map(
        (segment, index) => {
          // Segments have no ids; the list is rebuilt whole on every change.
          const key = `${index}-${segment.kind}`;
          if (segment.kind === "mention") {
            const isSelf = segment.pubkey === selfPubkey.toLowerCase();
            return (
              <span
                key={key}
                className={cn(
                  "rounded px-0.5 font-medium",
                  isSelf
                    ? "bg-amber-500/25 text-amber-200"
                    : "bg-amber-500/10 text-amber-400",
                )}
              >
                {segment.text}
              </span>
            );
          }
          if (segment.kind === "emoji") {
            return (
              <img
                key={key}
                src={segment.url}
                alt={`:${segment.code}:`}
                title={`:${segment.code}:`}
                className="inline-block h-5 w-5 align-text-bottom"
              />
            );
          }
          return <span key={key}>{segment.text}</span>;
        },
      );
    });
  }
  const components: Components = {
    // Attachment bytes still come from vetted imeta tags, never arbitrary
    // Markdown image URLs. Preserve the alternative text without fetching.
    img: ({ src, alt }) =>
      message.media.some((item) => item.url === src) ? null : alt,
    a: ({ href, children }) =>
      href ? (
        <a href={href} target="_blank" rel="noreferrer">
          {decorate(children)}
        </a>
      ) : (
        children
      ),
  };
  for (const tag of [
    "p",
    "strong",
    "em",
    "del",
    "li",
    "td",
    "th",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
  ] as const) {
    Object.assign(components, {
      [tag]: ({ children }: { children?: ReactNode }) =>
        createElement(tag, null, decorate(children)),
    });
  }
  return (
    <div className="message-markdown">
      <Markdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {message.content}
      </Markdown>
    </div>
  );
}

/** The same vetted attachments in channel, DM, and thread messages. */
export function MessageAttachments({
  message,
}: {
  message: Pick<ChatMessage, "media">;
}) {
  return (message.media ?? []).length > 0 ? (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {(message.media ?? []).map((item) =>
        item.kind === "voice" ? (
          <div
            key={item.url}
            className="flex max-w-md items-center gap-2.5 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2"
          >
            <span aria-hidden="true" className="shrink-0 text-lg">
              🎙️
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-neutral-400 text-xs">
                Voice note
                {item.duration
                  ? ` · ${formatVoiceNoteDuration(item.duration)}`
                  : ""}
              </p>
              <AuthedAudio url={item.url} className="mt-1 h-9 w-full" />
            </div>
          </div>
        ) : item.kind === "video" ? (
          <AuthedVideo
            key={item.url}
            url={item.url}
            className="max-h-80 max-w-md rounded-lg border border-neutral-800 bg-black"
            style={item.ratio ? { aspectRatio: item.ratio } : undefined}
          />
        ) : (
          <a
            key={item.url}
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="block max-w-md"
          >
            {/*
                  Eager on purpose. A lazy image with no intrinsic size
                  collapses to zero height, and Chromium never fetches a
                  zero-sized lazy image — the attachment simply never appears
                  (found live, not in review). Timelines are capped at 200
                  messages and media is relay-local, so eager is cheap.
                */}
            <AuthedImage
              url={item.url}
              alt="attachment"
              className="w-full max-w-md rounded-lg border border-neutral-800 bg-neutral-900 object-contain"
              style={item.ratio ? { aspectRatio: item.ratio } : undefined}
            />
          </a>
        ),
      )}
    </div>
  ) : null;
}
