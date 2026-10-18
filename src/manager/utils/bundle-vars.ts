/**
 * Variables the other children of a bundle write, for the bundle editor's
 * child pane. A bundle's children run together in one Context node, so a
 * combine or derivation inside it reads what its siblings set; without this
 * the pane flagged every sibling `$var` as "not found upstream".
 *
 * Mirrors `siblingVarInfo` in `components/context/ContextWidget.vue` (the
 * same writers, last write wins) plus a sample value per variable so the
 * combine preview can show something concrete.
 */
import { clauseActions, isNegativeMode } from "../../extension/derivation-conditions";
import type { VarProducerLike } from "../components/RefChip.vue";
import type { ResolvedValue } from "../../widgets/richTokenize";

interface ChildLike {
  _uid?: string;
  id?: string;
  type?: string;
  enabled?: boolean;
  name?: string;
  meta?: { name?: string };
  payload?: unknown;
  instance?: unknown;
  children?: unknown;
}

export interface BundleVars {
  names: string[];
  producers: Record<string, VarProducerLike>;
  resolved: Record<string, ResolvedValue>;
}

/** A wildcard's `accepts` axes, so `$var.AXIS` reads resolve. */
function acceptsAxes(payload: unknown): VarProducerLike["axes"] {
  const p = (payload ?? {}) as { tag_groups?: Record<string, string[]>; tag_group_kinds?: Record<string, string> };
  if (!p.tag_group_kinds) return undefined;
  const out: NonNullable<VarProducerLike["axes"]> = [];
  Object.entries(p.tag_groups ?? {}).forEach(([axis, tags], hueIndex) => {
    if (p.tag_group_kinds?.[axis] === "accepts") out.push({ axis, tags: tags ?? [], hueIndex });
  });
  return out.length ? out : undefined;
}

/** What a derivation writes: each target of an action that sets the
 *  variable (not "Add to negative" / "Replace negative", which leave it
 *  unset), with the first value written. */
function derivationWrites(payload: unknown): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>();
  const rules = (payload as { rules?: unknown } | null)?.rules;
  if (!Array.isArray(rules)) return out;
  for (const rule of rules as Array<{ branches?: unknown; else?: unknown }>) {
    const clauses = [...(Array.isArray(rule?.branches) ? rule.branches : []), rule?.else];
    for (const clause of clauses) {
      for (const a of clauseActions<{ target_var?: string; value?: string; mode?: string }>(clause)) {
        const n = (a.target_var ?? "").replace(/^\$/, "").trim();
        if (!n || isNegativeMode(a.mode)) continue;
        if (out.get(n) === undefined) out.set(n, typeof a.value === "string" ? a.value : undefined);
      }
    }
  }
  return out;
}

/**
 * Vars written by every enabled child except `self` (by `_uid`, else
 * object identity), walking nested bundle refs' children too.
 */
export function bundleSiblingVars(children: readonly unknown[], self: unknown): BundleVars {
  const producers: Record<string, VarProducerLike> = {};
  const resolved: Record<string, ResolvedValue> = {};
  const lastWriter = new Map<string, string>();
  const selfUid = (self as ChildLike | null)?._uid;

  const visit = (list: readonly unknown[]): void => {
    for (const raw of list) {
      const c = (raw ?? {}) as ChildLike;
      if (raw === self || (selfUid && c._uid === selfUid) || c.enabled === false) continue;
      if (c.type === "bundle") {
        if (Array.isArray(c.children)) visit(c.children);
        continue;
      }
      const who = c._uid ?? c.id ?? "";
      const moduleName = c.meta?.name ?? c.name ?? c.type ?? "";
      const axes = c.type === "wildcard" ? acceptsAxes(c.payload) : undefined;
      const add = (name: string | null | undefined, sample?: string): void => {
        const n = (name ?? "").replace(/^\$+/, "").trim();
        if (!n) return;
        const prev = producers[n];
        const same = lastWriter.get(n) === who;
        lastWriter.set(n, who);
        producers[n] = {
          kind: c.type ?? "module", moduleName, moduleId: c.id,
          nodeLabel: "this bundle",
          shadowed: prev ? (same ? prev.shadowed ?? 0 : (prev.shadowed ?? 0) + 1) : 0,
          ...(axes ? { axes } : {}),
        };
        // Later writers win, as at run time; a writer with no sample (an
        // empty wildcard) still counts as set, shown by name.
        if (sample !== undefined && sample.trim()) resolved[n] = sample;
        else if (!(n in resolved)) resolved[n] = `‹${n}›`;
      };
      const inst = (c.instance ?? {}) as { variable_binding?: string | null; values_overrides?: Array<{ name?: string; value?: string }> };
      const p = (c.payload ?? {}) as {
        var_binding?: string; output_var?: string; template?: string;
        options?: Array<{ value?: string; text?: string }>;
        values?: Array<{ name?: string; value?: string }>;
      };
      if (c.type === "wildcard") {
        const first = (p.options ?? []).find((o) => (o.value ?? o.text ?? "").trim());
        add(inst.variable_binding ?? p.var_binding, first ? first.value ?? first.text : undefined);
      } else if (c.type === "combine") {
        add(inst.variable_binding ?? p.output_var, p.template);
      } else if (c.type === "fixed_values") {
        const rows = Array.isArray(inst.values_overrides) && inst.values_overrides.length
          ? inst.values_overrides : p.values ?? [];
        for (const v of rows) add(v.name, v.value);
      } else if (c.type === "derivation") {
        for (const [n, sample] of derivationWrites(c.payload)) add(n, sample);
      }
    }
  };
  visit(children);
  return { names: Object.keys(producers).sort(), producers, resolved };
}
