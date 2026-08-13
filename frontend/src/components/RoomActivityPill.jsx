/**
 * The live "what's happening" line on a room card.
 *
 * "2 people are playing Ludo" is an invitation; "3 members" is a filing
 * cabinet. This renders the former, and rotates when a room has several things
 * going on at once so a card can advertise all of them in the space of one line.
 *
 * WHY ROTATE RATHER THAN STACK
 * A room can genuinely have three activities running (a call, a whiteboard, a
 * game). Stacking them makes every card a different height and pushes the room
 * list around as people come and go — motion that has nothing to do with what
 * the user is looking at. One line that cycles keeps the layout still.
 */
import { useEffect, useState } from "react";

/** Pause between rotations. Slow enough to read, fast enough to notice. */
const ROTATE_MS = 3200;

export default function RoomActivityPill({ activity }) {
  const items = activity?.activities || [];
  const [index, setIndex] = useState(0);

  // Rotate only when there is something to rotate through — a lone pill must
  // not run a timer for no reason.
  useEffect(() => {
    if (items.length < 2) {
      setIndex(0);
      return undefined;
    }
    const t = setInterval(() => setIndex((i) => (i + 1) % items.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [items.length]);

  // A room can lose activities while we are pointing at one of them.
  const safeIndex = items.length ? index % items.length : 0;
  const current = items[safeIndex];

  if (!current) {
    // Nothing happening, but people are present — still worth saying, because
    // "empty" and "three people sitting quietly" are different invitations.
    if (activity?.present > 0) {
      return (
        <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-400">
          <LiveDot />
          {activity.present} {activity.present === 1 ? "person" : "people"} here
        </span>
      );
    }
    return null;
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] text-brand-300 bg-brand-500/10
                 border border-brand-500/20 rounded-full px-2 py-0.5 max-w-full"
      // The rotation is a visual nicety; a screen reader should hear the full
      // picture at once rather than a third of it at a random moment.
      title={items.map((a) => a.label).join(" · ")}
    >
      <LiveDot />
      <span aria-hidden="true">{current.icon}</span>
      {/* `key` forces a remount per rotation so the fade actually replays. */}
      <span key={current.id} className="truncate anim-fade-in">{current.label}</span>
      {items.length > 1 && (
        <span className="text-brand-400/60 shrink-0" aria-hidden="true">
          +{items.length - 1}
        </span>
      )}
    </span>
  );
}

/** A quietly pulsing dot — the only thing on the card that says "right now". */
function LiveDot() {
  return (
    <span className="relative flex w-1.5 h-1.5 shrink-0" aria-hidden="true">
      <span className="absolute inline-flex w-full h-full rounded-full bg-green-400 opacity-70 animate-ping" />
      <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-green-400" />
    </span>
  );
}
