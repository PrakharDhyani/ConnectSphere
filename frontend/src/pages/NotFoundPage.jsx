import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4">
      <h1 className="text-6xl font-bold text-brand-400">404</h1>
      <p className="text-gray-400 text-lg">This page doesn&apos;t exist.</p>
      <Link
        to="/"
        className="px-4 py-2 bg-brand-600 hover:bg-brand-500 rounded-lg text-sm font-medium transition-colors"
      >
        Back to home
      </Link>
    </div>
  );
}
