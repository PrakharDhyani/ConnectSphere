import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api.js";
import { getSocket } from "@/lib/socket.js";
import { createCallRecorder, saveBlob } from "@/lib/recorder.js";
import { useAuthStore } from "@/stores/auth.store.js";
import { useRoomChat } from "@/hooks/useRoomChat.js";
import { useMediaRoom } from "@/hooks/useMediaRoom.js";
import { useCaptions } from "@/hooks/useCaptions.js";
import { useChatUploads } from "@/hooks/useChatUploads.js";
import ChatPicker from "@/components/ChatPicker.jsx";
import ChatAttachments, { fmtBytes } from "@/components/ChatAttachments.jsx";
import VoiceComposer from "@/components/VoiceComposer.jsx";
import MessageActions from "@/components/MessageActions.jsx";
import CallBanner, { useCallState } from "@/components/CallBanner.jsx";
import { InviteToCall } from "@/components/CallInvite.jsx";
import RoomRules, { RulesPrompt, useRulesAck } from "@/components/RoomRules.jsx";
import { CaptionOverlay, CaptionControls } from "@/components/Captions.jsx";
import VideoTile from "@/components/VideoTile.jsx";
import BackgroundPicker from "@/components/BackgroundPicker.jsx";
import PollPanel from "@/components/PollPanel.jsx";
import GamesHub from "@/components/GamesHub.jsx";
import VoiceBar from "@/components/VoiceBar.jsx";
import InviteFriends from "@/components/InviteFriends.jsx";
import Button from "@/components/ui/Button.jsx";
import Logo from "@/components/Logo.jsx";
import { useRoomActivities } from "@/activities/useRoomActivities.js";
import ActivityHost from "@/activities/ActivityHost.jsx";
import ActivityManager from "@/components/activities/ActivityManager.jsx";

/**
 * Activity labels, icons and destination tabs used to live here as two
 * hand-maintained maps (ACT_LABEL / ACT_VIEW). Adding a game meant editing
 * this page — a file that has nothing to do with that game. They now come from
 * the plugin manifests via useRoomActivities(), so a new plugin appears in the
 * toast text and the tab bar by existing.
 *
 * The tab BODY is now generated too. Until Phase 6 this page imported
 * WhiteboardPanel and rendered it literally under `view === "board"`, so the
 * tab bar was manifest-driven while the content underneath was not — a second
 * board-ish plugin got a tab that rendered the whiteboard. Each non-game tab
 * now mounts <ActivityHost activityId={tab.activityId}>, which resolves the
 * component from the registry, so this page names no plugin at all.
 */

// Full literal class strings per size — Tailwind only generates classes it can
// see as complete tokens, so `w-${n}` would silently produce no CSS.
const AVATAR_SIZES = { sm: "w-7 h-7", md: "w-8 h-8", chat: "w-9 h-9" };

function Avatar({ user, size = "md", square = false }) {
  const cls = `${AVATAR_SIZES[size]} ${square ? "rounded-lg" : "rounded-full"} object-cover shrink-0`;
  return user?.avatarUrl ? (
    <img src={user.avatarUrl} alt="" className={cls} />
  ) : (
    <span className={`${cls} bg-brand-900 flex items-center justify-center text-xs font-bold text-brand-200`}>
      {user?.name?.[0]?.toUpperCase() ?? "?"}
    </span>
  );
}

