/**
 * Aurora — slow-drifting gradient blobs behind a page. Pure CSS (blur +
 * keyframes), pointer-events-none, sits in any `relative` parent. The violet
 * ties into the brand; the cyan nods at the arcade.
 */
export default function Aurora() {
  return (
    <div className="absolute inset-0 overflow-hidden -z-10" aria-hidden>
      <div
        className="aurora-blob"
        style={{ top: "-10%", left: "8%", width: 420, height: 420, background: "#7c3aed" }}
      />
      <div
        className="aurora-blob"
        style={{ top: "18%", right: "5%", width: 360, height: 360, background: "#0891b2", animationDelay: "-6s" }}
      />
      <div
        className="aurora-blob"
        style={{ bottom: "-12%", left: "35%", width: 380, height: 380, background: "#c026d3", animationDelay: "-11s", opacity: 0.22 }}
      />
    </div>
  );
}
