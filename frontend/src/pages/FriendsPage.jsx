import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useFriends, searchUsers } from "@/hooks/useFriends.js";
import { useConversations } from "@/hooks/useDirectMessages.js";
import Avatar from "@/components/Avatar.jsx";
import Button from "@/components/ui/Button.jsx";
import Input from "@/components/ui/Input.jsx";
import Logo from "@/components/Logo.jsx";

const REL_LABEL = { friends: "Friends", outgoing: "Requested", incoming: "Wants to add you", none: null };

export default function FriendsPage() {
  const { friends, requests, blocked, sendRequest, accept, decline, unfriend, block, unblock } = useFriends();
  const { open, totalUnread } = useConversations();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  /**
   * "Message" opens the thread and navigates to it. Opening is idempotent
   * server-side, so pressing it for someone you already talk to lands in the
   * existing conversation rather than creating a second one.
   */
  async function messageFriend(userId) {
    const conversation = await open.mutateAsync(userId);
    navigate(`/messages?c=${conversation.id}`);
  }

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
        <span className="flex items-center gap-4">
          <Link to="/messages" className="text-sm text-gray-400 hover:text-brand-400 flex items-center gap-1.5">
            Messages
            {totalUnread > 0 && (
              <span className="min-w-[1.25rem] text-center text-[11px] font-semibold bg-brand-500 text-white rounded-full px-1.5 py-0.5">
                {totalUnread > 99 ? "99+" : totalUnread}
              </span>
            )}
          </Link>
          <Link to="/dashboard" className="text-sm text-gray-400 hover:text-brand-400">← Dashboard</Link>
        </span>
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
                ) : u.relationship === "blocked" ? (
                  // Someone I blocked. (Someone who blocked ME never appears in
                  // these results at all — an "Add" button that always failed
                  // would be a way to confirm the block by probing.)
                  <button onClick={() => unblock.mutate(u.id)} className="text-xs text-gray-500 hover:text-brand-400">
                    Blocked — unblock
                  </button>
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
                  <span className="flex items-center gap-3">
                    <Button onClick={() => messageFriend(f.id)}>Message</Button>
                    <button onClick={() => unfriend.mutate(f.id)} className="text-xs text-gray-500 hover:text-red-400">Remove</button>
                    <button
                      onClick={() => block.mutate(f.id)}
                      className="text-xs text-gray-500 hover:text-red-400"
                      // Unfriend is reversible in one click by either side;
                      // block persists and refuses future requests.
                      title="They can no longer message you or send you a request"
                    >
                      Block
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Blocked — only rendered when there is something to undo, so the page
            does not carry a permanent reminder of people you blocked. */}
        {(blocked.data?.length || 0) > 0 && (
          <section className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <h2 className="font-semibold mb-1">Blocked ({blocked.data.length})</h2>
            <p className="text-xs text-gray-500 mb-3">
              They cannot message you or send you a friend request. They are not told.
            </p>
            <ul className="space-y-2">
              {blocked.data.map((u) => (
                <li key={u.id} className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Avatar user={u} size="sm" />
                    <span className="text-sm text-gray-200">{u.name}</span>
                  </span>
                  <button onClick={() => unblock.mutate(u.id)} className="text-xs text-gray-500 hover:text-brand-400">
                    Unblock
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {outgoing.length > 0 && (
          <p className="text-xs text-gray-600">Pending sent requests: {outgoing.map((o) => o.to.name).join(", ")}</p>
        )}
      </main>
    </div>
  );
}
