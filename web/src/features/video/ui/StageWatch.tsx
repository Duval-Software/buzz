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
import {
  loungeRoom,
  ownRoom,
  promoteParticipant,
  requestRoomToken,
  requestStreamKey,
  revokeStreamKeys,
  type StreamKey,
} from "@/features/video/stage-client";
import { truncatePubkey } from "@/shared/lib/pubkey";

/**
 * Watching someone's room, and asking to speak.
 *
 * A watcher joins with a subscribe-only token, so raising a hand cannot be a
 * media action — it is a data message. The wire format is fixed by the
 * existing stage page, which hosts already use:
 *
 *     {"t":"hand","id":"<identity>","name":"<display>"}
 *
 * Matching it exactly is the point: a hand raised here appears for a host
 * watching from the standalone stage page, and vice versa. Inventing a nicer
 * shape would split the room in two.
 *
 * Being promoted needs no reconnect. stagekeeper updates the participant's
 * permissions in place, and livekit-client reports it via
 * `ParticipantPermissionsChanged` — which is the whole reason raise-hand
 * feels instant.
 */

type HandRaised = { identity: string; name: string };

type Tile = {
  id: string;
  label: string;
  element: HTMLMediaElement;
};

export function StageWatch({
  room: roomName,
  selfPubkey,
  onClose,
}: {
  room: string;
  selfPubkey: string;
  onClose: () => void;
}) {
  const [room, setRoom] = useState<Room | null>(null);
  const [status, setStatus] = useState<"joining" | "live" | "failed">(
    "joining",
  );
  const [error, setError] = useState<string | null>(null);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [hands, setHands] = useState<HandRaised[]>([]);
  const [handUp, setHandUp] = useState(false);
  const [canPublish, setCanPublish] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [obsKey, setObsKey] = useState<StreamKey | null>(null);
  const [obsBusy, setObsBusy] = useState(false);
  const [obsNote, setObsNote] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const iHost = roomName === ownRoom(selfPubkey);
  // The Lounge has no host and no stage: any member may publish, so there is
  // nothing to raise a hand for and nobody whose job it is to see one.
  const isLounge = roomName === loungeRoom();
  const publisher = iHost || isLounge;

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
      element.muted = isLocal;
      setTiles((prev) =>
        prev.some((t) => t.id === id)
          ? prev
          : [...prev, { id, label, element }],
      );
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
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
    next.on(RoomEvent.LocalTrackPublished, (pub: LocalTrackPublication) => {
      if (pub.track) {
        attach(pub.track, pub.trackSid, "you", true);
      }
    });
    next.on(RoomEvent.LocalTrackUnpublished, (pub: LocalTrackPublication) => {
      setTiles((prev) => prev.filter((t) => t.id !== pub.trackSid));
    });

    // A raised hand only matters to whoever can act on it.
    next.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
      try {
        const message = JSON.parse(new TextDecoder().decode(payload));
        if (message?.t !== "hand" || typeof message.id !== "string") {
          return;
        }
        setHands((prev) =>
          prev.some((h) => h.identity === message.id)
            ? prev
            : [
                ...prev,
                { identity: message.id, name: message.name ?? message.id },
              ],
        );
      } catch {
        // Not our message shape. Other clients may use this channel too.
      }
    });

    next.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
      setHands((prev) => prev.filter((h) => h.identity !== p.identity));
    });

    // Being brought up on stage arrives here, and ONLY here.
    //
    // The tempting event is LocalTrackPublished, which cannot work: a watcher
    // has nothing published and is not allowed to publish, so it never fires
    // and the promoted person sits looking at "Hand is up" forever while the
    // server has already said yes. The server changes their permissions in
    // place, and this is the event that reports it.
    next.on(RoomEvent.ParticipantPermissionsChanged, () => {
      setCanPublish(next.localParticipant.permissions?.canPublish ?? false);
    });

    (async () => {
      try {
        const grant = await requestRoomToken(
          roomName,
          publisher ? "publish" : "watch",
        );
        await next.connect(grant.url, grant.token);
        if (cancelled) {
          await next.disconnect();
          return;
        }
        setRoom(next);
        setCanPublish(
          next.localParticipant.permissions?.canPublish ?? publisher,
        );
        setStatus("live");
      } catch (cause) {
        if (!cancelled) {
          setStatus("failed");
          setError(cause instanceof Error ? cause.message : "could not join");
        }
      }
    })();

    return () => {
      cancelled = true;
      void next.disconnect();
    };
  }, [roomName, publisher, attach]);

  // livekit creates the media elements, so they are placed imperatively.
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
        document.body.appendChild(tile.element);
      }
    }
  }, [tiles]);

  async function raiseHand() {
    if (!room) {
      return;
    }
    const message = {
      t: "hand",
      id: room.localParticipant.identity,
      name: room.localParticipant.name || room.localParticipant.identity,
    };
    await room.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify(message)),
      { reliable: true },
    );
    setHandUp(true);
  }

  async function bringUp(identity: string) {
    setError(null);
    try {
      await promoteParticipant(roomName, identity);
      setHands((prev) => prev.filter((h) => h.identity !== identity));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "could not bring them up",
      );
    }
  }

  async function toggleCam() {
    if (!room) {
      return;
    }
    const next = !camOn;
    await room.localParticipant.setCameraEnabled(next);
    setCamOn(next);
    // First camera-on brings the mic with it — that is what "turn my camera
    // on" means to a person joining a call. After that the two are separate,
    // so muting yourself does not kill your video.
    if (next && !micOn) {
      await room.localParticipant.setMicrophoneEnabled(true);
      setMicOn(true);
    }
  }

  async function toggleMic() {
    if (!room) {
      return;
    }
    const next = !micOn;
    await room.localParticipant.setMicrophoneEnabled(next);
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

  async function mintObsKey(protocol: "whip" | "rtmp") {
    setObsBusy(true);
    setObsNote(null);
    try {
      // Asking again rotates: the server clears every prior key for this room
      // before minting, so this button doubles as "my key leaked".
      setObsKey(await requestStreamKey(protocol));
    } catch (cause) {
      setObsNote(
        cause instanceof Error ? cause.message : "could not create a key",
      );
    } finally {
      setObsBusy(false);
    }
  }

  async function revokeObsKeys() {
    setObsBusy(true);
    setObsNote(null);
    try {
      const { revoked } = await revokeStreamKeys();
      setObsKey(null);
      setObsNote(revoked > 0 ? "Stream keys revoked." : "No keys were active.");
    } catch (cause) {
      setObsNote(cause instanceof Error ? cause.message : "could not revoke");
    } finally {
      setObsBusy(false);
    }
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setObsNote("Copied.");
    } catch {
      setObsNote("Copy failed; select the text by hand.");
    }
  }

  const videoTiles = tiles.filter((t) => t.element instanceof HTMLVideoElement);

  return (
    <section className="flex w-full shrink-0 flex-col border-neutral-800 bg-neutral-950 max-md:fixed max-md:inset-0 max-md:z-40 md:w-96 md:border-l">
      <header className="flex items-center justify-between gap-2 border-neutral-800 border-b px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="min-w-0">
          <h2 className="truncate font-semibold text-sm">
            {isLounge ? "🛋️ The Lounge" : iHost ? "Your room" : "Watching"}
          </h2>
          <p className="truncate text-neutral-500 text-xs">
            {isLounge ? "the always-on room, drop in any time" : roomName}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg border border-neutral-700 px-2.5 py-1.5 text-neutral-300 text-sm"
        >
          Leave
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-3">
        {status === "joining" ? (
          <p className="text-neutral-500 text-sm">joining…</p>
        ) : null}
        {error ? (
          <p className="mb-2 text-red-400 text-sm" role="alert">
            {error}
          </p>
        ) : null}

        <div ref={stageRef} className="grid gap-2">
          {videoTiles.length === 0 && status === "live" ? (
            <p className="text-neutral-500 text-sm">
              Nobody has a camera on yet.
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

        {iHost && !isLounge ? (
          <div className="mt-4 rounded-xl border border-neutral-800 p-3">
            <span className="font-medium text-neutral-200 text-sm">
              Raised hands
            </span>
            {hands.length === 0 ? (
              <p className="mt-1 text-neutral-500 text-xs">
                Nobody is asking to speak.
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {hands.map((hand) => (
                  <li key={hand.identity} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm">
                      ✋ {truncatePubkey(hand.name)}
                    </span>
                    <button
                      type="button"
                      onClick={() => bringUp(hand.identity)}
                      className="shrink-0 rounded-lg bg-amber-500 px-2.5 py-1 font-semibold text-neutral-950 text-xs"
                    >
                      Bring up
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {iHost && !isLounge ? (
          <div className="mt-4 rounded-xl border border-neutral-800 p-3">
            <span className="font-medium text-neutral-200 text-sm">
              Stream from OBS
            </span>
            <p className="mt-1 text-neutral-500 text-xs">
              A personal key turns OBS into your rig. Asking again rotates it,
              so an old key stops working the moment you mint a new one.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => mintObsKey("whip")}
                disabled={obsBusy}
                className="rounded-lg border border-neutral-700 px-2.5 py-1 text-neutral-300 text-xs disabled:opacity-50"
              >
                Get WHIP key
              </button>
              <button
                type="button"
                onClick={() => mintObsKey("rtmp")}
                disabled={obsBusy}
                className="rounded-lg border border-neutral-700 px-2.5 py-1 text-neutral-300 text-xs disabled:opacity-50"
              >
                Get RTMP key
              </button>
              <button
                type="button"
                onClick={revokeObsKeys}
                disabled={obsBusy}
                className="rounded-lg border border-red-900 px-2.5 py-1 text-red-400 text-xs disabled:opacity-50"
              >
                Revoke my keys
              </button>
            </div>
            {obsNote ? (
              <p className="mt-2 text-neutral-400 text-xs">{obsNote}</p>
            ) : null}
            {obsKey ? (
              <div className="mt-2 flex flex-col gap-2">
                {obsKey.protocol === "whip" && obsKey.whip_endpoint ? (
                  <ObsValue
                    label="WHIP endpoint (OBS 30+: Settings, Stream, WHIP)"
                    value={obsKey.whip_endpoint}
                    onCopy={copyText}
                  />
                ) : (
                  <>
                    {obsKey.obs_server ? (
                      <ObsValue
                        label="Server (OBS: Settings, Stream, Custom)"
                        value={obsKey.obs_server}
                        onCopy={copyText}
                      />
                    ) : null}
                    {obsKey.obs_stream_key ? (
                      <ObsValue
                        label="Stream key"
                        value={obsKey.obs_stream_key}
                        onCopy={copyText}
                      />
                    ) : null}
                  </>
                )}
                <p className="text-neutral-500 text-xs">
                  This key is a secret: anyone holding it can broadcast as you.
                  It is shown once and not stored here.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-neutral-800 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {canPublish ? (
          <>
            <button
              type="button"
              onClick={toggleCam}
              className={
                camOn
                  ? "rounded-lg border border-amber-600 bg-amber-950 px-3 py-1.5 text-amber-300 text-sm"
                  : "rounded-lg bg-amber-500 px-3 py-1.5 font-semibold text-neutral-950 text-sm"
              }
            >
              {camOn ? "Camera on" : "Camera"}
            </button>
            <button
              type="button"
              onClick={toggleMic}
              className={
                micOn
                  ? "rounded-lg border border-amber-600 bg-amber-950 px-3 py-1.5 text-amber-300 text-sm"
                  : "rounded-lg border border-neutral-700 px-3 py-1.5 text-neutral-300 text-sm"
              }
            >
              {micOn ? "Mic on" : "Mic"}
            </button>
            <button
              type="button"
              onClick={toggleScreen}
              className={
                screenOn
                  ? "rounded-lg border border-amber-600 bg-amber-950 px-3 py-1.5 text-amber-300 text-sm"
                  : "rounded-lg border border-neutral-700 px-3 py-1.5 text-neutral-300 text-sm"
              }
            >
              {screenOn ? "Sharing screen" : "Share screen"}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={raiseHand}
            disabled={handUp || status !== "live"}
            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-neutral-300 text-sm disabled:opacity-50"
          >
            {handUp ? "✋ Hand is up" : "✋ Raise hand"}
          </button>
        )}
        <span className="text-neutral-500 text-xs">
          {room?.numParticipants ?? 0} here
        </span>
      </div>
    </section>
  );
}

/** One OBS setting: labelled, selectable, copyable. */
function ObsValue({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: (value: string) => void;
}) {
  return (
    <div>
      <span className="text-neutral-500 text-xs">{label}</span>
      <div className="mt-0.5 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded border border-neutral-800 bg-neutral-900 px-1.5 py-1 text-xs">
          {value}
        </code>
        <button
          type="button"
          onClick={() => onCopy(value)}
          className="shrink-0 rounded-lg border border-neutral-700 px-2 py-1 text-neutral-300 text-xs"
        >
          Copy
        </button>
      </div>
    </div>
  );
}
