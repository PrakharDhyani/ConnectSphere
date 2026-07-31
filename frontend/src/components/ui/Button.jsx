export default function Button({ children, loading, variant = "primary", className = "", ...props }) {
  const styles = {
    // Violet→fuchsia gradient with a hover glow — the platform's signature CTA.
    primary: "bg-gradient-to-r from-brand-600 to-fuchsia-600 hover:shadow-[0_8px_24px_rgba(139,92,246,0.4)] text-white",
    secondary: "bg-gray-800/80 hover:bg-gray-700 text-gray-200 border border-gray-700 hover:border-gray-500",
    danger: "bg-red-600 hover:bg-red-500 text-white hover:shadow-[0_8px_24px_rgba(239,68,68,0.35)]",
    // The games' neon-cyan identity (dark text — cyan is bright enough to
    // carry it, and it reads more "arcade cabinet" than white-on-cyan).
    arcade: "bg-arcade-400 hover:bg-arcade-300 text-gray-950 font-bold shadow-[0_0_14px_rgba(34,211,238,0.5)]",
  };
  return (
    <button
      className={`px-4 py-2 rounded-lg font-medium transition-all duration-200
        hover:-translate-y-0.5 active:translate-y-0 active:scale-95
        disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0
        ${styles[variant]} ${className}`}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? "Please wait…" : children}
    </button>
  );
}
