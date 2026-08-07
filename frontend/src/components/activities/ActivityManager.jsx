import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api.js";
import Button from "@/components/ui/Button.jsx";
import ConfigSchemaForm from "./ConfigSchemaForm.jsx";
import { resolveInstalled } from "@shared/activities/index.js";

/**
 * Add, remove and reconfigure a room's activities. Owner-only.
 *
 * WHY THE WHOLE SET IS SENT AT ONCE rather than add/remove/patch calls: the
 * panel already holds the full list, and one write means two people toggling
 * at the same time cannot interleave into a half-applied state. It also makes
 * "Cancel" trivially correct — nothing is sent until Save.
 *
 * Reuses ConfigSchemaForm, so settings here and settings in the creation
 * wizard cannot drift: there is one renderer, driven by the manifest.
 */
export default function ActivityManager({ room, onClose }) {
  const queryClient = useQueryClient();

  // The catalogue is the source of names, icons and schemas.
  const { data: catalogue = [] } = useQuery({
    queryKey: ["activities"],
    queryFn: async () => (await api.get("/activities")).data.data.activities,
    staleTime: 5 * 60 * 1000, // manifests change on deploy, not during a session
  });

  // Current state, resolved the same way the server does (legacy rooms → all).
  const current = useMemo(() => resolveInstalled(room), [room]);

  const [selected, setSelected] = useState(() => current.filter((a) => a.enabled).map((a) => a.id));
  const [configs, setConfigs] = useState(() =>
    Object.fromEntries(current.map((a) => [a.id, a.config || {}]))
  );
  const [expanded, setExpanded] = useState(null);
  const [error, setError] = useState(null);

  const save = useMutation({
    mutationFn: async () => {
      const activities = selected.map((id) => ({ id, config: configs[id] || {} }));
      return (await api.put(`/rooms/${room.id}/activities`, { activities })).data.data;
    },
    onSuccess: () => {
      // The room query owns the tab bar; refetching is what makes the change
      // visible. Other members get it via the room:activities-changed socket
      // event (see useRoomChat) rather than polling.
      queryClient.invalidateQueries({ queryKey: ["room", room.id] });
      onClose?.();
    },
    onError: (err) => setError(err.response?.data?.error?.message || "Could not save activities."),
  });

  const toggle = (id) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const dirty =
    JSON.stringify([...selected].sort()) !==
    JSON.stringify(current.filter((a) => a.enabled).map((a) => a.id).sort());

  // Group by category so a long catalogue stays scannable.
  const grouped = useMemo(() => {
    const g = new Map();
    for (const a of catalogue) {
      if (!g.has(a.category)) g.set(a.category, []);
      g.get(a.category).push(a);
    }
    return [...g.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [catalogue]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Activities</h3>
        <span className="text-[11px] text-gray-500">{selected.length} on</span>
      </div>

      <p className="text-[11px] text-gray-500">
        Choose what this room can do. Turning something off hides its tab for everyone.
      </p>

      <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-1">
        {grouped.map(([category, items]) => (
          <div key={category}>
            <span className="block text-[10px] uppercase tracking-wide text-gray-600 mb-1">{category}</span>
            <div className="space-y-1">
              {items.map((a) => {
                const on = selected.includes(a.id);
                const hasSettings = Object.keys(a.configSchema || {}).length > 0;
                const open = expanded === a.id;
                return (
                  <div key={a.id} className="rounded-lg border border-gray-800 bg-gray-900/60">
                    <div className="flex items-center gap-2 px-2 py-1.5">
                      <button
                        type="button"
                        onClick={() => toggle(a.id)}
                        aria-pressed={on}
                        className="flex items-center gap-2 flex-1 min-w-0 text-left"
                      >
                        <span className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center text-[10px] ${
                          on ? "bg-brand-500 border-brand-500 text-white" : "border-gray-600"
                        }`}>{on ? "✓" : ""}</span>
                        <span className="shrink-0">{a.icon}</span>
                        <span className={`text-xs truncate ${on ? "text-white" : "text-gray-500"}`}>{a.name}</span>
                      </button>
                      {on && hasSettings && (
                        <button
                          type="button"
                          onClick={() => setExpanded(open ? null : a.id)}
                          className="shrink-0 text-[10px] text-gray-500 hover:text-brand-400"
                        >
                          {open ? "hide" : "settings"}
                        </button>
                      )}
                    </div>
                    {open && on && hasSettings && (
                      <div className="px-2 pb-2">
                        <ConfigSchemaForm
                          schema={a.configSchema}
                          value={configs[a.id] ?? a.defaults ?? {}}
                          onChange={(cfg) => setConfigs((c) => ({ ...c, [a.id]: cfg }))}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {selected.length === 0 && (
        <p className="text-[11px] text-amber-400/80">
          With nothing selected this becomes a chat-only room.
        </p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex items-center gap-2">
        <Button onClick={() => save.mutate()} loading={save.isPending} className="flex-1">
          Save{dirty ? " changes" : ""}
        </Button>
        {onClose && (
          <button type="button" onClick={onClose} className="text-xs text-gray-500 hover:text-gray-300 px-2">
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
