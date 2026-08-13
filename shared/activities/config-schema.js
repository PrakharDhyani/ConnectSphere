/**
 * The config grammar every plugin uses to describe its settings.
 *
 * WHY A CLOSED GRAMMAR INSTEAD OF JSON SCHEMA
 * JSON Schema can express things no form can render — `oneOf`, `$ref`,
 * recursion, conditional subschemas. A generic renderer fed one of those has
 * no choice but to skip the field, so the setting silently vanishes from the
 * UI and the user never knows it existed.
 *
 * Six field types, all renderable. An unrenderable schema is therefore a load
 * error (loud, at boot) rather than a blank space in the wizard (silent, in
 * production). That trade — less expressive, never surprising — is the whole
 * point.
 *
 * Same file validates the SHAPE (is this a legal schema? — at boot) and the
 * VALUES (is this config legal? — on every write). Keeping them together is
 * what stops the two from drifting apart.
 */

export const FIELD_TYPES = ["boolean", "number", "range", "string", "select", "multiselect"];

// Bounds on the schema itself. A plugin that wants 400 settings has a design
// problem, and we would rather say so at boot than render a wall of toggles.
const MAX_FIELDS = 24;
const MAX_OPTIONS = 32;
const MAX_LABEL = 60;
const MAX_STRING_DEFAULT = 200;

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);
// Config keys become object properties and query fragments — keep them boring.
const KEY_RE = /^[a-z][a-zA-Z0-9]{0,39}$/;

/**
 * Validate a plugin's configSchema. Throws on anything unrenderable.
 * Called at manifest registration, i.e. at server boot / bundle init.
 */
export function validateConfigSchema(schema, pluginId = "?") {
  const where = (k) => `${pluginId}.configSchema.${k}`;
  if (schema === undefined) return; // no settings is perfectly fine
  if (!isPlainObject(schema)) throw new Error(`${pluginId}.configSchema must be an object`);

  const keys = Object.keys(schema);
  if (keys.length > MAX_FIELDS) {
    throw new Error(`${pluginId}.configSchema has ${keys.length} fields (max ${MAX_FIELDS})`);
  }

  for (const key of keys) {
    if (!KEY_RE.test(key)) {
      throw new Error(`${where(key)}: key must be camelCase, start with a letter, ≤40 chars`);
    }
    const f = schema[key];
    if (!isPlainObject(f)) throw new Error(`${where(key)} must be an object`);
    if (!FIELD_TYPES.includes(f.type)) {
      throw new Error(`${where(key)}.type "${f.type}" is not one of: ${FIELD_TYPES.join(", ")}`);
    }
    if (typeof f.label !== "string" || !f.label.trim() || f.label.length > MAX_LABEL) {
      throw new Error(`${where(key)}.label must be a non-empty string ≤${MAX_LABEL} chars`);
    }
    if (f.help !== undefined && (typeof f.help !== "string" || f.help.length > 200)) {
      throw new Error(`${where(key)}.help must be a string ≤200 chars`);
    }
    // A default is mandatory. Without one, "unset" and "set to the default"
    // are indistinguishable, and every consumer invents its own fallback.
    if (f.default === undefined) throw new Error(`${where(key)}.default is required`);

    switch (f.type) {
      case "boolean":
        if (typeof f.default !== "boolean") throw new Error(`${where(key)}.default must be a boolean`);
        break;

      case "number":
      case "range": {
        if (!isFiniteNumber(f.default)) throw new Error(`${where(key)}.default must be a finite number`);
        // range is a slider, so it MUST be bounded or it cannot be drawn.
        if (f.type === "range" && (!isFiniteNumber(f.min) || !isFiniteNumber(f.max))) {
          throw new Error(`${where(key)}: range requires finite min and max`);
        }
        if (f.min !== undefined && !isFiniteNumber(f.min)) throw new Error(`${where(key)}.min must be a number`);
        if (f.max !== undefined && !isFiniteNumber(f.max)) throw new Error(`${where(key)}.max must be a number`);
        if (isFiniteNumber(f.min) && isFiniteNumber(f.max) && f.min > f.max) {
          throw new Error(`${where(key)}: min (${f.min}) > max (${f.max})`);
        }
        if (f.step !== undefined && (!isFiniteNumber(f.step) || f.step <= 0)) {
          throw new Error(`${where(key)}.step must be a positive number`);
        }
        if (isFiniteNumber(f.min) && f.default < f.min) throw new Error(`${where(key)}.default is below min`);
        if (isFiniteNumber(f.max) && f.default > f.max) throw new Error(`${where(key)}.default is above max`);
        break;
      }

      case "string": {
        if (typeof f.default !== "string") throw new Error(`${where(key)}.default must be a string`);
        if (f.maxLength !== undefined && (!Number.isInteger(f.maxLength) || f.maxLength <= 0 || f.maxLength > MAX_STRING_DEFAULT)) {
          throw new Error(`${where(key)}.maxLength must be an integer 1..${MAX_STRING_DEFAULT}`);
        }
        const cap = f.maxLength ?? MAX_STRING_DEFAULT;
        if (f.default.length > cap) throw new Error(`${where(key)}.default exceeds maxLength`);
        break;
      }

      case "select":
      case "multiselect": {
        if (!Array.isArray(f.options) || f.options.length === 0) {
          throw new Error(`${where(key)}: ${f.type} requires a non-empty options array`);
        }
        if (f.options.length > MAX_OPTIONS) {
          throw new Error(`${where(key)}: ${f.options.length} options (max ${MAX_OPTIONS})`);
        }
        const values = [];
        for (const opt of f.options) {
          if (!isPlainObject(opt)) throw new Error(`${where(key)}: each option must be {value,label}`);
          const t = typeof opt.value;
          if (t !== "string" && t !== "number" && t !== "boolean") {
            throw new Error(`${where(key)}: option.value must be a string, number or boolean`);
          }
          if (typeof opt.label !== "string" || !opt.label.trim()) {
            throw new Error(`${where(key)}: option.label must be a non-empty string`);
          }
          if (values.some((v) => v === opt.value)) {
            throw new Error(`${where(key)}: duplicate option value ${JSON.stringify(opt.value)}`);
          }
          values.push(opt.value);
        }
        if (f.type === "select") {
          if (!values.some((v) => v === f.default)) {
            throw new Error(`${where(key)}.default is not one of the options`);
          }
        } else {
          if (!Array.isArray(f.default)) throw new Error(`${where(key)}.default must be an array`);
          for (const d of f.default) {
            if (!values.some((v) => v === d)) throw new Error(`${where(key)}.default contains a non-option`);
          }
        }
        break;
      }
    }
  }
}

