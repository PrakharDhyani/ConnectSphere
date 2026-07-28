// The Groot brand mark: an original sprout mascot (see public/logo.svg) plus
// the wordmark. Used in every header so the logo stays consistent — swap the
// SVG once and it changes everywhere.
export default function Logo({ withText = true, className = "" }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <img src="/logo.svg" alt="Groot" className="h-7 w-7" />
      {withText && <span className="text-xl font-bold text-brand-400">Groot</span>}
    </span>
  );
}
