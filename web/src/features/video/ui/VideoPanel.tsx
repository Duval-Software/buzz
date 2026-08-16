import {
  type LocalTrackPublication,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  Room,
  RoomEvent,
  type Track,
} from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { requestChannelToken } from "@/features/video/stage-client";
import { cn } from "@/shared/lib/cn";
import { truncatePubkey } from "@/shared/lib/pubkey";

type Tile = {
  id: string;
  label: string;
  element: HTMLMediaElement;
  isLocal: boolean;
};

/**
 * The video room for one channel.
 *
 * Joining asks stagekeeper for a token; whether that is granted is decided
 * entirely server-side by the channel policy. A refusal is shown verbatim
 * because the reasons are meaningful to a member ("direct messages do not have
 * video", "you are not in this private channel").
 *
 * The room is torn down on unmount and on channel change: leaving a call
 * running in the background because a tab was switched is how people end up
 * broadcasting without realising.
 */
export function VideoPanel({
  channelId,
  channelName,
}: {
  channelId: string;
  channelName: string;
}) {
  const [room, setRoom] = useState<Room | null>(null);
  const [status, setStatus] = useState<"idle" | "joining" | "live">("idle");
  const [error, setError] = useState<string | null>(null);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [camOn, setCamOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  const attach = useCallback(
    (
      track: RemoteTrack | Track,
      id: string,
      label: string,
      isLocal: boolean,
    ) => {
      const element = track.attach();
      element.autoplay = true;
      if (element instanceof HTMLVideoElement) {
        element.playsInline = true;
      }
      // Never play our own audio back to us.
      element.muted = isLocal;
      setTiles((prev) =>
        prev.some((t) => t.id === id)
          ? prev
          : [...prev, { id, label, element, isLocal }],
      );
    },
    [],
  );

  const leave = useCallback(async () => {
    if (room) {
      await room.disconnect();
    }
    setRoom(null);
    setTiles([]);
    setStatus("idle");
    setCamOn(false);
    setMicOn(false);
    setScreenOn(false);
  }, [room]);

  const join = useCallback(async () => {
    setError(null);
    setStatus("joining");
    try {
      const grant = await requestChannelToken(channelId, "publish");
      const next = new Room({ adaptiveStream: true, dynacast: true });

      next.on(
        RoomEvent.TrackSubscribed,
        (
          track: RemoteTrack,
          publication: RemoteTrackPublication,
          participant: RemoteParticipant,
        ) => {
          attach(
            track,
            publication.trackSid,
            truncatePubkey(participant.name || participant.identity),
            false,
          );
        },
      );
      next.on(
        RoomEvent.TrackUnsubscribed,
        (track: RemoteTrack, publication: RemoteTrackPublication) => {
          for (const element of track.detach()) {
            element.remove();
          }
          setTiles((prev) => prev.filter((t) => t.id !== publication.trackSid));
        },
      );
      next.on(
        RoomEvent.LocalTrackPublished,
        (publication: LocalTrackPublication) => {
          if (publication.track) {
            attach(publication.track, publication.trackSid, "you", true);
          }
        },
      );
      next.on(
        RoomEvent.LocalTrackUnpublished,
        (publication: LocalTrackPublication) => {
          setTiles((prev) => prev.filter((t) => t.id !== publication.trackSid));
        },
      );
      next.on(RoomEvent.Disconnected, () => {
        setStatus("idle");
        setTiles([]);
      });

      await next.connect(grant.url, grant.token);
      setRoom(next);
      setStatus("live");
    } catch (cause) {
      setStatus("idle");
      setError(cause instanceof Error ? cause.message : "could not join");
    }
  }, [channelId, attach]);

  // Ending the call on unmount is what stops a tab switch from leaving someone
  // broadcasting. The parent keys this component by channel id, so changing
  // channel unmounts and lands here too.
  useEffect(() => {
    return () => {
      void room?.disconnect();
    };
  }, [room]);

  // Media elements are created by livekit, so they are appended imperatively.
  useEffect(() => {
    const host = stageRef.current;
    if (!host) {
      return;
    }
    for (const tile of tiles) {
      if (tile.element instanceof HTMLVideoElement) {
        const holder = host.querySelector(`[data-tile="${tile.id}"]`);
        if (holder && !holder.contains(tile.element)) {
          holder.appendChild(tile.element);
        }
      } else if (!document.body.contains(tile.element)) {
        // Audio needs to be in the document to play, but not to be seen.
        document.body.appendChild(tile.element);
      }
    }
  }, [tiles]);

  async function toggleCam() {
    if (!room) {
      return;
    }
    const next = !camOn;
    await room.localParticipant.setCameraEnabled(next);
    await room.localParticipant.setMicrophoneEnabled(next);
    setCamOn(next);
    setMicOn(next);
  }

  async function toggleScreen() {
    if (!room) {
      return;
    }
    const next = !screenOn;
    await room.localParticipant.setScreenShareEnabled(next);
    setScreenOn(next);
  }

  async function toggleMic() {
    if (!room) {
      return;
    }
    const next = !micOn;
    await room.localParticipant.setMicrophoneEnabled(next);
    setMicOn(next);
  }

  const videoTiles = tiles.filter((t) => t.element instanceof HTMLVideoElement);

  return (
    <section className="flex flex-col gap-3 border-neutral-800 border-b bg-neutral-900 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {status !== "live" ? (
          <button
            type="button"
            onClick={join}
            disabled={status === "joining"}
            className="rounded-lg bg-amber-500 px-3 py-1.5 font-semibold text-neutral-950 text-sm disabled:opacity-50"
          >
            {status === "joining" ? "joining…" : `Join #${channelName} video`}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={toggleCam}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-sm",
                camOn
                  ? "border-amber-600 bg-amber-950 text-amber-300"
                  : "border-neutral-700 text-neutral-300",
              )}
            >
              {camOn ? "Camera on" : "Camera + mic"}
            </button>
            <button
              type="button"
              onClick={toggleMic}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-sm",
                micOn
                  ? "border-amber-600 bg-amber-950 text-amber-300"
                  : "border-neutral-700 text-neutral-300",
              )}
            >
              {micOn ? "Mic on" : "Mic"}
            </button>
            <button
              type="button"
              onClick={toggleScreen}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-sm",
                screenOn
                  ? "border-amber-600 bg-amber-950 text-amber-300"
                  : "border-neutral-700 text-neutral-300",
              )}
            >
              {screenOn ? "Sharing screen" : "Share screen"}
            </button>
            <button
              type="button"
              onClick={leave}
              className="rounded-lg border border-neutral-700 px-3 py-1.5 text-neutral-400 text-sm"
            >
              Leave
            </button>
            <span className="text-neutral-500 text-xs">
              {room?.numParticipants ?? 1} in call
            </span>
          </>
        )}
      </div>

      {error ? (
        <p className="text-red-400 text-sm" role="alert">
          {error}
        </p>
      ) : null}

      {status === "live" ? (
        <div
          ref={stageRef}
          className="grid gap-2"
          style={{
            gridTemplateColumns:
              "repeat(auto-fill, minmax(min(100%, 260px), 1fr))",
          }}
        >
          {videoTiles.length === 0 ? (
            <p className="text-neutral-500 text-sm">
              You are in. Turn a camera on, or wait for someone to share.
            </p>
          ) : (
            videoTiles.map((tile) => (
              <div
                key={tile.id}
                data-tile={tile.id}
                className="relative aspect-video overflow-hidden rounded-lg border border-neutral-800 bg-black [&>video]:h-full [&>video]:w-full [&>video]:object-cover"
              >
                <span className="absolute bottom-1 left-2 rounded bg-neutral-950/80 px-1.5 text-amber-300 text-xs">
                  {tile.label}
                </span>
              </div>
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}
