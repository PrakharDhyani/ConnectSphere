/**
 * Client state for the draw-and-guess game. Subscribes to the server's game
 * events and exposes the current public state plus the drawer-only bits (your
 * word choices / your word) and a small feed of guesses & results.
 */
import { useCallback, useEffect, useState } from "react";
import { connectSocket, getSocket } from "@/lib/socket.js";
import { useAuthStore } from "@/stores/auth.store.js";

export function useSkribbl(roomId) {
  const me = useAuthStore((s) => s.user);
  const [state, setState] = useState(null);
  const [choices, setChoices] = useState(null); // drawer: 3 words to pick from
  const [myWord, setMyWord] = useState(null); // drawer: the chosen word
  const [feed, setFeed] = useState([]);

  useEffect(() => {
    if (!roomId) return;
    const socket = connectSocket();

    const onState = (s) => {
      setState(s);
      if (s.drawerId !== me?.id) {
        setChoices(null);
        setMyWord(null);
      }
      if (s.status !== "choosing") setChoices(null);
      if (s.status === "idle" || s.status === "ended") {
        setMyWord(null);
        setFeed([]);
      }
    };
    const onChoices = ({ choices: c }) => setChoices(c);
    const onDrawerWord = ({ word }) => setMyWord(word);
    const onCorrect = ({ name, userId }) =>
      setFeed((f) => [...f, { type: "correct", name, mine: userId === me?.id }].slice(-60));
    const onGuessMessage = ({ name, text }) =>
      setFeed((f) => [...f, { type: "guess", name, text }].slice(-60));
    const onTurnEnd = ({ word }) => setFeed((f) => [...f, { type: "reveal", word }].slice(-60));

    socket.on("game:state", onState);
    socket.on("game:choices", onChoices);
    socket.on("game:drawerWord", onDrawerWord);
    socket.on("game:correct", onCorrect);
    socket.on("game:guessMessage", onGuessMessage);
    socket.on("game:turnEnd", onTurnEnd);

    socket.emit("game:sync", { roomId }, (s) => s && setState(s));

    return () => {
      socket.off("game:state", onState);
      socket.off("game:choices", onChoices);
      socket.off("game:drawerWord", onDrawerWord);
      socket.off("game:correct", onCorrect);
      socket.off("game:guessMessage", onGuessMessage);
      socket.off("game:turnEnd", onTurnEnd);
    };
  }, [roomId, me?.id]);

  const start = useCallback(
    (rounds = 3) => new Promise((res) => getSocket().emit("game:start", { roomId, rounds }, res)),
    [roomId]
  );
  const chooseWord = useCallback((word) => getSocket().emit("game:chooseWord", { roomId, word }), [roomId]);
  const guess = useCallback((text) => getSocket().emit("game:guess", { roomId, text }), [roomId]);

  const isDrawer = Boolean(state && state.drawerId === me?.id);
  const iGuessed = Boolean(state?.guessed?.includes(me?.id));

  return { state, choices, myWord, feed, isDrawer, iGuessed, me, start, chooseWord, guess };
}
