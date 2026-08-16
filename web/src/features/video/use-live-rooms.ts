/**
 * Who is broadcasting right now.
 *
 * stagekeeper's room list needs a short-lived bearer rather than a signature
 * per request, because this is polled: re-signing a NIP-98 event every few
 * seconds would be a lot of signing for a list that changes slowly.
 *
 * `stage-*` rooms and the Lounge are surfaced. `ch-*` rooms are the
 * per-channel calls, which already have their own entry point inside the
 * channel — listing them here would offer a second, confusing way into the
 * same call.
 */

import { useEffect, useState } from "react";
import {
  listLiveRooms,
  loungeRoom,
  requestStageSession,
  stageBaseUrl,
} from "@/features/video/stage-client";

export type LiveRoom = {
  name: string;
  participants: number;
};

const POLL_MS = 15_000;

export function useLiveRooms(enabled: boolean): {
  rooms: LiveRoom[];
  loading: boolean;
  error: string | null;
} {
  const [rooms, setRooms] = useState<LiveRoom[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !stageBaseUrl()) {
      return;
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const { session } = await requestStageSession();
        const all = await listLiveRooms(session);
        if (!live) {
          return;
        }
        const lounge = loungeRoom();
        setRooms(
          all
            .filter(
              (room) => room.name.startsWith("stage-") || room.name === lounge,
            )
            .map((room) => ({
              name: room.name,
              participants: room.num_participants,
            }))
            .sort((a, b) => b.participants - a.participants),
        );
        setError(null);
      } catch (cause) {
        if (live) {
          setError(
            cause instanceof Error ? cause.message : "could not read the stage",
          );
        }
      } finally {
        if (live) {
          setLoading(false);
          timer = setTimeout(poll, POLL_MS);
        }
      }
    }

    setLoading(true);
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [enabled]);

  return { rooms, loading, error };
}
