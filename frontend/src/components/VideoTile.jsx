import { useEffect, useRef } from "react";

/**
 * Renders one MediaStream. A <video> can't take a stream via a prop — you must
 * imperatively set `el.srcObject`, so we do it in an effect keyed on the stream.
 * - local tile: muted (never play your own mic → no echo) + mirrored selfie
 * - big (screen share): object-contain so the whole screen shows, not cropped
 */
export default function VideoTile({ stream, label, muted = false, mirror = false, big = false }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current && stream) ref.current.srcObject = stream;
  }, [stream]);

  return (
    <div className={`relative bg-black rounded-xl overflow-hidden ${big ? "max-h-[55vh]" : "aspect-video"}`}>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className={`w-full ${big ? "h-auto max-h-[55vh] object-contain" : "h-full object-cover"} ${mirror ? "scale-x-[-1]" : ""}`}
      />
      <span className="absolute bottom-2 left-2 text-xs bg-black/60 text-white px-2 py-0.5 rounded">
        {label}
      </span>
    </div>
  );
}
