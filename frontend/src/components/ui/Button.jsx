export default function Button({ children, loading, variant = "primary", className = "", ...props }) {
  const styles = {
    primary: "bg-brand-600 hover:bg-brand-500 text-white",
    secondary: "bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700",
    danger: "bg-red-600 hover:bg-red-500 text-white",
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
