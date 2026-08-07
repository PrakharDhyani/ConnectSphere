/**
 * Renders a plugin's settings from its configSchema. One generic renderer for
 * every plugin — no per-plugin form code, ever.
 *
 * This is the payoff for making configSchema a CLOSED six-type grammar rather
 * than JSON Schema: every valid schema is renderable here, so a plugin cannot
 * declare a setting the UI silently drops. If a type ever shows up that this
 * does not handle, that is a bug in the grammar's validator, not a missing
 * branch — so it renders a visible warning instead of nothing.
 */

function Row({ label, help, children, htmlFor }) {
  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={htmlFor} className="text-sm text-gray-300">{label}</label>
        {children}
      </div>
      {help && <p className="text-[11px] text-gray-500 mt-0.5 pr-24">{help}</p>}
    </div>
  );
}

function Toggle({ id, checked, onChange }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${checked ? "bg-brand-600" : "bg-gray-700"}`}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`}
      />
    </button>
  );
}

const selectCls =
  "shrink-0 bg-gray-950 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white " +
  "focus:outline-none focus:ring-2 focus:ring-brand-500 max-w-[55%]";

function Field({ name, field, value, onChange }) {
  const id = `cfg-${name}`;
  const set = (v) => onChange(name, v);

  switch (field.type) {
    case "boolean":
      return (
        <Row label={field.label} help={field.help} htmlFor={id}>
          <Toggle id={id} checked={Boolean(value)} onChange={set} />
        </Row>
      );

    case "number":
      return (
        <Row label={field.label} help={field.help} htmlFor={id}>
          <input
            id={id}
            type="number"
            value={value ?? field.default}
            min={field.min}
            max={field.max}
            step={field.step ?? (field.integer ? 1 : "any")}
            onChange={(e) => {
              const n = Number(e.target.value);
              // Clamp here as well as on the server: the browser's own min/max
              // only constrains the spinner, not typed input.
              if (!Number.isFinite(n)) return;
              let v = n;
              if (Number.isFinite(field.min)) v = Math.max(field.min, v);
              if (Number.isFinite(field.max)) v = Math.min(field.max, v);
              set(field.integer ? Math.round(v) : v);
            }}
            className="shrink-0 w-24 bg-gray-950 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </Row>
      );

    case "range":
      return (
        <Row label={`${field.label} — ${value ?? field.default}`} help={field.help} htmlFor={id}>
          <input
            id={id}
            type="range"
            value={value ?? field.default}
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            onChange={(e) => set(Number(e.target.value))}
            className="shrink-0 w-40 accent-brand-500"
          />
        </Row>
      );

    case "string":
      return (
        <Row label={field.label} help={field.help} htmlFor={id}>
          <input
            id={id}
            type="text"
            value={value ?? field.default}
            maxLength={field.maxLength ?? 200}
            onChange={(e) => set(e.target.value)}
            className="shrink-0 w-48 bg-gray-950 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </Row>
      );

    case "select":
      return (
        <Row label={field.label} help={field.help} htmlFor={id}>
          <select
            id={id}
            value={String(value ?? field.default)}
            onChange={(e) => {
              // <option value> is always a string; map back to the declared
              // type so a numeric option stays a number end to end.
              const opt = field.options.find((o) => String(o.value) === e.target.value);
              set(opt ? opt.value : field.default);
            }}
            className={selectCls}
          >
            {field.options.map((o) => (
              <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
            ))}
          </select>
        </Row>
      );

    case "multiselect": {
      const current = Array.isArray(value) ? value : field.default;
      return (
        <div className="py-2">
          <span className="text-sm text-gray-300">{field.label}</span>
          {field.help && <p className="text-[11px] text-gray-500 mt-0.5">{field.help}</p>}
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {field.options.map((o) => {
              const on = current.some((v) => v === o.value);
              return (
                <button
                  key={String(o.value)}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set(on ? current.filter((v) => v !== o.value) : [...current, o.value])}
                  className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                    on ? "border-brand-500 bg-brand-600/25 text-white" : "border-gray-700 text-gray-400 hover:border-gray-600"
                  }`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    default:
      // Unreachable if validateConfigSchema did its job — surfaced rather than
      // skipped, because a silently missing setting is the exact failure the
      // closed grammar exists to prevent.
      return (
        <p className="py-2 text-xs text-amber-400">
          Cannot render setting “{field.label || name}” (unknown type “{field.type}”)
        </p>
      );
  }
}

/**
 * @param {object} schema   the plugin's configSchema
 * @param {object} value    current config
 * @param {Function} onChange  (nextConfig) => void
 */
export default function ConfigSchemaForm({ schema, value = {}, onChange }) {
  const entries = Object.entries(schema || {});
  if (!entries.length) {
    return <p className="text-xs text-gray-500 py-2">This activity has no settings.</p>;
  }
  const setField = (name, v) => onChange({ ...value, [name]: v });

  return (
    <div className="divide-y divide-gray-800">
      {entries.map(([name, field]) => (
        <Field key={name} name={name} field={field} value={value[name]} onChange={setField} />
      ))}
    </div>
  );
}
