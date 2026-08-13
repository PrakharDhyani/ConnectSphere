import Aurora from "@/components/Aurora.jsx";

/** Shared centered-card layout for all auth pages (login, register, reset…). */
export default function AuthCard({ title, subtitle, children }) {
  return (
    <div className="relative flex items-center justify-center min-h-screen px-4 overflow-hidden">
      <Aurora />
      <div className="w-full max-w-md glass-card p-8 anim-fade-up shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
        <h1 className="text-2xl font-bold gradient-text inline-block">{title}</h1>
        {subtitle && <p className="text-gray-400 mt-1 text-sm">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
