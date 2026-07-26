import { useState } from "react";
import { Link } from "react-router-dom";
import { useFriends } from "@/hooks/useFriends.js";
import { api } from "@/lib/api.js";
import { useNotify } from "@/stores/notify.store.js";
import Avatar from "@/components/Avatar.jsx";
import Button from "@/components/ui/Button.jsx";

/** Dropdown to invite a friend into the current room (real-time). */
export default function InviteFriends({ roomId }) {
  const [open, setOpen] = useState(false);
  const [invited, setInvited] = useState({});
  const { friends } = useFriends();
  const push = useNotify((s) => s.push);

  async function invite(f) {
    try {
      await api.post("/friends/invite", { friendId: f.id, roomId });
      setInvited((v) => ({ ...v, [f.id]: true }));
      push({ title: `Invited ${f.name}`, duration: 3000 });
    } catch {
      push({ title: `Could not invite ${f.name}`, duration: 3000 });
    }
  }

  const list = friends.data || [];
  return (
    <div className="relative">
      <Button variant="secondary" onClick={() => setOpen((o) => !o)}>👥 Invite</Button>
      {open && (
        <div className="absolute right-0 mt-2 w-64 bg-gray-900 border border-gray-800 rounded-xl p-3 z-40 shadow-lg">
          <p className="text-xs text-gray-500 mb-2">Invite a friend to this room</p>
          {list.length === 0 ? (
            <p className="text-xs text-gray-500">
              No friends yet.{" "}
              <Link to="/friends" className="text-brand-400 hover:underline">Add some →</Link>
            </p>
          ) : (
            <ul className="space-y-1 max-h-60 overflow-y-auto">
              {list.map((f) => (
                <li key={f.id} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 truncate">
                    <span className="relative">
                      <Avatar user={f} size="sm" />
                      {f.online && <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-green-500 border border-gray-900" />}
                    </span>
                    {f.name}
                  </span>
                  {invited[f.id] ? (
                    <span className="text-xs text-green-400">Sent ✓</span>
                  ) : (
                    <button onClick={() => invite(f)} className="text-xs text-brand-300 hover:underline">Invite</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