// ── Slack-style chat helpers ───────────────────────────────────────────────
const fmtTime = (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function dayLabel(d) {
  const now = new Date();
  if (sameDay(d, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function DayDivider({ date }) {
  return (
    <div className="flex items-center gap-3 my-4 select-none">
      <span className="flex-1 h-px bg-gray-800" />
      <span className="text-[11px] font-medium text-gray-500 bg-gray-900 border border-gray-800 rounded-full px-3 py-0.5">
        {dayLabel(date)}
      </span>
      <span className="flex-1 h-px bg-gray-800" />
    </div>
  );
}

// Consecutive messages from the same person within 5 min collapse into one
// block (avatar + name once, then bare lines) — the Slack/Teams reading flow.
const GROUP_WINDOW_MS = 5 * 60 * 1000;

// A message that is ONLY emoji (up to 3 of them) renders big and bubble-less —
// the "jumbomoji" convention every modern chat app uses. Emoji are multi-code-
// point (skin tones, ZWJ families, variation selectors), so counting requires
// a grapheme-aware segmenter, not `.length`.
const segmenter =
  typeof Intl !== "undefined" && Intl.Segmenter
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;
const EMOJI_ONLY_RE = /^[\p{Extended_Pictographic}\p{Emoji_Component}\s]+$/u;

function isJumboEmoji(text) {
  if (!text || !EMOJI_ONLY_RE.test(text)) return false;
  const stripped = text.replace(/\s/g, "");
  if (!stripped) return false;
  const count = segmenter ? [...segmenter.segment(stripped)].length : stripped.length / 2;
  return count <= 3;
}

const fmtRec = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * ⏺ Record this call — client-side (lib/recorder.js): the whole grid + mixed
 * audio is composed locally and downloads as .webm on stop. The server only
 * relays the "recording" indicator so everyone in the room always knows.
 */
function RecordButton({ call, roomId, roomName, nameFor }) {
  const [elapsed, setElapsed] = useState(0);
  const recRef = useRef(null);
  const [recording, setRecording] = useState(false);
  const callRef = useRef(call);
  callRef.current = call;
  const nameForRef = useRef(nameFor);
  nameForRef.current = nameFor;

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setElapsed(recRef.current?.elapsedMs() ?? 0), 500);
    return () => clearInterval(t);
  }, [recording]);

  async function stop(save = true) {
    const rec = recRef.current;
    if (!rec) return;
    recRef.current = null;
    setRecording(false);
    getSocket().emit("recording:set", { roomId, on: false });
    const blob = await rec.stop();
    if (save && blob.size > 0) {
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
      saveBlob(blob, `groot-${(roomName || "call").replace(/\W+/g, "_")}-${stamp}.webm`);
    }
  }

  function start() {
    if (!window.confirm("Record this call? Everyone in the room will see a recording indicator, and the video saves to YOUR device when you stop.")) return;
    const rec = createCallRecorder({
      getSources: () => {
        const c = callRef.current;
        const tiles = [];
        if (c.localStream) tiles.push({ id: "me", stream: c.localStream, label: "You" });
        for (const r of c.remotes.filter((x) => x.source === "camera")) {
          tiles.push({ id: r.key, stream: r.stream, label: nameForRef.current(r.userId) });
        }
        const screens = [];
        if (c.screenStream) screens.push({ id: "myscreen", stream: c.screenStream, label: "Your screen" });
        for (const r of c.remotes.filter((x) => x.source === "screen")) {
          screens.push({ id: r.key, stream: r.stream, label: `${nameForRef.current(r.userId)}'s screen` });
        }
        return { tiles, screens };
      },
    });
    rec.start();
    recRef.current = rec;
    setElapsed(0);
    setRecording(true);
    getSocket().emit("recording:set", { roomId, on: true });
  }

  // Leaving the call (or the page) ends the recording — best-effort save.
  useEffect(() => {
    if (recording && !call.inCall) stop(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.inCall, recording]);
  useEffect(() => () => { if (recRef.current) stop(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return recording ? (
    <Button variant="danger" onClick={() => stop(true)} className="animate-pulse">
      ⏹ Stop · {fmtRec(elapsed)}
    </Button>
  ) : (
    <Button variant="secondary" onClick={start}>⏺ Record</Button>
  );
}

export default function RoomPage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState("");
  const [dragging, setDragging] = useState(false);
  // 👁️ When on, the NEXT photo/video you send can be opened only once.
  const [viewOnce, setViewOnce] = useState(false);
  const [editingMsg, setEditingMsg] = useState(null);   // { id, text } being edited
  const [forwarding, setForwarding] = useState(null);   // message being forwarded
  // Mobile only — on md+ the sidebar is always visible (see the aside below).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  // Drag events fire per-child-element, so a naive boolean flickers as the
  // pointer crosses the composer's children. Counting enter/leave pairs is the
  // standard fix.
  const dragDepth = useRef(0);
  // Survive refreshes: mid-game F5 used to dump you back on the room tab
  // (and out of your ludo/chess table UI). sessionStorage is per-browser-tab
  // and per-room, so each tab restores exactly where it was.
  const viewKey = `groot:view:${roomId}`;
  const [view, setViewRaw] = useState(() => {
    try { return sessionStorage.getItem(viewKey) || "room"; } catch { return "room"; }
  }); // "room" | "board" | "game" | "tab:<pluginId>" — see room-view.js
  /**
   * Which activity tabs have ever been opened this session.
   *
   * ActivityHost keeps a tab MOUNTED once opened so switching away does not
   * destroy a live game — but mounting all of them upfront would download every
   * plugin's chunk (Excalidraw alone is ~1.8 MB) just to open a room. Tracking
   * what has actually been visited gives both: nothing loads until you ask for
   * it, and nothing is thrown away once you have.
   */
  const [openedTabs, setOpenedTabs] = useState(() => new Set([view]));
  const setView = (v) => {
    setViewRaw(v);
    setOpenedTabs((prev) => (prev.has(v) ? prev : new Set(prev).add(v)));
    try { sessionStorage.setItem(viewKey, v); } catch { /* private mode */ }
  };
  const [toasts, setToasts] = useState([]);
  const [managingActivities, setManagingActivities] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [actionError, setActionError] = useState(null);
  const [sendError, setSendError] = useState(null);
  const scrollRef = useRef(null);

  const { data: room, isLoading, error } = useQuery({
    queryKey: ["room", roomId],
    queryFn: async () => (await api.get(`/rooms/${roomId}`)).data.data.room,
    retry: false,
  });

  /**
   * Tabs and activity descriptions, derived from the room's installed plugins
   * rather than hardcoded here. Called unconditionally (before any early
   * return) because it is a hook — and it tolerates `undefined` while the room
   * loads, resolving to the legacy default set.
   */
  const { tabs, describe, tabFor } = useRoomActivities(room);

  /**
   * If the tab you are looking at stops existing — the owner just removed that
   * activity — fall back to the Room tab instead of leaving you staring at a
   * blank pane. The room tab is core and can never be removed, so it is always
   * a safe destination.
   */
  useEffect(() => {
    if (!tabs.length) return;
    if (!tabs.some((t) => t.id === view)) setView("room");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, view]);

  const {
    messages, presence, typingName, error: chatError, recorders, pinned,
    sendMessage, notifyTyping, editMessage, deleteMessage, pinMessage, forwardMessage,
  } = useRoomChat(room ? roomId : null);

  const call = useMediaRoom(room ? roomId : null);
  const captions = useCaptions(room ? roomId : null, { active: call.inCall });
  const uploads = useChatUploads(roomId);
  const rulesAck = useRulesAck(roomId, room?.rulesUpdatedAt, (room?.rules?.length || 0) > 0);
  // The roster also drives the in-call "Invite" picker, so it is read here too.
  const callState = useCallState(room ? roomId : null, { inCall: call.inCall });

  // Activity notifications: someone started a call/board/game in this room.
  useEffect(() => {
    const socket = getSocket();
    const onNotify = ({ activity, name }) => {
      const id = `${Date.now()}-${Math.random()}`;
      setToasts((t) => [...t.slice(-3), { id, activity, name }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
    };
    socket.on("room:notify", onNotify);
    return () => socket.off("room:notify", onNotify);
  }, []);

  // React to room-lifecycle events pushed over the socket (see room.controller).
  useEffect(() => {
    if (!room) return;
    const socket = getSocket();
    const refresh = (p) => p.roomId === roomId && queryClient.invalidateQueries({ queryKey: ["room", roomId] });
    const onClosed = (p) => {
      if (p.roomId !== roomId) return;
      queryClient.invalidateQueries({ queryKey: ["rooms"] });
      navigate("/dashboard", { state: { message: "That room was closed by its owner." } });
    };
    // Kicked/banned: the server already forced our sockets out — leave cleanly.
    const onKicked = (p) => {
      if (p.roomId !== roomId) return;
      queryClient.invalidateQueries({ queryKey: ["rooms"] });
      // Say WHY when the owner gave a reason — usually the house rule broken.
      const why = p.reason ? ` Reason: ${p.reason}` : "";
      navigate("/dashboard", {
        state: { message: `You were removed from “${p.roomName || "the room"}” by its owner.${why}` },
      });
    };
    socket.on("room:updated", refresh);
    socket.on("room:members-changed", refresh);
    socket.on("room:rules-changed", refresh);
    // The owner changed which activities exist — everyone's tab bar must
    // follow, or a member clicks a Game tab that is no longer there.
    socket.on("room:activities-changed", refresh);
    socket.on("room:closed", onClosed);
    socket.on("room:kicked", onKicked);
    return () => {
      socket.off("room:updated", refresh);
      socket.off("room:members-changed", refresh);
      socket.off("room:rules-changed", refresh);
      socket.off("room:activities-changed", refresh);
      socket.off("room:closed", onClosed);
      socket.off("room:kicked", onKicked);
    };
  }, [room, roomId, queryClient, navigate]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typingName]);

  const renameMut = useMutation({
    mutationFn: (name) => api.patch(`/rooms/${roomId}`, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["room", roomId] });
      queryClient.invalidateQueries({ queryKey: ["rooms"] });
      setEditingName(false);
    },
    onError: (err) => setActionError(err.response?.data?.error?.message || "Rename failed"),
  });

  const leaveMut = useMutation({
    mutationFn: () => api.post(`/rooms/${roomId}/leave`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rooms"] });
      navigate("/dashboard", { state: { message: "You left the room." } });
    },
    onError: (err) => setActionError(err.response?.data?.error?.message || "Could not leave"),
  });

  const deleteMut = useMutation({
    mutationFn: () => api.delete(`/rooms/${roomId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rooms"] });
      navigate("/dashboard", { state: { message: "Room deleted." } });
    },
    onError: (err) => setActionError(err.response?.data?.error?.message || "Could not delete"),
  });

  // Copy a full shareable link (not just the code) — anyone who opens it lands
  // on /join/:code and can hop straight in, as a guest or with an account.
  async function copyLink() {
    const link = `${window.location.origin}/join/${room.code}`;
    await navigator.clipboard.writeText(link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  /**
   * Send text and/or staged files as ONE message: upload first (so a storage
   * failure aborts before anything is posted), then emit with the returned
   * attachment descriptors. On failure the draft AND the staged files are put
   * back so nothing the user typed or picked is lost.
   */
  async function handleSend(e) {
    e?.preventDefault();
    const text = draft.trim();
    const hasFiles = uploads.staged.length > 0;
    if (!text && !hasFiles) return;

    setSendError(null);
    let attachments = [];
    if (hasFiles) {
      attachments = await uploads.upload();
      if (attachments === null) return; // hook surfaced the error; keep the draft
    }

    setDraft("");
    uploads.clear();
    inputRef.current?.focus();

    // View-once applies to visual media only, and is a one-shot mode: it
    // switches itself off after sending so it can never surprise you later.
    if (viewOnce) {
      attachments = attachments.map((a) =>
        a.kind === "image" || a.kind === "video" ? { ...a, viewOnce: true } : a
      );
      setViewOnce(false);
    }

    const ack = await sendMessage(text, attachments);
    if (!ack?.ok) {
      setDraft(text);
      setSendError(ack?.error || "Message not sent"); // e.g. "Slow mode — wait 12s"
      setTimeout(() => setSendError(null), 4000);
    }
  }

  /** GIFs and stickers post immediately — no draft staging, like every chat app. */
  async function sendAttachmentNow(attachment) {
    setSendError(null);
    const ack = await sendMessage("", [attachment]);
    if (!ack?.ok) {
      setSendError(ack?.error || "Not sent");
      setTimeout(() => setSendError(null), 4000);
    }
  }

  /**
   * A finished voice note: upload the recorded blob through the ordinary
   * attachment endpoint, then send it as `kind: "audio"` with `voice: true`
   * plus the waveform captured while recording.
   */
  async function sendVoiceNote({ blob, durationMs, waveform, mimeType }) {
    setSendError(null);
    try {
      const ext = mimeType?.includes("mp4") ? "m4a" : mimeType?.includes("ogg") ? "ogg" : "webm";
      const form = new FormData();
      form.append("files", blob, `voice-note.${ext}`);
      const res = await api.post(`/rooms/${roomId}/attachments`, form);
      const uploaded = res.data.data.attachments?.[0];
      if (!uploaded?.url) throw new Error("Upload failed");

      const ack = await sendMessage("", [
        { ...uploaded, kind: "audio", voice: true, durationMs, waveform },
      ]);
      if (!ack?.ok) throw new Error(ack?.error || "Not sent");
    } catch (err) {
      setSendError(
        err.response?.status === 501
          ? "File storage isn't configured on this server"
          : err.message || "Could not send the voice note"
      );
      setTimeout(() => setSendError(null), 5000);
    }
  }

  // Paste an image straight from the clipboard (screenshots — the single most
  // common way people share an image in a chat).
  function handlePaste(e) {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) {
      e.preventDefault();
      uploads.add(files);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) uploads.add(files);
  }

  // ── Moderation actions (owner: kick/ban/unban/slow-mode · anyone: report) ──
  const modAction = async (path, body, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setActionError(null);
    try {
      await api.post(`/rooms/${roomId}${path}`, body);
      queryClient.invalidateQueries({ queryKey: ["room", roomId] });
    } catch (err) {
      setActionError(err.response?.data?.error?.message || "Action failed");
    }
  };

  /**
   * Kick/ban with a REASON, offering the house rules as the shortlist. An
   * unexplained removal feels arbitrary; "rule 3: no spoilers" does not.
   */
  const modWithReason = (action, u) => {
    const rules = room.rules || [];
    const menu = rules.length
      ? `\n\nHouse rules:\n${rules.map((r, i) => `${i + 1}. ${r}`).join("\n")}\n\nType a rule number or your own reason:`
      : "\n\nReason (optional):";
    const answer = window.prompt(
      `${action === "ban" ? "BAN" : "Kick"} ${u.name}?${menu}`,
      ""
    );
    if (answer === null) return; // cancelled
    const asNumber = Number(answer.trim());
    const reason =
      Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= rules.length
        ? `Rule ${asNumber}: ${rules[asNumber - 1]}`
        : answer.trim();
    modAction(`/${action}`, { userId: u.id, reason });
  };
  const reportUser = async (u) => {
    const reason = window.prompt(`Report ${u.name} — what happened? (optional)`);
    if (reason === null) return;
    setActionError(null);
    try {
      await api.post(`/rooms/${roomId}/report`, { userId: u.id, reason });
      setActionError("✅ Report received — thank you");
      setTimeout(() => setActionError(null), 3000);
    } catch (err) {
      setActionError(err.response?.data?.error?.message || "Report failed");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    const denied = error.response?.status === 403;
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <h1 className="text-2xl font-bold">{denied ? "Not a member" : "Room not found"}</h1>
        <p className="text-gray-400 text-sm">
          {denied
            ? "Ask the owner for the invite code and join from your dashboard."
            : "This room doesn't exist (or the link is wrong)."}
        </p>
        <Link to="/dashboard" className="text-brand-400 hover:underline text-sm">← Back to dashboard</Link>
      </div>
    );
  }

  const onlineIds = new Set(presence.map((p) => p.id));
  const nameFor = (userId) => room.members.find((m) => m.id === userId)?.name || "Guest";

  return (
    /**
     * The room is a FIXED-HEIGHT app shell, not a growing document.
     *
     * `h-screen` + `overflow-hidden` pins the page to the viewport so the
     * header, tab switcher and composer never scroll away; only the message
     * list (the one element with `overflow-y-auto`) moves. With
     * `min-h-screen` the page grew as messages arrived and the whole document
     * scrolled, taking the navbar and controls with it.
     *
     * Every flex ancestor of the scroller also needs `min-h-0`: a flex item
     * defaults to `min-height: auto`, which refuses to shrink below its
     * content, so without it the scroll container just grows instead.
     */
    <div className="h-screen overflow-hidden flex flex-col">
      {/* Persistent mic/call bar. On the Room tab the chat header already has
          Join call, so it only appears once a call is live. */}
      <VoiceBar call={call} captions={captions} hideWhenIdle={view === "room"} />

      {/* Live captions — subtitle strip visible on every tab */}
      <CaptionOverlay lines={captions.lines} />

      {/* Activity notifications */}
      <div className="fixed top-4 right-4 z-40 space-y-2 w-64">
        {toasts.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setView(tabFor(t.activity));
              setToasts((x) => x.filter((y) => y.id !== t.id));
            }}
            className="block w-full text-left bg-gray-900 border border-brand-800 rounded-xl px-4 py-2 text-sm shadow-lg hover:border-brand-500 transition-colors"
          >
            <span><b className="text-brand-300">{t.name}</b> {describe(t.activity)}</span>
            <span className="block text-xs text-gray-500">Tap to join →</span>
          </button>
        ))}
      </div>

      <header className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-3 border-b border-gray-800 gap-2">
        <Link to={me?.isGuest ? "/" : "/dashboard"} className="shrink-0"><Logo withText={false} /></Link>
        {/* Segmented pill tabs — the active tab slides its gradient in place.
            Generated from the room's installed activities: the Board tab is
            named by the whiteboard plugin's manifest, and the Game tab only
            appears if the room actually has games. Adding a plugin no longer
            means editing this list. */}
        <div className="flex items-center gap-1 p-1 rounded-full bg-gray-900/70 backdrop-blur border border-white/10">
          {tabs.map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`px-3 sm:px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-300 ${
                view === id
                  ? "bg-gradient-to-r from-brand-600 to-fuchsia-600 text-white shadow-[0_4px_14px_rgba(139,92,246,0.4)] scale-105"
                  : "text-gray-400 hover:text-white hover:bg-white/5"
              }`}
            >
              {icon} {label}
            </button>
          ))}
        </div>
        <Link to={me?.isGuest ? "/" : "/dashboard"} className="text-sm text-gray-400 hover:text-brand-400 shrink-0 hidden sm:block">
          {me?.isGuest ? "← Home" : "← Dash"}
        </Link>
      </header>

      {/* One body per activity-backed tab, resolved from the manifest rather
          than named here — this page no longer imports a single plugin.
          ActivityHost keeps a tab mounted-but-hidden once opened, so switching
          away from a live board or game does not throw its state away.
          Each body scrolls internally: the shell no longer grows, so anything
          taller than the viewport must handle its own overflow. */}
      {tabs
        .filter((t) => t.activityId)
        .map((t) => (
          <div
            key={t.id}
            className={
              view === t.id
                ? "flex-1 min-h-0 overflow-y-auto w-full max-w-7xl mx-auto px-2 sm:px-4 py-4"
                : "hidden"
            }
          >
            <ActivityHost
              activityId={t.activityId}
              roomId={roomId}
              active={view === t.id}
              mounted={openedTabs.has(t.id)}
            />
          </div>
        ))}

      {view === "game" && (
        <div className="flex-1 min-h-0 overflow-y-auto w-full max-w-7xl mx-auto px-2 sm:px-4 py-4">
          <GamesHub roomId={roomId} />
        </div>
      )}

      {/* min-h-0 lets this grid shrink inside the fixed-height shell; without
          it the chat column would push the page taller than the viewport.
          The sidebar scrolls independently so a long member list never drags
          the chat with it. */}
      <div className={`flex-1 min-h-0 max-w-6xl w-full mx-auto px-4 py-4 grid md:grid-cols-[1fr_260px] gap-4 ${view !== "room" ? "hidden" : ""}`}>
        {/* Chat column. On mobile it yields to the sidebar rather than
            splitting the fixed height between them. */}
        <section className={`${sidebarOpen ? "hidden md:flex" : "flex"} flex-col min-h-0 bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden`}>
          {/* shrink-0 on every fixed band (title row, banners, composer) so
              they keep their height and the scroller absorbs the rest. */}
          <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-gray-800 gap-3">
            {editingName ? (
              <form
                className="flex items-center gap-2 flex-1"
                onSubmit={(e) => { e.preventDefault(); if (nameDraft.trim().length >= 2) renameMut.mutate(nameDraft.trim()); }}
              >
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  maxLength={100}
                  className="flex-1 px-2 py-1 rounded bg-gray-950 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <Button type="submit" loading={renameMut.isPending}>Save</Button>
                <button type="button" onClick={() => setEditingName(false)} className="text-sm text-gray-400 hover:text-gray-200">Cancel</button>
              </form>
            ) : (
              <div className="min-w-0 flex-1">
                <h1 className="font-bold truncate flex items-center gap-2 text-sm sm:text-base">
                  <span className="truncate">{room.name}</span>
                  {room.isOwner && (
                    <button
                      onClick={() => { setNameDraft(room.name); setEditingName(true); setActionError(null); }}
                      className="text-xs text-gray-500 hover:text-brand-400"
                      title="Rename room"
                    >
                      ✎
                    </button>
                  )}
                </h1>
                <p className="text-xs text-gray-500">{presence.length} online · {room.memberCount} member{room.memberCount === 1 ? "" : "s"}</p>
              </div>
            )}
            {/* On narrow screens these buttons cannot all fit beside the room
                name — they used to squeeze the title into a vertical sliver
                and overflow the card. Copy-link and Invite collapse to icons
                below md, and the row never shrinks the title below its text. */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {/* Mobile: reach the member list / rules / room actions, which
                  live in the sidebar the one-column layout pushes off-screen. */}
              <button
                onClick={() => setSidebarOpen((o) => !o)}
                title="Members & room settings"
                className="md:hidden w-9 h-9 rounded-lg border border-gray-700 text-gray-300 hover:border-brand-500 text-sm shrink-0"
              >
                {sidebarOpen ? "✕" : "👥"}
              </button>
              {call.inCall ? (
                <Button variant="danger" onClick={call.leaveCall}>Leave</Button>
              ) : (
                <Button onClick={call.joinCall} loading={call.joining}>Join call</Button>
              )}
              {!me?.isGuest && (
                <span className="hidden sm:inline-flex"><InviteFriends roomId={roomId} /></span>
              )}
              <button
                onClick={copyLink}
                title="Copy invite link"
                className="sm:hidden w-9 h-9 rounded-lg border border-gray-700 text-gray-300 hover:border-brand-500 text-sm shrink-0"
              >
                {copied ? "✓" : "🔗"}
              </button>
              <span className="hidden sm:inline-flex">
                <Button variant="secondary" onClick={copyLink}>{copied ? "Copied ✓" : "🔗 Copy invite link"}</Button>
              </span>
            </div>
          </div>

          {/* 📞 A call is running — tell everyone who is not already in it. */}
          <CallBanner call={call} roomId={roomId} onJoin={() => call.joinCall()} />

          {/* 📜 Rules changed (or you have never read them) — read before chatting. */}
          {room.rules?.length > 0 && !rulesAck.acknowledged && (
            <RulesPrompt rules={room.rules} onAccept={rulesAck.acknowledge} />
          )}

          {/* 📌 Pinned messages — tap to jump to the original. */}
          {pinned?.length > 0 && (
            <div className="flex items-start gap-2 px-4 py-2 bg-amber-950/20 border-b border-amber-900/40">
              <span className="text-amber-400 text-sm shrink-0 pt-0.5">📌</span>
              <div className="min-w-0 flex-1 space-y-0.5">
                {pinned.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      const el = document.getElementById(`msg-${p.id}`);
                      el?.scrollIntoView({ behavior: "smooth", block: "center" });
                      el?.classList.add("ring-2", "ring-amber-500/60", "rounded-lg");
                      setTimeout(() => el?.classList.remove("ring-2", "ring-amber-500/60", "rounded-lg"), 1800);
                    }}
                    className="block w-full text-left text-[11px] text-amber-100/85 hover:text-amber-100 truncate"
                  >
                    {p.text || (p.hasAttachments ? "📎 Attachment" : "Message")}
                  </button>
                ))}
              </div>
              {room.isOwner && (
                <span className="text-[9px] text-amber-500/70 shrink-0 pt-0.5">owner can unpin</span>
              )}
            </div>
          )}

          {/* Transparency banner: EVERYONE in the room sees who is recording. */}
          {recorders?.length > 0 && (
            <div className="flex items-center justify-center gap-2 px-4 py-1.5 bg-red-950/60 border-b border-red-900 text-sm text-red-300">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              Recording in progress — {recorders.map((r) => (r.id === me?.id ? "you" : r.name)).join(", ")}
            </div>
          )}
          {/* Capped and independently scrollable: with screen shares plus a
              row of camera tiles this panel can get tall, and in a
              fixed-height shell that would squeeze the message list to
              nothing. shrink-0 stops flex from collapsing it instead. */}
          {call.inCall && (
            <div className="shrink-0 max-h-[45%] overflow-y-auto border-b border-gray-800 p-3 bg-gray-950/40">
              {/* Screen shares — big, on top */}
              {(call.screenStream || call.remotes.some((r) => r.source === "screen")) && (
                <div className="space-y-2 mb-2">
                  {call.screenStream && (
                    <VideoTile stream={call.screenStream} label="Your screen" muted big />
                  )}
                  {call.remotes
                    .filter((r) => r.source === "screen")
                    .map((r) => (
                      <VideoTile key={r.key} stream={r.stream} label={`${nameFor(r.userId)}'s screen`} big />
                    ))}
                </div>
              )}

              {/* Camera tiles */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {call.localStream && <VideoTile stream={call.localStream} label="You" muted mirror />}
                {call.remotes
                  .filter((r) => r.source === "camera")
                  .map((r) => (
                    <VideoTile key={r.key} stream={r.stream} label={nameFor(r.userId)} />
                  ))}
              </div>

              <div className="flex items-center justify-center flex-wrap gap-2 mt-3">
                <Button variant="secondary" onClick={call.toggleMic}>{call.micOn ? "🎤 Mute" : "🔇 Unmute"}</Button>
                <Button variant="secondary" onClick={call.toggleCam}>{call.camOn ? "📷 Cam off" : "🎥 Cam on"}</Button>
                {call.sharingScreen ? (
                  <Button variant="danger" onClick={call.stopScreenShare}>🛑 Stop share</Button>
                ) : (
                  <Button variant="secondary" onClick={call.startScreenShare}>🖥️ Share screen</Button>
                )}
                <BackgroundPicker call={call} />
                {/* Ring people into this call — reaches muted members. */}
                <InviteToCall
                  roomId={roomId}
                  members={room.members}
                  participants={callState.participants}
                  me={me}
                />
                <CaptionControls captions={captions} />
                <RecordButton call={call} roomId={roomId} roomName={room.name} nameFor={nameFor} />
              </div>
            </div>
          )}
          {call.error && <p className="px-5 py-2 text-sm text-red-400">{call.error}</p>}

          {/* 📊 One live poll per room — everyone sees it, votes update live. */}
          <PollPanel roomId={roomId} />

          {/* THE scroll container — the only thing in the room that moves. */}
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 py-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center gap-2 py-10">
                <span className="text-4xl">👋</span>
                <p className="text-gray-300 text-sm font-medium">It&apos;s quiet in here</p>
                <p className="text-gray-600 text-xs max-w-[240px]">
                  Say hello — chat, calls, games and the whiteboard all live in this room.
                </p>
              </div>
            )}
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const mine = m.sender?.id === me?.id;
              const time = new Date(m.createdAt);
              const newDay = !prev || !sameDay(new Date(prev.createdAt), time);
              const grouped =
                !newDay &&
                prev?.sender?.id != null &&
                prev.sender.id === m.sender?.id &&
                time - new Date(prev.createdAt) < GROUP_WINDOW_MS;
              return (
                <div key={m.id} id={`msg-${m.id}`}>
                  {newDay && <DayDivider date={time} />}
                  <div className={`group flex gap-3 px-2 rounded-lg hover:bg-white/[0.04] transition-colors ${grouped ? "py-0.5" : "mt-2.5 py-1"} ${m.pinnedAt ? "bg-amber-950/10 border-l-2 border-amber-600/60" : ""}`}>
                    {grouped ? (
                      <span className="w-9 shrink-0 text-right text-[10px] text-gray-600 tabular-nums select-none opacity-0 group-hover:opacity-100 pt-1">
                        {fmtTime(time)}
                      </span>
                    ) : (
                      <Avatar user={m.sender} size="chat" square />
                    )}
                    <div className="min-w-0 flex-1">
                      {!grouped && (
                        <p className="text-sm leading-tight">
                          <span className={`font-semibold ${mine ? "text-brand-300" : "text-white"}`}>
                            {mine ? "You" : m.sender?.name || "Guest"}
                          </span>
                          <span className="ml-2 text-[11px] text-gray-500 tabular-nums">{fmtTime(time)}</span>
                          {m.pinnedAt && <span className="ml-1.5 text-[10px] text-amber-400">📌 pinned</span>}
                        </p>
                      )}

                      {/* Forwarded breadcrumb — a forwarded message must never
                          be able to pass itself off as original. */}
                      {m.forwardedFrom && (
                        <p className="text-[10px] text-gray-500 italic mb-0.5">
                          ↪️ Forwarded from {m.forwardedFrom.senderName} in {m.forwardedFrom.roomName}
                        </p>
                      )}

                      {m.deletedAt ? (
                        <p className="text-sm text-gray-600 italic">🚫 This message was deleted</p>
                      ) : editingMsg?.id === m.id ? (
                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            const next = editingMsg.text.trim();
                            if (!next) return;
                            const ack = await editMessage(m.id, next);
                            if (!ack?.ok) { setSendError(ack?.error || "Could not edit"); setTimeout(() => setSendError(null), 4000); }
                            setEditingMsg(null);
                          }}
                          className="flex gap-1.5 items-center py-0.5"
                        >
                          <input
                            autoFocus
                            value={editingMsg.text}
                            maxLength={2000}
                            onChange={(e) => setEditingMsg({ ...editingMsg, text: e.target.value })}
                            onKeyDown={(e) => e.key === "Escape" && setEditingMsg(null)}
                            className="flex-1 px-2 py-1 rounded bg-gray-950 border border-brand-600 text-white text-sm focus:outline-none"
                          />
                          <button type="submit" className="text-xs text-brand-300 hover:text-brand-200">save</button>
                          <button type="button" onClick={() => setEditingMsg(null)} className="text-xs text-gray-500 hover:text-gray-300">cancel</button>
                        </form>
                      ) : (
                        m.text &&
                        (isJumboEmoji(m.text) ? (
                          <p className="text-4xl leading-tight py-0.5">{m.text}</p>
                        ) : (
                          <p className="text-sm text-gray-200 break-words whitespace-pre-wrap leading-relaxed">
                            {m.text}
                            {m.editedAt && <span className="ml-1.5 text-[10px] text-gray-500">(edited)</span>}
                          </p>
                        ))
                      )}
                      {!m.deletedAt && (
                        <ChatAttachments attachments={m.attachments} roomId={roomId} messageId={m.id} />
                      )}
                    </div>

                    {!m.deletedAt && (
                      <div className="shrink-0 pt-0.5">
                        <MessageActions
                          message={m}
                          isMine={mine}
                          isOwner={room.isOwner}
                          isPublicRoom={room.visibility === "public"}
                          onEdit={() => setEditingMsg({ id: m.id, text: m.text })}
                          onPin={(pin) => pinMessage(m.id, pin)}
                          onForward={() => setForwarding(m)}
                          onDelete={async (scope) => {
                            const ack = await deleteMessage(m.id, scope);
                            if (!ack?.ok) { setSendError(ack?.error || "Could not delete"); setTimeout(() => setSendError(null), 4000); }
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {typingName && (
              <div className="flex items-center gap-2 px-2 mt-2 text-xs text-gray-500">
                <span className="flex gap-1">
                  {[0, 150, 300].map((d) => (
                    <span
                      key={d}
                      className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce"
                      style={{ animationDelay: `${d}ms` }}
                    />
                  ))}
                </span>
                {typingName} is typing
              </div>
            )}
          </div>

          {chatError && <p className="px-5 py-2 text-sm text-red-400">{chatError}</p>}

          {sendError && (
            <p className="px-4 py-1 text-xs text-amber-300 bg-amber-950/40 border-t border-amber-900/50">🐢 {sendError}</p>
          )}
          <form
            onSubmit={handleSend}
            className="relative p-3 border-t border-gray-800"
            onDragEnter={(e) => { e.preventDefault(); dragDepth.current++; setDragging(true); }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={(e) => { e.preventDefault(); if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }}
            onDrop={handleDrop}
          >
            {dragging && (
              <div className="absolute inset-2 z-20 rounded-xl border-2 border-dashed border-brand-500 bg-brand-950/70 backdrop-blur-sm flex items-center justify-center pointer-events-none">
                <p className="text-sm font-medium text-brand-200">📎 Drop files to attach</p>
              </div>
            )}

            {/* staged attachments — previews before sending */}
            {uploads.staged.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {uploads.staged.map((s) => (
                  <div
                    key={s.id}
                    className="group relative rounded-lg border border-gray-700 bg-gray-950 overflow-hidden"
                  >
                    {s.kind === "image" && s.previewUrl ? (
                      <img src={s.previewUrl} alt="" className="w-16 h-16 object-cover" />
                    ) : s.kind === "video" && s.previewUrl ? (
                      <video src={s.previewUrl} muted className="w-16 h-16 object-cover" />
                    ) : (
                      <div className="w-16 h-16 flex flex-col items-center justify-center gap-0.5 px-1">
                        <span className="text-lg">📎</span>
                        <span className="text-[8px] text-gray-500 truncate w-full text-center">
                          {s.file.name}
                        </span>
                      </div>
                    )}
                    <span className="absolute bottom-0 inset-x-0 bg-black/70 text-[8px] text-gray-300 text-center py-px">
                      {fmtBytes(s.file.size)}
                    </span>
                    <button
                      type="button"
                      onClick={() => uploads.remove(s.id)}
                      title="Remove"
                      className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/80 text-gray-300 hover:bg-red-600 hover:text-white text-[10px] leading-none flex items-center justify-center"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            {uploads.uploading && (
              <div className="mb-2 h-1 rounded-full bg-gray-800 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-brand-500 to-fuchsia-500 transition-all duration-200"
                  style={{ width: `${uploads.progress}%` }}
                />
              </div>
            )}
            {uploads.error && (
              <p className="mb-2 text-xs text-amber-300">⚠️ {uploads.error}</p>
            )}
            {viewOnce && (
              <p className="mb-2 flex items-center gap-1.5 text-[11px] text-amber-300">
                👁️ View once is on — the next photo or video can be opened only once.
                <button type="button" onClick={() => setViewOnce(false)} className="underline hover:text-amber-200">
                  turn off
                </button>
              </p>
            )}

            <div className="flex items-center gap-1 rounded-xl bg-gray-950 border border-gray-700 focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500/40 transition-colors px-1.5 py-1.5">
              <ChatPicker
                roomId={roomId}
                onInsertEmoji={(glyph) => { setDraft((d) => d + glyph); inputRef.current?.focus(); }}
                onSendAttachment={sendAttachmentNow}
                disabled={uploads.uploading}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploads.uploading}
                title="Attach files, images or video"
                className="w-8 h-8 rounded-lg text-lg leading-none hover:bg-white/5 transition-colors disabled:opacity-40"
              >
                📎
              </button>
              {/* 👁️ One-time view — applies to the next photo/video you send. */}
              <button
                type="button"
                onClick={() => setViewOnce((v) => !v)}
                disabled={uploads.uploading}
                title={viewOnce ? "View once is ON — media can be opened once" : "Send the next photo/video as view-once"}
                className={`w-8 h-8 rounded-lg text-base leading-none transition-colors disabled:opacity-40 ${
                  viewOnce ? "bg-amber-500/25 text-amber-300 ring-1 ring-amber-500/50" : "hover:bg-white/5"
                }`}
              >
                {viewOnce ? "👁️" : "👁"}
              </button>
              <VoiceComposer onSend={sendVoiceNote} disabled={uploads.uploading} />
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => { uploads.add(e.target.files); e.target.value = ""; }}
              />
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => { setDraft(e.target.value); notifyTyping(); }}
                onPaste={handlePaste}
                placeholder={uploads.staged.length ? "Add a caption…" : `Message ${room.name}`}
                maxLength={2000}
                className="flex-1 bg-transparent px-2 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={(!draft.trim() && !uploads.staged.length) || uploads.uploading}
                title="Send"
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                  (draft.trim() || uploads.staged.length) && !uploads.uploading
                    ? "bg-gradient-to-r from-brand-600 to-fuchsia-600 text-white shadow-[0_2px_10px_rgba(139,92,246,0.35)] hover:brightness-110"
                    : "text-gray-600 cursor-default"
                }`}
              >
                {uploads.uploading ? (
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                ) : (
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor" aria-hidden="true">
                    <path d="M3.4 20.4 21.9 12 3.4 3.6l.01 6.53L15.3 12 3.41 13.87z" />
                  </svg>
                )}
              </button>
            </div>
          </form>
        </section>

        {/* Members + actions sidebar — scrolls on its own so a long member
            list or ban list never drags the chat column with it.
            On mobile the grid is one column, so it sits BELOW the chat and is
            collapsed behind a toggle: with a fixed-height shell an
            always-open panel would eat the message list. */}
        <aside
          className={`${sidebarOpen ? "block" : "hidden"} md:block overflow-y-auto min-h-0 bg-gray-900 border border-gray-800 rounded-2xl p-4 pb-20 space-y-4`}
        >
          <div>
            <h2 className="text-sm font-semibold text-gray-300 mb-3">Members — {room.memberCount}</h2>
            <ul className="space-y-2">
              {room.members.map((u) => {
                const online = onlineIds.has(u.id);
                return (
                  <li key={u.id} className="group flex items-center gap-2 text-sm">
                    <span className="relative">
                      <Avatar user={u} size="sm" />
                      <span className={`absolute bottom-0 right-0 w-2 h-2 rounded-full border border-gray-900 ${online ? "bg-green-500" : "bg-gray-600"}`} />
                    </span>
                    <span className="text-gray-300 truncate">{u.id === me?.id ? "You" : u.name}</span>
                    {u.isOwner && <span className="text-[10px] uppercase tracking-wide text-brand-400 border border-brand-800 rounded px-1">owner</span>}
                    {/* Moderation: owner can kick/ban; anyone can report others. */}
                    {u.id !== me?.id && (
                      <span className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {room.isOwner && !u.isOwner && (
                          <>
                            <button
                              title={`Kick ${u.name}`}
                              onClick={() => modWithReason("kick", u)}
                              className="text-xs px-1 rounded hover:bg-gray-800 text-gray-500 hover:text-amber-400"
                            >
                              🚪
                            </button>
                            <button
                              title={`Ban ${u.name}`}
                              onClick={() => modWithReason("ban", u)}
                              className="text-xs px-1 rounded hover:bg-gray-800 text-gray-500 hover:text-red-400"
                            >
                              🚫
                            </button>
                          </>
                        )}
                        <button
                          title={`Report ${u.name}`}
                          onClick={() => reportUser(u)}
                          className="text-xs px-1 rounded hover:bg-gray-800 text-gray-500 hover:text-yellow-300"
                        >
                          ⚠️
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* 📜 House rules — everyone reads, owner edits */}
          <RoomRules
            room={room}
            roomId={roomId}
            onChanged={() => queryClient.invalidateQueries({ queryKey: ["room", roomId] })}
          />

          {/* Activities (owner only) — which plugins this room has. */}
          {room.isOwner && (
            <div className="border-t border-gray-800 pt-3">
              {managingActivities ? (
                <ActivityManager room={room} onClose={() => setManagingActivities(false)} />
              ) : (
                <button
                  onClick={() => setManagingActivities(true)}
                  className="w-full flex items-center justify-between text-xs uppercase tracking-wide text-gray-500 hover:text-brand-400"
                >
                  <span>🧩 Activities</span>
                  <span className="normal-case text-[11px]">manage</span>
                </button>
              )}
            </div>
          )}

          {/* Slow mode (owner sets it; everyone sees when it's on) */}
          <div className="border-t border-gray-800 pt-3">
            <p className="text-xs uppercase tracking-wide text-gray-500 mb-1.5">
              🐢 Slow mode {room.slowModeSec > 0 && <span className="text-amber-300 normal-case">— {room.slowModeSec}s per message</span>}
            </p>
            {room.isOwner && (
              <div className="flex gap-1">
                {[0, 5, 15, 30].map((s) => (
                  <button
                    key={s}
                    onClick={() => modAction("/slowmode", { seconds: s })}
                    className={`px-2 py-0.5 rounded text-xs border ${
                      (room.slowModeSec || 0) === s
                        ? "bg-brand-600 border-brand-500 text-white"
                        : "bg-gray-800 border-gray-700 text-gray-400 hover:border-brand-500"
                    }`}
                  >
                    {s === 0 ? "Off" : `${s}s`}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Ban list (owner only) */}
          {room.isOwner && room.banned?.length > 0 && (
            <div className="border-t border-gray-800 pt-3">
              <p className="text-xs uppercase tracking-wide text-gray-500 mb-1.5">🚫 Banned</p>
              <ul className="space-y-1">
                {room.banned.map((b) => (
                  <li key={b.id} className="flex items-start justify-between gap-2 text-xs text-gray-400">
                    <span className="min-w-0">
                      <span className="block truncate">{b.name}</span>
                      {b.reason && (
                        <span className="block text-[10px] text-gray-600 truncate" title={b.reason}>
                          {b.reason}
                        </span>
                      )}
                    </span>
                    <button
                      onClick={() => modAction("/unban", { userId: b.id })}
                      className="text-gray-500 hover:text-green-400 shrink-0"
                    >
                      unban
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {actionError && <p className="text-xs text-red-400">{actionError}</p>}

          <div className="border-t border-gray-800 pt-3 space-y-2">
            {room.isOwner ? (
              <Button
                variant="danger"
                className="w-full"
                loading={deleteMut.isPending}
                onClick={() => { if (window.confirm("Delete this room and all its messages? This can't be undone.")) deleteMut.mutate(); }}
              >
                Delete room
              </Button>
            ) : (
              <Button
                variant="secondary"
                className="w-full"
                loading={leaveMut.isPending}
                onClick={() => { if (window.confirm("Leave this room?")) leaveMut.mutate(); }}
              >
                Leave room
              </Button>
            )}
            <p className="text-xs text-gray-600 pt-1">🎥 Video calls attach to this room next.</p>
          </div>
        </aside>
      </div>

      {/* ↪️ Forward picker — only offered in public rooms (server enforces it too). */}
      {forwarding && (
        <ForwardDialog
          message={forwarding}
          onClose={() => setForwarding(null)}
          onForward={async (toRoomId) => {
            const ack = await forwardMessage(forwarding.id, toRoomId);
            setForwarding(null);
            setSendError(ack?.ok ? null : ack?.error || "Could not forward");
            if (!ack?.ok) setTimeout(() => setSendError(null), 4000);
          }}
        />
      )}
    </div>
  );
}

/**
 * Pick a destination room to forward into. Lists the rooms you belong to,
 * minus the one you are in. The server re-checks both that the SOURCE is
 * public and that you are a member of the DESTINATION.
 */
function ForwardDialog({ message, onClose, onForward }) {
  const { roomId } = useParams();
  const { data: rooms, isLoading } = useQuery({
    queryKey: ["rooms"],
    queryFn: async () => (await api.get("/rooms")).data.data.rooms,
  });
  const targets = (rooms || []).filter((r) => r.id !== roomId);

  return (
    <div className="fixed inset-0 z-[110] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-xs rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-white">↪️ Forward to…</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 text-sm">✕</button>
        </div>

        <p className="px-4 py-2 text-[11px] text-gray-500 border-b border-gray-800 truncate">
          “{message.text || "📎 Attachment"}”
        </p>

        <div className="max-h-64 overflow-y-auto p-2">
          {isLoading && <p className="text-xs text-gray-500 text-center py-4">Loading rooms…</p>}
          {!isLoading && targets.length === 0 && (
            <p className="text-xs text-gray-500 text-center py-4">You&apos;re not in any other rooms.</p>
          )}
          {targets.map((r) => (
            <button
              key={r.id}
              onClick={() => onForward(r.id)}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left hover:bg-white/5 transition-colors"
            >
              <span className="text-base">{r.visibility === "public" ? "🌐" : "🔒"}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-gray-200 truncate">{r.name}</span>
                <span className="block text-[10px] text-gray-600">{r.memberCount} members</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
