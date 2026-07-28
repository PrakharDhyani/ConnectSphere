import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/auth.store.js";
import Button from "@/components/ui/Button.jsx";
import Logo from "@/components/Logo.jsx";

const LIVE_FEATURES = [
  {
    icon: "🎥",
    title: "HD group video calls",
    body: "Real-time audio & video powered by a mediasoup WebRTC SFU — every person uploads their stream once and the server fans it out, so calls stay smooth as the room grows.",
  },
  {
    icon: "💬",
    title: "Live chat in every room",
    body: "Instant messaging over WebSockets with presence (see who's online), typing indicators, and durable history you can scroll back through after a reload.",
  },
  {
    icon: "🔗",
    title: "Rooms & one-click invites",
    body: "Spin up a room in a second and share a single link. Anyone with the link is in — no downloads, no accounts required to join.",
  },
  {
    icon: "🙂",
    title: "Profiles & avatars",
    body: "Claim your name and upload an avatar (stored in S3-compatible object storage). Sign in with email or Google in one tap.",
  },
  {
    icon: "🔐",
    title: "Secure by design",
    body: "JWT sessions with silent refresh, rotating refresh tokens, hashed passwords, email verification, and password reset — the boring stuff done right.",
  },
  {
    icon: "⚡",
    title: "Zero install",
    body: "Everything runs in a browser tab. Open a link and you're in the call — desktop or mobile, no app store detour.",
  },
];

const COMING_SOON = [
  { icon: "✨", title: "AR filters", body: "Snapchat-style face filters & background effects, rendered in-browser with TensorFlow.js." },
  { icon: "🖊️", title: "Collaborative whiteboard", body: "A shared Figma-style canvas to sketch, diagram, and brainstorm together, live." },
  { icon: "🎮", title: "In-call mini-games", body: "Break the ice with quick multiplayer games without leaving the call." },
  { icon: "⏺️", title: "Cloud recording", body: "Record a session and get a shareable file — processed through a Kafka pipeline." },
];

const STEPS = [
  { n: "1", title: "Create a room", body: "One click gives you a room and a shareable link." },
  { n: "2", title: "Share the link", body: "Send it to anyone. They join as a guest or with an account." },
  { n: "3", title: "Talk & collaborate", body: "Video, voice, chat — with filters, whiteboard and games on the way." },
];

