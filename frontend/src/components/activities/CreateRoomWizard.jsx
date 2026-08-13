import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api.js";
import Button from "@/components/ui/Button.jsx";
import Input from "@/components/ui/Input.jsx";
import ConfigSchemaForm from "./ConfigSchemaForm.jsx";
import { PURPOSES } from "@shared/activities/purposes.js";

/**
 * Room creation: name → visibility → purpose → activities → settings.
 *
 * THE MOST IMPORTANT DESIGN DECISION HERE IS THE SKIP BUTTON.
 * Creating a room used to be one text field and a click. A five-step wizard
 * that everyone must walk through would be a downgrade for the person who
 * already knows what they want — the main way this feature could make the
 * product worse. So "Create now" is available from step 1 onward: skipping
 * stores no activities, and the room resolves to the legacy default set
 * (everything), which is exactly today's behaviour.
 *
 * Steps 3–5 are additive on the server too — {name, visibility} is still a
 * valid create body — so nothing about this is load-bearing.
 */

const VISIBILITIES = [
  { id: "private", icon: "🔒", label: "Private", hint: "Only people with the invite code" },
  { id: "public", icon: "🌐", label: "Public", hint: "Anyone can find and join" },
  { id: "inviteOnly", icon: "✉️", label: "Invite only", hint: "Hidden — you invite people directly" },
];

const STEPS = ["Name", "Visibility", "Purpose", "Activities", "Settings"];

function StepDots({ step, onJump }) {
  return (
    <div className="flex items-center gap-1.5">
      {STEPS.map((label, i) => (
        <button
          key={label}
          type="button"
          onClick={() => i < step && onJump(i)}
          disabled={i > step}
          title={label}
          className={`h-1.5 rounded-full transition-all ${
            i === step ? "w-6 bg-brand-500" : i < step ? "w-3 bg-brand-700 hover:bg-brand-500" : "w-3 bg-gray-700"
          }`}
        />
      ))}
    </div>
  );
}

