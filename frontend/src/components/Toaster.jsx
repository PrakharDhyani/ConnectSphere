import { useNotify } from "@/stores/notify.store.js";

/** Renders the global toast queue (top-right). Rendered once, in App. */
export default function Toaster() {
  const toasts = useNotify((s) => s.toasts);
  const dismiss = useNotify((s) => s.dismiss);

  if (!toasts.length) return null;
  return (
    <div className="fixed top-4 right-4 z-50 space-y-2 w-72">
      {toasts.map((t) => (
        <div key={t.id} className="bg-gray-900 border border-brand-800 rounded-xl px-4 py-3 shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm text-gray-200">{t.title}</p>
            <button onClick={() => dismiss(t.id)} className="text-gray-500 hover:text-gray-300 text-xs shrink-0">✕</button>
          </div>
          {t.action && (
            <button
              onClick={() => {
                t.action();
                dismiss(t.id);
              }}
              className="mt-2 text-sm text-brand-300 hover:underline"
            >
              {t.actionLabel || "Open"} →
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
