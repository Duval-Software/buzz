import { loungeRoom, ownRoom } from "@/features/video/stage-client";
import { useLiveRooms } from "@/features/video/use-live-rooms";

/**
 * Going live, and seeing who else is.
 *
 * The Lounge sits first and is ALWAYS visible, even empty. It is the one room
 * that works like a Discord voice channel: nobody hosts it, you just walk in —
 * and a drop-in room that only appears once somebody is already inside defeats
 * the reason it exists, because nobody is ever willing to be first.
 *
 * Your own room needs a way in even when it is empty too — a list of live
 * rooms alone leaves no way to become one, which is how raising a hand ends up
 * with nowhere to raise it.
 *
 * Per-channel calls are reached from inside their channel; showing them twice
 * would be two doors into one room.
 */
export function LiveRooms({
  selfPubkey,
  activeRoom,
  onOpen,
}: {
  selfPubkey: string;
  activeRoom: string | null;
  onOpen: (room: string) => void;
}) {
  const { rooms } = useLiveRooms(true);
  const mine = ownRoom(selfPubkey);
  const lounge = loungeRoom();
  const others = rooms.filter(
    (room) => room.name !== mine && room.name !== lounge,
  );
  const myRoom = rooms.find((room) => room.name === mine);
  const loungeNow = rooms.find((room) => room.name === lounge);

  return (
    <div className="border-neutral-800 border-t px-2 py-2">
      {lounge ? (
        <button
          type="button"
          onClick={() => onOpen(lounge)}
          className={
            activeRoom === lounge
              ? "w-full rounded bg-neutral-800 px-2 py-2 text-left text-neutral-50 text-sm md:py-1.5"
              : "w-full rounded px-2 py-2 text-left text-neutral-300 text-sm hover:bg-neutral-900 md:py-1.5"
          }
        >
          <span className="flex items-center justify-between gap-2">
            <span className="truncate">🛋️ The Lounge</span>
            <span className="shrink-0 text-neutral-500 text-xs">
              {loungeNow ? loungeNow.participants : "empty"}
            </span>
          </span>
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => onOpen(mine)}
        className={
          activeRoom === mine
            ? "mt-1 w-full rounded bg-neutral-800 px-2 py-2 text-left text-neutral-50 text-sm md:py-1.5"
            : "mt-1 w-full rounded px-2 py-2 text-left text-neutral-300 text-sm hover:bg-neutral-900 md:py-1.5"
        }
      >
        <span className="flex items-center justify-between gap-2">
          <span className="truncate">
            <span className="text-red-500">●</span>{" "}
            {myRoom ? "Your room is live" : "Go live"}
          </span>
          {myRoom ? (
            <span className="shrink-0 text-neutral-500 text-xs">
              {myRoom.participants}
            </span>
          ) : null}
        </span>
      </button>

      {others.length > 0 ? (
        <>
          <span className="mt-2 block px-2 text-neutral-500 text-xs">
            Live now
          </span>
          {others.map((room) => (
            <button
              key={room.name}
              type="button"
              onClick={() => onOpen(room.name)}
              className={
                room.name === activeRoom
                  ? "mt-1 w-full rounded bg-neutral-800 px-2 py-2 text-left text-neutral-50 text-sm md:py-1.5"
                  : "mt-1 w-full rounded px-2 py-2 text-left text-neutral-400 text-sm hover:bg-neutral-900 md:py-1.5"
              }
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate">
                  <span className="text-red-500">●</span>{" "}
                  {room.name.replace(/^stage-/, "")}
                </span>
                <span className="shrink-0 text-neutral-500 text-xs">
                  {room.participants}
                </span>
              </span>
            </button>
          ))}
        </>
      ) : null}
    </div>
  );
}