function ActivityCard({ activity, checked, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={checked}
      className={`text-left rounded-xl border p-3 transition-colors ${
        checked ? "border-brand-500 bg-brand-600/15" : "border-gray-700 bg-gray-900 hover:border-gray-600"
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="text-xl leading-none shrink-0">{activity.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-sm truncate">{activity.name}</span>
            <span className={`ml-auto shrink-0 w-4 h-4 rounded border flex items-center justify-center text-[10px] ${
              checked ? "bg-brand-500 border-brand-500 text-white" : "border-gray-600"
            }`}>{checked ? "✓" : ""}</span>
          </div>
          <p className="text-[11px] text-gray-500 line-clamp-2 mt-0.5">{activity.description}</p>
          {activity.reasons?.[0] && (
            <p className="text-[10px] text-brand-400/80 mt-1">{activity.reasons[0]}</p>
          )}
        </div>
      </div>
    </button>
  );
}

export default function CreateRoomWizard({ onCreate, creating, error, onCancel }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState("private");
  // Several purposes, not one: a room is often "Fun + Study" or "Team +
  // Brainstorm", and forcing a single pick made the user throw away half of
  // what they wanted before the recommendations were even computed.
  const [purposeKinds, setPurposeKinds] = useState([]);
  const [purposeText, setPurposeText] = useState("");
  const [selected, setSelected] = useState([]);      // plugin ids
  const [configs, setConfigs] = useState({});        // id -> config
  const [catalogue, setCatalogue] = useState([]);    // full manifest list
  const [recs, setRecs] = useState(null);            // { recommended, optional }
  const [loadingRecs, setLoadingRecs] = useState(false);
  const [expanded, setExpanded] = useState(null);    // which plugin's settings are open

  const nameOk = name.trim().length >= 2;

  // Catalogue is the fallback if /recommend fails — the wizard must still work.
  useEffect(() => {
    api.get("/activities")
      .then((r) => setCatalogue(r.data.data.activities))
      .catch(() => setCatalogue([]));
  }, []);

  // Ask the server to rank activities once a purpose is chosen.
  useEffect(() => {
    if (step !== 3) return;
    let cancelled = false;
    setLoadingRecs(true);
    api.post("/activities/recommend", { purpose: purposeKinds, selected, visibility })
      .then((r) => { if (!cancelled) setRecs(r.data.data); })
      .catch(() => {
        // Degrade to the plain catalogue rather than blocking creation.
        if (!cancelled) setRecs({ recommended: [], optional: catalogue });
      })
      .finally(() => { if (!cancelled) setLoadingRecs(false); });
    return () => { cancelled = true; };
    // `selected` deliberately omitted: re-ranking on every tick would make
    // cards jump under the user's cursor mid-click. purposeKinds is joined
    // rather than passed by reference — a new array identity every render
    // would refetch endlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, purposeKinds.join(","), visibility, catalogue]);

  // Pre-check the recommendations the first time they arrive — the wizard
  // should propose a working room, not an empty one.
  useEffect(() => {
    if (recs?.recommended?.length && selected.length === 0) {
      setSelected(recs.recommended.map((a) => a.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recs]);

  const byId = useMemo(() => {
    const m = new Map(catalogue.map((a) => [a.id, a]));
    for (const a of [...(recs?.recommended || []), ...(recs?.optional || [])]) m.set(a.id, { ...m.get(a.id), ...a });
    return m;
  }, [catalogue, recs]);

  const toggle = (id) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const submit = () => {
    if (!nameOk) { setStep(0); return; }
    onCreate({
      name: name.trim(),
      visibility,
      // `kind` stays a single id for backward compatibility with every room
      // already stored; `kinds` carries the full selection.
      ...(purposeKinds.length
        ? {
            purpose: {
              kind: purposeKinds[0],
              kinds: purposeKinds,
              text: purposeKinds.includes("custom") ? purposeText.trim() : undefined,
            },
          }
        : {}),
      // No selection → omit entirely, so the room keeps the legacy default of
      // "every activity available" rather than being created with none.
      ...(selected.length ? { activities: selected.map((id) => ({ id, config: configs[id] || {} })) } : {}),
    });
  };

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  return (
    <div className="glass-card p-5 space-y-4 anim-fade-up">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Create a room</h2>
        <StepDots step={step} onJump={setStep} />
      </div>

      {/* Step 1 — name */}
      {step === 0 && (
        <div className="space-y-3">
          <Input
            label="Room name"
            value={name}
            placeholder="Daily standup"
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && nameOk) next(); }}
          />
          <p className="text-xs text-gray-500">You can change this later.</p>
        </div>
      )}

      {/* Step 2 — visibility */}
      {step === 1 && (
        <div className="space-y-2">
          <span className="block text-sm text-gray-400">Who can find it?</span>
          {VISIBILITIES.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setVisibility(v.id)}
              className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
                visibility === v.id ? "border-brand-500 bg-brand-600/20" : "border-gray-700 bg-gray-800 hover:border-brand-600"
              }`}
            >
              <span className="block text-sm font-medium">{v.icon} {v.label}</span>
              <span className="block text-[11px] text-gray-500">{v.hint}</span>
            </button>
          ))}
        </div>
      )}

      {/* Step 3 — purposes. Multi-select: rooms are rarely one thing. */}
      {step === 2 && (
        <div className="space-y-3">
          <span className="block text-sm text-gray-400">
            What are you creating this room for?
            <span className="text-gray-500"> — pick as many as fit.</span>
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {PURPOSES.map((p) => {
              const on = purposeKinds.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setPurposeKinds((cur) =>
                      cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id]
                    );
                    // Recommendations are about to change, so drop the previous
                    // ones — keeping them would leave activities pre-checked on
                    // the strength of a purpose the user has just deselected.
                    setSelected([]);
                    setRecs(null);
                  }}
                  className={`relative rounded-xl border p-2.5 text-center transition-colors ${
                    on ? "border-brand-500 bg-brand-600/20" : "border-gray-700 bg-gray-900 hover:border-gray-600"
                  }`}
                  title={p.blurb}
                >
                  {on && (
                    <span className="absolute top-1 right-1.5 text-[10px] text-brand-300" aria-hidden="true">✓</span>
                  )}
                  <span className="block text-xl">{p.icon}</span>
                  <span className="block text-[11px] mt-0.5 leading-tight">{p.label}</span>
                </button>
              );
            })}
          </div>
          {purposeKinds.length > 1 && (
            <p className="text-[11px] text-gray-500">
              Activities are ranked by their best fit across all {purposeKinds.length} — so a
              specialist for one still beats something mediocre at both.
            </p>
          )}
          {purposeKinds.includes("custom") && (
            <Input
              label="Tell us more"
              value={purposeText}
              placeholder="Book club, D&D night, standup…"
              autoFocus
              onChange={(e) => setPurposeText(e.target.value)}
            />
          )}
        </div>
      )}

      {/* Step 4 — activities */}
      {step === 3 && (
        <div className="space-y-3">
          {loadingRecs && <p className="text-xs text-gray-500">Finding activities that fit…</p>}
          {!loadingRecs && recs && (
            <>
              {recs.recommended.length > 0 && (
                <div>
                  <span className="block text-sm text-gray-400 mb-1.5">Recommended</span>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {recs.recommended.map((a) => (
                      <ActivityCard key={a.id} activity={a} checked={selected.includes(a.id)} onToggle={() => toggle(a.id)} />
                    ))}
                  </div>
                </div>
              )}
              {recs.optional.length > 0 && (
                <details className="group">
                  <summary className="text-sm text-gray-400 cursor-pointer hover:text-gray-200 select-none">
                    More activities ({recs.optional.length})
                  </summary>
                  <div className="grid sm:grid-cols-2 gap-2 mt-2">
                    {recs.optional.map((a) => (
                      <ActivityCard key={a.id} activity={a} checked={selected.includes(a.id)} onToggle={() => toggle(a.id)} />
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
          <p className="text-xs text-gray-500">
            {selected.length
              ? `${selected.length} selected — you can add or remove these later.`
              : "Nothing selected means every activity stays available."}
          </p>
        </div>
      )}

      {/* Step 5 — per-plugin settings, collapsed by default */}
      {step === 4 && (
        <div className="space-y-2">
          {selected.length === 0 && <p className="text-xs text-gray-500">No activities selected — nothing to configure.</p>}
          {selected.map((id) => {
            const a = byId.get(id);
            if (!a) return null;
            const hasSettings = Object.keys(a.configSchema || {}).length > 0;
            const open = expanded === id;
            return (
              <div key={id} className="rounded-xl border border-gray-800 bg-gray-900/60">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : id)}
                  disabled={!hasSettings}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left disabled:opacity-60"
                >
                  <span>{a.icon}</span>
                  <span className="text-sm font-medium flex-1">{a.name}</span>
                  <span className="text-[11px] text-gray-500">
                    {hasSettings ? (open ? "Hide" : "Customize") : "No settings"}
                  </span>
                </button>
                {open && hasSettings && (
                  <div className="px-3 pb-3">
                    {/* Defaults are supplied by the server so the form starts
                        from the same values the room would get anyway. */}
                    <ConfigSchemaForm
                      schema={a.configSchema}
                      value={configs[id] ?? a.defaults ?? {}}
                      onChange={(cfg) => setConfigs((c) => ({ ...c, [id]: cfg }))}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex items-center gap-2 pt-1">
        {step > 0 && (
          <button type="button" onClick={back} className="text-sm text-gray-400 hover:text-gray-200 px-2">
            ← Back
          </button>
        )}
        <div className="flex-1" />
        {/* The escape hatch: create immediately at any step. Room creation was
            one click before this wizard existed and must still be. */}
        {step < STEPS.length - 1 && (
          <button
            type="button"
            onClick={submit}
            disabled={!nameOk || creating}
            className="text-sm text-gray-400 hover:text-brand-400 disabled:opacity-40 px-2"
          >
            Skip &amp; create
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <Button type="button" onClick={next} disabled={!nameOk}>Next</Button>
        ) : (
          <Button type="button" onClick={submit} loading={creating} disabled={!nameOk}>Create room</Button>
        )}
      </div>

      {onCancel && (
        <button type="button" onClick={onCancel} className="text-xs text-gray-500 hover:text-gray-300">
          Cancel
        </button>
      )}
    </div>
  );
}