export default function HomePage() {
  const navigate = useNavigate();
  const status = useAuthStore((s) => s.status);
  const authed = status === "authed";
  const [joinCode, setJoinCode] = useState("");

  function handleJoin(e) {
    e.preventDefault();
    const code = joinCode.trim().toLowerCase();
    if (code) navigate(`/join/${code}`);
  }

  return (
    <div className="min-h-screen">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <Logo />
        <div className="flex items-center gap-3">
          {authed ? (
            <Link to="/dashboard"><Button>Dashboard</Button></Link>
          ) : (
            <>
              <Link to="/login" className="text-sm text-gray-300 hover:text-white px-3 py-2">Log in</Link>
              <Link to="/register"><Button>Sign up free</Button></Link>
            </>
          )}
        </div>
      </nav>

      {/* Hero */}
      <header className="max-w-4xl mx-auto px-6 pt-16 pb-20 text-center">
        <span className="inline-block text-xs uppercase tracking-widest text-brand-300 bg-brand-950/60 border border-brand-900 rounded-full px-3 py-1 mb-6">
          Video · Chat · Collaboration — in one tab
        </span>
        <h1 className="text-4xl sm:text-6xl font-extrabold leading-tight">
          Meet, talk, and create —{" "}
          <span className="text-brand-400">all in your browser.</span>
        </h1>
        <p className="mt-6 text-lg text-gray-400 max-w-2xl mx-auto">
          Groot is a real-time video calling &amp; collaboration platform: think Zoom&apos;s calls,
          Snapchat&apos;s filters, a Figma-style whiteboard, and in-call mini-games — combined into a
          single link you can share with anyone.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          {authed ? (
            <Link to="/dashboard"><Button className="px-6 py-3 text-base">Go to your dashboard</Button></Link>
          ) : (
            <Link to="/register"><Button className="px-6 py-3 text-base">Get started — it&apos;s free</Button></Link>
          )}
          <a href="#how" className="px-6 py-3 text-base rounded-lg border border-gray-700 text-gray-200 hover:bg-gray-800 transition-colors">
            See how it works
          </a>
        </div>

        {/* Join-as-guest strip */}
        <form onSubmit={handleJoin} className="mt-10 flex items-center justify-center gap-2 max-w-md mx-auto">
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder="Have an invite code? Enter it to join"
            className="flex-1 px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <Button type="submit" variant="secondary" disabled={!joinCode.trim()}>Join</Button>
        </form>
        <p className="mt-2 text-xs text-gray-600">No account needed to join a meeting.</p>
      </header>

      {/* What is it */}
      <section className="max-w-4xl mx-auto px-6 py-12 border-t border-gray-900">
        <h2 className="text-2xl font-bold text-center">One tab. Everything you need to connect.</h2>
        <p className="mt-4 text-gray-400 text-center max-w-2xl mx-auto">
          Most tools make you choose: a call app here, a chat app there, a whiteboard somewhere else.
          Groot puts real-time video, messaging, and collaboration behind a single shareable
          room — fast, browser-native, and built on the same WebRTC technology the big platforms use.
        </p>
      </section>

      {/* Live features */}
      <section className="max-w-6xl mx-auto px-6 py-12">
        <div className="flex items-center gap-3 mb-8">
          <h2 className="text-2xl font-bold">Live today</h2>
          <span className="text-xs uppercase tracking-wide text-green-400 bg-green-950/50 border border-green-900 rounded-full px-2 py-0.5">Shipping now</span>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {LIVE_FEATURES.map((f) => (
            <div key={f.title} className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <div className="text-3xl">{f.icon}</div>
              <h3 className="mt-3 font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-gray-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="max-w-5xl mx-auto px-6 py-12 border-t border-gray-900">
        <h2 className="text-2xl font-bold text-center mb-10">How it works</h2>
        <div className="grid sm:grid-cols-3 gap-6">
          {STEPS.map((s) => (
            <div key={s.n} className="text-center">
              <div className="w-12 h-12 mx-auto rounded-full bg-brand-600 flex items-center justify-center text-xl font-bold">{s.n}</div>
              <h3 className="mt-4 font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm text-gray-400">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Coming soon */}
      <section className="max-w-6xl mx-auto px-6 py-12 border-t border-gray-900">
        <div className="flex items-center gap-3 mb-8">
          <h2 className="text-2xl font-bold">On the roadmap</h2>
          <span className="text-xs uppercase tracking-wide text-brand-300 bg-brand-950/60 border border-brand-900 rounded-full px-2 py-0.5">Coming soon</span>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {COMING_SOON.map((f) => (
            <div key={f.title} className="bg-gray-900/60 border border-dashed border-gray-800 rounded-2xl p-5">
              <div className="text-3xl">{f.icon}</div>
              <h3 className="mt-3 font-semibold text-gray-200">{f.title}</h3>
              <p className="mt-2 text-sm text-gray-500">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-4xl mx-auto px-6 py-20 text-center">
        <h2 className="text-3xl font-bold">Ready to jump in?</h2>
        <p className="mt-3 text-gray-400">Create a room and share the link — your first call is seconds away.</p>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          {authed ? (
            <Link to="/dashboard"><Button className="px-6 py-3 text-base">Open dashboard</Button></Link>
          ) : (
            <>
              <Link to="/register"><Button className="px-6 py-3 text-base">Create your free account</Button></Link>
              <Link to="/login" className="px-6 py-3 text-base rounded-lg border border-gray-700 text-gray-200 hover:bg-gray-800 transition-colors">Log in</Link>
            </>
          )}
        </div>
      </section>

      <footer className="border-t border-gray-900 py-8 text-center text-sm text-gray-600">
        Groot — real-time video & collaboration. Built with the MERN stack, WebRTC (mediasoup), Socket.io & Redis.
      </footer>
    </div>
  );
}
