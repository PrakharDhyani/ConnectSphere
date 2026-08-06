import Button from "@/components/ui/Button.jsx";
import { CaptionControls } from "@/components/Captions.jsx";

/**
 * A compact, always-visible call bar so you can talk (mic) from ANY tab —
 * Room, Whiteboard, or Game. Join voice-only (no camera) for a quick chat while
 * playing, or add video. Mirrors the shared call state from useMediaRoom.
 */
export default function VoiceBar({ call, captions, hideWhenIdle = false }) {
  const {
    inCall, joining, micOn, hasVideo, camOn, peerCount,
    joinVoice, joinCall, leaveCall, toggleMic, toggleCam,
  } = call;

  /**
   * The Room tab already has a "Join call" button in the chat header, so the
   * floating bar is redundant there while idle — and on a phone it sat on top
   * of the message composer. `hideWhenIdle` lets that tab suppress it until a
   * call is actually running, when the mic/leave controls DO earn their place.
   * Board and Game keep it always, since they have no other call affordance.
   */
  if (hideWhenIdle && !inCall) return null;

  /**
   * Docked bottom-right rather than centred on the right edge: vertically
   * centred it sat on top of the room sidebar and covered the room actions
   * (Delete/Leave room).
   *
   * Horizontal when idle (two wide buttons side by side), vertical in-call
   * (a column of icon buttons), so it stays compact in both states.
   */
  return (
    <div className={`fixed right-3 bottom-3 z-30 flex items-center gap-2 bg-gray-900/95 border border-gray-800 rounded-2xl px-3 py-2.5 shadow-lg backdrop-blur ${inCall ? "flex-col" : "flex-row"}`}>
      {!inCall ? (
        <>
          <Button onClick={() => joinVoice()} loading={joining}>🎙️ Join voice</Button>
          <Button variant="secondary" onClick={() => joinCall()} loading={joining}>📹 Video</Button>
        </>
      ) : (
        <>
          <span className="flex items-center gap-1 text-xs text-green-400 px-1">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> {peerCount + 1} in call
          </span>
          <button
            onClick={toggleMic}
            title={micOn ? "Mute" : "Unmute"}
            className={`w-9 h-9 rounded-full flex items-center justify-center ${micOn ? "bg-gray-800 hover:bg-gray-700" : "bg-red-600"}`}
          >
            {micOn ? "🎤" : "🔇"}
          </button>
          {hasVideo && (
            <button onClick={toggleCam} title="Camera" className="w-9 h-9 rounded-full bg-gray-800 hover:bg-gray-700 flex items-center justify-center">
              {camOn ? "📷" : "🚫"}
            </button>
          )}
          {captions && <CaptionControls captions={captions} compact />}
          <button onClick={leaveCall} title="Leave call" className="w-9 h-9 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center">
            📴
          </button>
        </>
      )}
    </div>
  );
}
