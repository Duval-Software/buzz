import { ChevronDown, Sofa, Video } from "lucide-react";
import { loungeRoom, ownRoom } from "@/features/video/stage-client";
import { useLiveRooms } from "@/features/video/use-live-rooms";
import { useNames } from "@/features/profile/use-profiles";

/** Member rooms share the Studio group; publishing controls stay inside its disclosure. */
export function LiveRooms({
  selfPubkey,
  activeRoom,
  onOpen,
}: {
  selfPubkey: string;
  activeRoom: string | null;
  onOpen: (room: string) => void;
}) {
  const { rooms, loading, error } = useLiveRooms(true);
  const names = useNames();
  const mine = ownRoom(selfPubkey);
  const lounge = loungeRoom();
  const memberRooms = rooms.filter((room) => room.name !== lounge);
  const loungeNow = rooms.find((room) => room.name === lounge);
  return (
    <>
      {lounge && (
        <button
          type="button"
          className="hive-nav-link"
          aria-current={activeRoom === lounge ? "page" : undefined}
          onClick={() => onOpen(lounge)}
        >
          <Sofa size={17} aria-hidden="true" />
          <span>The Lounge</span>
          {!error && loungeNow && (
            <span className="hive-room-count">{loungeNow.participants}</span>
          )}
        </button>
      )}
      <details className="hive-member-streams">
        <summary className="hive-nav-link">
          <Video size={17} aria-hidden="true" />
          <span>Member streams</span>
          {!error && memberRooms.length > 0 && (
            <span
              className="hive-live-dot"
              aria-label="Members live"
              role="img"
            />
          )}
          <ChevronDown size={12} aria-hidden="true" />
        </summary>
        {error ? (
          <p className="hive-room-note">Room status unavailable</p>
        ) : loading ? (
          <p className="hive-room-note">Checking rooms…</p>
        ) : memberRooms.length === 0 ? (
          <p className="hive-room-note">No members live right now.</p>
        ) : (
          memberRooms.map((room) => (
            <button
              key={room.name}
              type="button"
              className="hive-nav-link"
              aria-current={activeRoom === room.name ? "page" : undefined}
              onClick={() => onOpen(room.name)}
            >
              <span className="hive-live-dot" aria-hidden="true" />
              <span className="truncate">
                {room.name === mine
                  ? "Your stream"
                  : names(room.name.replace(/^stage-/, ""))}
              </span>
              <span className="hive-room-count">{room.participants}</span>
            </button>
          ))
        )}
        <button
          type="button"
          className="hive-nav-link"
          onClick={() => onOpen(mine)}
        >
          <Video size={15} aria-hidden="true" />
          <span>
            {rooms.some((room) => room.name === mine)
              ? "Open your studio"
              : "Go live"}
          </span>
        </button>
      </details>
    </>
  );
}
