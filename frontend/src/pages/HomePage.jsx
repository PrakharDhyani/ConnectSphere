import { Link } from "react-router-dom";
import { useAuthStore } from "@/stores/auth.store.js";

export default function HomePage() {
  const status = useAuthStore((s) => s.status);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4">
      <h1 className="text-5xl font-bold text-brand-400">🌐 ConnectSphere</h1>
      <p className="text-gray-400 text-lg">Real-time video calling & collaboration</p>

      <div className="flex gap-3 mt-4">
        {status === "authed" ? (
          <Link to="/dashboard"
            className="px-5 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 font-medium transition-colors">
            Go to dashboard
          </Link>
        ) : (
          <>
            <Link to="/login"
              className="px-5 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 font-medium transition-colors">
              Log in
            </Link>
            <Link to="/register"
              className="px-5 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 font-medium transition-colors">
              Sign up
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
