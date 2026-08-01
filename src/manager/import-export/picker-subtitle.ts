/**
 * Row subtitles for the Export + Import pickers.
 *
 * Both pickers answer the same user question — "which of these three rows
 * called `Outfit` is the one I mean?" — so the disambiguating detail has to be
 * identical on both sides. It lived inline in ExportTab first; Import needed
 * the same strings, and a second copy would have drifted the moment one side
 * learned about a new payload field.
 *
 * Typed structurally rather than against `api/types`, because the two callers
 * feed different things in: Export passes live `ModuleRow` / `BundleRow` /
 * `TemplateRow` objects from the library API, Import passes raw rows out of a
 * migrated payload that has been validated for shape but not narrowed to those
 * interfaces. Both satisfy the loose shapes below, and neither needs a cast.
 *
 * Every function returns `undefined` (never `""`) when there is nothing worth
 * showing, so PickerRow can `v-if` the subtitle line away instead of rendering
 * an empty element that still takes up vertical space.
 */

export interface SubtitleModuleLike {
  type?: string;
  payload?: unknown;
}

export interface SubtitleBundleLike {
  children?: unknown[] | null;
}

export interface SubtitleTemplateLike {
  template_string?: string | null;
}

function count(v: unknown): number | null {
  return Array.isArray(v) ? v.length : null;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Disambiguating detail per KIND — the facts that actually tell two entities
 *  with the same display name apart. Every kind gets something, not just
 *  wildcards: a bundle's usefulness is its child count, a constraint's is its
 *  matrix size, a derivation's is its rule count. */
export function moduleSubtitle(row: SubtitleModuleLike): string | undefined {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  const parts: string[] = [];

  if (typeof p.variable_name === "string" && p.variable_name) parts.push(`$${p.variable_name}`);
  else if (typeof p.var_binding === "string" && p.var_binding) parts.push(`$${p.var_binding}`);

  switch (row.type) {
    case "wildcard": {
      const n = count(p.options);
      if (n !== null) parts.push(plural(n, "option"));
      const axes = p.tag_groups && typeof p.tag_groups === "object"
        ? Object.keys(p.tag_groups as Record<string, unknown>).length
        : 0;
      const tags = count(p.sub_categories);
      if (tags) parts.push(axes > 0 ? `${tags} tags / ${axes} axes` : plural(tags, "tag"));
      break;
    }
    case "fixed_values": {
      const n = count(p.values);
      if (n !== null) parts.push(plural(n, "value"));
      break;
    }
    case "derivation": {
      const n = count(p.rules);
      if (n !== null) parts.push(plural(n, "rule"));
      break;
    }
    case "combine": {
      // `output_var` / `input_vars` — see `CombinePayload` in api/types.ts. An
      // earlier guess of `output_variable` matched nothing, so combine rows
      // showed no detail at all.
      if (typeof p.output_var === "string" && p.output_var) parts.push(`→ $${p.output_var}`);
      const ins = count(p.input_vars);
      if (ins) parts.push(plural(ins, "input"));
      else if (typeof p.template === "string" && p.template) parts.push(`${p.template.length} ch`);
      break;
    }
    case "constraint": {
      // Matrix is `{sourceTag: {targetTag: rule}}` — report it as rows×cols,
      // which is what the user recognises from the editor grid.
      const m = (p.matrix ?? {}) as Record<string, unknown>;
      const rows = Object.keys(m).length;
      const cols = rows > 0
        ? Object.keys((Object.values(m)[0] ?? {}) as Record<string, unknown>).length
        : 0;
      if (rows > 0) parts.push(`${rows}×${cols} matrix`);
      const ex = count(p.exceptions);
      if (ex) parts.push(plural(ex, "exception"));
      break;
    }
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** Bundles carry `children`, not a module payload. */
export function bundleSubtitle(row: SubtitleBundleLike): string | undefined {
  const kids = row.children ?? [];
  if (kids.length === 0) return "empty";
  const nested = kids.filter((c) => (c as { type?: string }).type === "bundle").length;
  const label = `${kids.length} module${kids.length === 1 ? "" : "s"}`;
  return nested > 0 ? `${label} · ${nested} nested` : label;
}

/** Templates: length + how many `$var` slots the string references. */
export function templateSubtitle(row: SubtitleTemplateLike): string | undefined {
  const s = row.template_string ?? "";
  if (!s) return "empty";
  const vars = new Set(
    [...s.matchAll(/(?<!\$)(?:\$\$)*\$([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]),
  );
  return vars.size > 0 ? `${s.length} ch · ${vars.size} $var` : `${s.length} ch`;
}

/**
 * Kind-dispatching entry point, for callers that walk buckets generically and
 * hold one loosely-typed row rather than three narrow ones. Import's picker
 * iterates all 8 buckets in a single `v-for`, so it cannot pick the right
 * function at the call site the way Export's per-bucket builders can.
 *
 * `kind` is the resolved entity kind (`"bundle"`, `"template"`, or a module
 * subtype), not the bucket name — a module row keeps its own subtype.
 */
export function entitySubtitle(
  kind: string,
  row: SubtitleModuleLike & SubtitleBundleLike & SubtitleTemplateLike,
): string | undefined {
  if (kind === "bundle") return bundleSubtitle(row);
  if (kind === "template") return templateSubtitle(row);
  // Categories carry no payload worth summarising — name IS the whole entity.
  if (kind === "category") return undefined;
  return moduleSubtitle({ type: kind, payload: row.payload });
}
