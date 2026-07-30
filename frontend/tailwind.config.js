/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ConnectSphere brand palette
        brand: {
          50: "#f5f3ff",
          100: "#ede9fe",
          400: "#a78bfa",
          500: "#8b5cf6",
          600: "#7c3aed",
          900: "#4c1d95",
        },
        // Games-only identity: neon cyan/teal. Deliberately DIFFERENT from the
        // violet platform chrome but complementary to it (the classic
        // synthwave cyan↔violet pairing) — the Games tab should feel like
        // stepping into an arcade, not another settings page. Amber (built-in)
        // is the arcade's secondary accent.
        arcade: {
          100: "#cffafe",
          300: "#67e8f9",
          400: "#22d3ee",
          500: "#06b6d4",
          600: "#0891b2",
          900: "#164e63",
          950: "#083344",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
