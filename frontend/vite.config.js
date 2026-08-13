import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Use "@/components/..." instead of "../../components/..."
      "@": path.resolve(__dirname, "./src"),
      // Activity plugin manifests, shared verbatim with the backend. The
      // creation wizard, the recommendation engine and the server's permission
      // check all need the same facts about a plugin; two copies would drift.
      // Plain data-only ESM, so it needs no build step on either side.
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  server: {
    port: 3000,
    // Vite refuses to serve files outside the project root by default, so the
    // sibling shared/ directory has to be allowed explicitly in dev.
    fs: { allow: [path.resolve(__dirname, ".."), path.resolve(__dirname)] },
    // Proxy API requests to backend during dev
    // So frontend at :3000 can call /api/... without CORS issues
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
      "/socket.io": {
        target: "http://localhost:5000",
        ws: true,  // proxy WebSocket connections too
      },
    },
  },
});
