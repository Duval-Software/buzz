import { useEffect, useRef, useState } from "react";
import { RoomEvent, type Room, type LocalParticipant } from "livekit-client";

/** Toggle only the named device. Camera controls never change microphone state. */
export async function toggleLocalDevice(
  participant: Pick<
    LocalParticipant,
    | "isCameraEnabled"
    | "isMicrophoneEnabled"
    | "isScreenShareEnabled"
    | "setCameraEnabled"
    | "setMicrophoneEnabled"
    | "setScreenShareEnabled"
  >,
  device: "camera" | "microphone" | "screen",
) {
  if (device === "camera")
    await participant.setCameraEnabled(!participant.isCameraEnabled);
  if (device === "microphone")
    await participant.setMicrophoneEnabled(!participant.isMicrophoneEnabled);
  if (device === "screen")
    await participant.setScreenShareEnabled(!participant.isScreenShareEnabled);
}

/** Independent device controls, synchronized when the browser stops a track. */
export function useLocalMedia(
  room: Room | null,
  onError: (message: string | null) => void,
) {
  const [devices, setDevices] = useState({
    camera: false,
    microphone: false,
    screen: false,
  });
  const [pending, setPending] = useState<string | null>(null);
  const changing = useRef(false);
  useEffect(() => {
    const sync = () =>
      setDevices({
        camera: room?.localParticipant.isCameraEnabled ?? false,
        microphone: room?.localParticipant.isMicrophoneEnabled ?? false,
        screen: room?.localParticipant.isScreenShareEnabled ?? false,
      });
    sync();
    const events = [
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.Disconnected,
    ] as const;
    for (const event of events) room?.on(event, sync);
    return () => {
      for (const event of events) room?.off(event, sync);
    };
  }, [room]);
  async function toggle(device: keyof typeof devices) {
    if (!room || changing.current) return;
    changing.current = true;
    setPending(device);
    onError(null);
    const participant = room.localParticipant;
    try {
      await toggleLocalDevice(participant, device);
    } catch (cause) {
      onError(
        cause instanceof Error
          ? cause.message
          : `Could not change ${device}. Check your device permissions and try again.`,
      );
    } finally {
      setDevices({
        camera: participant.isCameraEnabled,
        microphone: participant.isMicrophoneEnabled,
        screen: participant.isScreenShareEnabled,
      });
      changing.current = false;
      setPending(null);
    }
  }
  return { ...devices, pending, toggle };
}
