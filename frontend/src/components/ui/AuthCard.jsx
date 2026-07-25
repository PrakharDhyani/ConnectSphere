/** Shared centered-card layout for all auth pages (login, register, reset…). */
export default function AuthCard({ title, subtitle, children }) {
  return (
    <div className="flex items-center justify-center min-h-screen px-4">
      <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl p-8">
        <h1 className="text-2xl font-bold text-white">{title}</h1>
        {subtitle && <p className="text-gray-400 mt-1 text-sm">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
