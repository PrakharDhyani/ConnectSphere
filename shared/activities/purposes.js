/**
 * Room purposes — the taxonomy behind step 3 of the creation wizard
 * ("What are you creating this room for?").
 *
 * Cards, not a text field: a free-text answer cannot drive recommendations
 * without NLP, and most people cannot articulate a purpose from a blank box
 * anyway. Nine concrete options plus an explicit escape hatch covers the space
 * while still producing a machine-usable signal.
 *
 * `custom` is the escape hatch and the ONLY kind that carries free text. It
 * scores as "no purpose signal", falling back to popularity ranking — which is
 * honest: we genuinely do not know what the room is for.
 *
 * These ids appear in `manifest.recommendedFor` keys, so renaming one is a
 * breaking change across every manifest. Add rather than rename.
 */

export const PURPOSES = Object.freeze([
  { id: "fun",        icon: "🎮", label: "Fun & Games",        blurb: "Hang out and play together" },
  { id: "coding",     icon: "💻", label: "Coding",             blurb: "Build and debug as a group" },
  { id: "study",      icon: "📚", label: "Study",              blurb: "Learn, revise, quiz each other" },
  { id: "creativity", icon: "🎨", label: "Creativity",         blurb: "Draw, design, make things" },
  { id: "team",       icon: "🏢", label: "Team Collaboration", blurb: "Plan and track work together" },
  { id: "meeting",    icon: "🎤", label: "Meeting",            blurb: "Talk it through, decide, move on" },
  { id: "brainstorm", icon: "🧠", label: "Brainstorming",      blurb: "Get every idea on the board" },
  { id: "music",      icon: "🎵", label: "Music",              blurb: "Listen and jam together" },
  { id: "experiment", icon: "🧪", label: "Experiment",         blurb: "Try things, see what happens" },
  { id: "custom",     icon: "✨", label: "Custom",             blurb: "Something else entirely" },
]);

export const PURPOSE_IDS = Object.freeze(PURPOSES.map((p) => p.id));

// Every purpose except `custom` — the set manifests may legitimately weight.
export const SCORABLE_PURPOSE_IDS = Object.freeze(PURPOSE_IDS.filter((id) => id !== "custom"));

export const getPurpose = (id) => PURPOSES.find((p) => p.id === id) ?? null;
export const isValidPurpose = (id) => PURPOSE_IDS.includes(id);