/** Every field's default — the config a room gets when nobody customises it. */
export function defaultsFor(schema) {
  const out = {};
  for (const [key, f] of Object.entries(schema || {})) {
    // Arrays are copied: a shared default array would let one room's edit
    // leak into every other room using the defaults.
    out[key] = Array.isArray(f.default) ? [...f.default] : f.default;
  }
  return out;
}

/**
 * Coerce and clamp a client-supplied config against the schema.
 *
 * TRUST BOUNDARY. Room config arrives from the browser, so this is the same
 * kind of gate as sanitizeAttachments() in chat.handlers.js: unknown keys are
 * dropped, types are coerced or rejected, numbers are clamped into range.
 *
 * Never throws — a bad value falls back to the default and is reported in
 * `warnings`. Rationale: one malformed field should not lose the user the
 * other eleven they set correctly, and a room must always end up with a
 * usable config. Callers that want strictness can inspect `warnings`.
 *
 * @returns {{config: object, warnings: string[]}}
 */
export function coerceConfig(schema, input) {
  const warnings = [];
  const out = defaultsFor(schema);
  if (!isPlainObject(input)) return { config: out, warnings };
  if (!isPlainObject(schema)) return { config: {}, warnings };

  for (const [key, raw] of Object.entries(input)) {
    const f = schema[key];
    if (!f) { warnings.push(`unknown setting "${key}" ignored`); continue; }
    const bad = (why) => { warnings.push(`"${key}" ${why}; using default`); };

    switch (f.type) {
      case "boolean":
        if (typeof raw === "boolean") out[key] = raw;
        else bad("is not a boolean");
        break;

      case "number":
      case "range": {
        const n = typeof raw === "number" ? raw : Number(raw);
        if (!Number.isFinite(n)) { bad("is not a number"); break; }
        let v = n;
        if (isFiniteNumber(f.min)) v = Math.max(f.min, v);
        if (isFiniteNumber(f.max)) v = Math.min(f.max, v);
        if (f.integer) v = Math.round(v);
        if (v !== n) warnings.push(`"${key}" clamped to ${v}`);
        out[key] = v;
        break;
      }

      case "string": {
        if (typeof raw !== "string") { bad("is not a string"); break; }
        const cap = f.maxLength ?? MAX_STRING_DEFAULT;
        out[key] = raw.length > cap ? raw.slice(0, cap) : raw;
        if (raw.length > cap) warnings.push(`"${key}" truncated to ${cap} chars`);
        break;
      }

      case "select":
        if (f.options.some((o) => o.value === raw)) out[key] = raw;
        else bad("is not a valid option");
        break;

      case "multiselect": {
        if (!Array.isArray(raw)) { bad("is not an array"); break; }
        const valid = raw.filter((v) => f.options.some((o) => o.value === v));
        if (valid.length !== raw.length) warnings.push(`"${key}" had invalid options removed`);
        // De-duplicate: the same option twice is meaningless and would break
        // any consumer treating this as a set.
        out[key] = [...new Set(valid)];
        break;
      }
    }
  }
  return { config: out, warnings };
}
