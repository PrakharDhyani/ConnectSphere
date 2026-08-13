/**
 * Live captions — the "how do I include my grandmother" feature.
 *
 * Architecture note: the mediasoup SFU forwards ENCRYPTED audio, so the server
 * can't transcribe anyone. Each speaker's own browser runs the Web Speech API
 * on their mic and relays text via `caption:say`; everyone else receives
 * `caption:new`. Costs nothing, needs no model hosting — the trade-off is that
 * captions only appear for speakers who turned them on (and Web Speech is
 * Chrome/Edge; Firefox viewers still SEE captions, they just can't produce
 * them).
 *
 * Translation: viewers pick a target language; final lines are run through the
 * backend's /translate proxy (LibreTranslate). Interim lines stay untranslated
 * — they change too fast to be worth a round-trip.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api.js";
import { connectSocket, getSocket } from "@/lib/socket.js";
import { useAuthStore } from "@/stores/auth.store.js";

const SR = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
export const captionsSupported = Boolean(SR);

const LINE_TTL_MS = 7000;
const pref = (key, fallback) => {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
};

export function useCaptions(roomId, { active } = {}) {
  const me = useAuthStore((s) => s.user);
  const [micCaptioning, setMicCaptioning] = useState(false);
  const [lines, setLines] = useState([]); // [{userId, name, text, orig, interim, at}]
  const [error, setError] = useState(null);
  const [speakLang, setSpeakLangRaw] = useState(() => pref("groot:cc:speak", navigator.language || "en-US"));
  const [targetLang, setTargetLangRaw] = useState(() => pref("groot:cc:target", "")); // "" = don't translate

  const recRef = useRef(null);
  const wantMicRef = useRef(false);
  const lineMap = useRef(new Map()); // userId → line (one live line per speaker)
  const translateCache = useRef(new Map());
  const targetRef = useRef(targetLang);
  targetRef.current = targetLang;

  const setSpeakLang = (v) => { setSpeakLangRaw(v); try { localStorage.setItem("groot:cc:speak", v); } catch { /* private mode */ } };
  const setTargetLang = (v) => { setTargetLangRaw(v); try { localStorage.setItem("groot:cc:target", v); } catch { /* private mode */ } };

  const syncLines = useCallback(() => {
    setLines([...lineMap.current.values()].sort((a, b) => a.at - b.at));
  }, []);

  const upsertLine = useCallback(
    (line) => {
      lineMap.current.set(line.userId, line);
      syncLines();
    },
    [syncLines]
  );

  // A caption that stopped updating fades out — sweep on a coarse tick.
  useEffect(() => {
    const t = setInterval(() => {
      const cutoff = Date.now() - LINE_TTL_MS;
      let changed = false;
      for (const [k, v] of lineMap.current) {
        if (v.at < cutoff) { lineMap.current.delete(k); changed = true; }
      }
      if (changed) syncLines();
    }, 1000);
    return () => clearInterval(t);
  }, [syncLines]);

  const translate = useCallback(async (text, sourceLang) => {
    const target = targetRef.current;
    if (!target) return null;
    if ((sourceLang || "").toLowerCase().startsWith(target)) return null;
    const cacheKey = `${target}:${text}`;
    if (translateCache.current.has(cacheKey)) return translateCache.current.get(cacheKey);
    try {
      const res = await api.post("/translate", { q: text, source: (sourceLang || "auto").slice(0, 2), target });
      const out = res.data?.data?.translatedText || null;
      if (translateCache.current.size > 300) translateCache.current.clear();
      translateCache.current.set(cacheKey, out);
      return out;
    } catch {
      return null; // not configured / down → show the original, never break captions
    }
  }, []);

  // ── Receiving everyone else's captions ──
  useEffect(() => {
    if (!roomId) return;
    const socket = connectSocket();
    const onNew = async (p) => {
      if (p.roomId !== roomId) return;
      upsertLine({ userId: p.userId, name: p.name, text: p.text, orig: null, interim: p.interim, at: Date.now() });
      if (!p.interim) {
        const translated = await translate(p.text, p.lang);
        // Only overwrite if this speaker's line is still the same utterance.
        const current = lineMap.current.get(p.userId);
        if (translated && current && current.text === p.text) {
          upsertLine({ ...current, text: translated, orig: p.text, at: Date.now() });
        }
      }
    };
    socket.on("caption:new", onNew);
    return () => socket.off("caption:new", onNew);
  }, [roomId, upsertLine, translate]);

  // ── Producing my own captions ──
  const stopMic = useCallback(() => {
    wantMicRef.current = false;
    try { recRef.current?.stop(); } catch { /* already stopped */ }
    recRef.current = null;
    setMicCaptioning(false);
  }, []);

  const startMic = useCallback(() => {
    if (!SR || recRef.current || !roomId) return;
    setError(null);
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = speakLang;

    let lastInterimAt = 0;
    const send = (text, interim) => {
      if (!text) return;
      getSocket().emit("caption:say", { roomId, text, interim, lang: speakLang });
      // socket.to() skips the sender, so echo my own line locally.
      upsertLine({ userId: me?.id || "me", name: "You", text, orig: null, interim, at: Date.now() });
    };

    rec.onresult = (e) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript.trim();
        if (!text) continue;
        if (e.results[i].isFinal) send(text, false);
        else interimText += (interimText ? " " : "") + text;
      }
      if (interimText && Date.now() - lastInterimAt > 350) {
        lastInterimAt = Date.now();
        send(interimText, true);
      }
    };
    // Chrome stops the recognizer after a stretch of silence — restart until
    // the user actually turns captions off.
    rec.onend = () => {
      if (wantMicRef.current) { try { rec.start(); } catch { /* tab backgrounded */ } }
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setError("Microphone access for captions was blocked");
        stopMic();
      }
    };

    wantMicRef.current = true;
    recRef.current = rec;
    try {
      rec.start();
      setMicCaptioning(true);
    } catch {
      setError("Could not start speech recognition");
      recRef.current = null;
      wantMicRef.current = false;
    }
  }, [roomId, speakLang, me?.id, upsertLine, stopMic]);

  // Language change while live → restart the recognizer in the new language.
  useEffect(() => {
    if (recRef.current && wantMicRef.current) {
      stopMic();
      startMic();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speakLang]);

  // Leaving the call ends my transcription (viewers can keep reading others).
  useEffect(() => {
    if (!active && recRef.current) stopMic();
  }, [active, stopMic]);

  useEffect(() => () => stopMic(), [stopMic]);

  return {
    supported: captionsSupported,
    micCaptioning,
    startMic,
    stopMic,
    lines,
    error,
    speakLang,
    setSpeakLang,
    targetLang,
    setTargetLang,
  };
}
