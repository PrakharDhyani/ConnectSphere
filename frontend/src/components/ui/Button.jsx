export default function Button({ children, loading, variant = "primary", className = "", ...props }) {
  const styles = {
    primary: "bg-brand-600 hover:bg-brand-500 text-white",
    secondary: "bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700",
    danger: "bg-red-600 hover:bg-red-500 text-white",
    // The games' neon-cyan identity (dark text — cyan is bright enough to
    // carry it, and it reads more "arcade cabinet" than white-on-cyan).
    arcade: "bg-arcade-400 hover:bg-arcade-300 text-gray-950 font-bold shadow-[0_0_14px_rgba(34,211,238,0.5)]",
  };
  return (
    <button
      className={`px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50
        disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? "Please wait…" : children}
    </button>
  );
}
