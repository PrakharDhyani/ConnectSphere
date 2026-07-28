import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useFriends, searchUsers } from "@/hooks/useFriends.js";
import Avatar from "@/components/Avatar.jsx";
import Button from "@/components/ui/Button.jsx";
import Input from "@/components/ui/Input.jsx";
import Logo from "@/components/Logo.jsx";

const REL_LABEL = { friends: "Friends", outgoing: "Requested", incoming: "Wants to add you", none: null };

export default function FriendsPage() {
  const { friends, requests, sendRequest, accept, decline, unfriend } = useFriends();
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  // Debounced live search.
  useEffect(() => {
    if (q.trim().length < 2) return setResults([]);
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        setResults(await searchUsers(q));
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const incoming = requests.data?.incoming || [];
  const outgoing = requests.data?.outgoing || [];
  const list = friends.data || [];

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <Link to="/dashboard"><Logo /></Link>
        <Link to="/dashboard" className="text-sm text-gray-400 hover:text-brand-400">← Dashboard</Link>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        <h1 className="text-2xl font-bold">Friends</h1>

        {/* Add friends */}
        <section className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h2 className="font-semibold mb-3">Add a friend</h2>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email…" />
          <div className="mt-3 space-y-2">
            {searching && <p className="text-xs text-gray-500">Searching…</p>}
            {!searching && q.trim().length >= 2 && results.length === 0 && (
              <p className="text-xs text-gray-500">No one found.</p>
            )}
            {results.map((u) => (
              <div key={u.id} className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Avatar user={u} size="sm" />
                  <span className="text-sm text-gray-200">{u.name}</span>
                </span>
                {u.relationship === "none" ? (
                  <Button onClick={() => sendRequest.mutate(u.id)}>Add</Button>
                ) : (
                  <span className="text-xs text-gray-500">{REL_LABEL[u.relationship]}</span>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Incoming requests */}
        {incoming.length > 0 && (
          <section className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <h2 className="font-semibold mb-3">Requests ({incoming.length})</h2>
            <ul className="space-y-2">
              {incoming.map((r) => (
                <li key={r.id} className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Avatar user={r.from} size="sm" />
                    <span className="text-sm text-gray-200">{r.from.name}</span>
                  </span>
                  <span className="flex gap-2">
                    <Button onClick={() => accept.mutate(r.id)}>Accept</Button>
                    <Button variant="secondary" onClick={() => decline.mutate(r.id)}>Decline</Button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Friends list */}
        <section className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h2 className="font-semibold mb-3">Your friends ({list.length})</h2>
          {friends.isLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : list.length === 0 ? (
            <p className="text-sm text-gray-500">No friends yet — search above to add someone.</p>
          ) : (
            <ul className="space-y-2">
              {list.map((f) => (
                <li key={f.id} className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span className="relative">
                      <Avatar user={f} size="sm" />
                      <span className={`absolute bottom-0 right-0 w-2 h-2 rounded-full border border-gray-900 ${f.online ? "bg-green-500" : "bg-gray-600"}`} />
                    </span>
                    <span className="text-sm text-gray-200">{f.name}</span>
                    <span className="text-xs text-gray-500">{f.online ? "online" : "offline"}</span>
                  </span>
                  <button onClick={() => unfriend.mutate(f.id)} className="text-xs text-gray-500 hover:text-red-400">Remove</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {outgoing.length > 0 && (
          <p className="text-xs text-gray-600">Pending sent requests: {outgoing.map((o) => o.to.name).join(", ")}</p>
        )}
      </main>
    </div>
  );
}
