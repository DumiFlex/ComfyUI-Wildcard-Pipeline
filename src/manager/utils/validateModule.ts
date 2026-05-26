/**
 * Module validity checks - surfaces broken refs, empty containers, and
 * other state that the engine would silently ignore at resolve time.
 * Renders the VALID column in every list view (Wildcards, Constraints,
 * Combines, Derivations, FixedValues, Bundles, AllItems).
 *
 * Each validator is pure: takes the row + a lookup map of every other
 * module/bundle in the library and returns a list of `ValidationIssue`s.
 * Empty list = valid. The list-view icon component renders a check
 * when empty, a warn triangle when issues exist, and the issue
 * messages in a tooltip so the user can fix them without opening
 * the editor.
 *
 * Severity:
 *   - "error" - blocks runtime behavior (missing source wildcard on
 *     a constraint, broken `@{uuid}` ref). Reads as red.
 *   - "warn"  - resolves at runtime but the user probably didn't
 *     mean it (empty options array, empty matrix). Reads as amber.
 */
import type { BundleRow, ModuleRow } from "../api/types";
import { tokenizeRich, type RichToken } from "../../widgets/richTokenize";

export type ValidationSeverity = "error" | "warn";

export interface ValidationIssue {
  severity: ValidationSeverity;
  message: string;
}

type CatalogIndex = {
  /** All modules keyed by id - covers every kind so cross-kind refs
   *  (e.g. wildcard text ref to a `@{uuid}` that's actually a combine
   *  or fixed_values entry) still resolve. */
  byId: Map<string, ModuleRow>;
  /** All wildcard sub-category names keyed by wildcard id, so we can
   *  flag a `@{uuid:subcat}` text ref that points at a non-existent
   *  subcategory. */
  subcatsByWildcardId: Map<string, Set<string>>;
};

function buildCatalogIndex(catalog: readonly ModuleRow[]): CatalogIndex {
  const byId = new Map<string, ModuleRow>();
  const subcatsByWildcardId = new Map<string, Set<string>>();
  for (const m of catalog) {
    byId.set(m.id, m);
    if (m.type === "wildcard") {
      const subs = (m.payload as { sub_categories?: unknown }).sub_categories;
      if (Array.isArray(subs)) {
        subcatsByWildcardId.set(
          m.id,
          new Set(subs.filter((s): s is string => typeof s === "string")),
        );
      }
    }
  }
  return { byId, subcatsByWildcardId };
}

/** Tokenize and pull out semantic refs/vars. Routing through the
 *  shared `tokenizeRich` lexer means inline brace syntax (`{a|b|c}`,
 *  `{2$$, $$silver|gold|pearl}`) doesn't get mis-classified as a
 *  `$silver` variable ref. Only top-level tokens are inspected; the
 *  `$$` weight prefix inside a dp-multi block lives inside `meta`,
 *  not as a stand-alone var token. */
function tokensFor(text: string): RichToken[] {
  try {
    return tokenizeRich(text);
  } catch {
    return [];
  }
}

function extractRefs(text: string): Array<{ uuid: string; subcat?: string; name?: string }> {
  const out: Array<{ uuid: string; subcat?: string; name?: string }> = [];
  for (const t of tokensFor(text)) {
    if (t.kind === "ref" && t.meta?.uuid) {
      const subs = t.meta.sub_categories;
      const cachedName = typeof t.meta.name === "string" && t.meta.name.length > 0
        ? t.meta.name
        : undefined;
      if (Array.isArray(subs) && subs.length > 0) {
        for (const sub of subs) {
          out.push({ uuid: t.meta.uuid, subcat: sub, name: cachedName });
        }
      } else {
        out.push({ uuid: t.meta.uuid, name: cachedName });
      }
    }
  }
  return out;
}

function extractVars(text: string): string[] {
  const out: string[] = [];
  for (const t of tokensFor(text)) {
    if (t.kind === "var" && t.meta?.name) {
      out.push(t.meta.name);
    }
  }
  return out;
}

/** Build a set of `$varname` identifiers available across the
 *  catalog so derivation/combine refs can check for orphans. */
function knownVarNames(catalog: readonly ModuleRow[]): Set<string> {
  const names = new Set<string>();
  for (const m of catalog) {
    if (m.type === "combine") {
      const v = (m.payload as { output_var?: unknown }).output_var;
      if (typeof v === "string" && v.length > 0) names.add(v);
    }
    if (m.type === "fixed_values") {
      const values = (m.payload as { values?: unknown[] }).values;
      if (Array.isArray(values)) {
        for (const v of values) {
          const name = (v as { name?: unknown }).name;
          if (typeof name === "string" && name.length > 0) names.add(name);
        }
      }
    }
    if (m.type === "wildcard") {
      // The wildcard's var_binding (or its slug-derived default) is
      // the `$name` other modules can read from. We let the editor
      // surface invalid bindings; here we just register the name so
      // a derivation's `$mood` doesn't get flagged when mood is a
      // wildcard.
      const explicit = (m.payload as { var_binding?: unknown }).var_binding;
      if (typeof explicit === "string" && explicit.length > 0) {
        names.add(explicit);
      } else if (m.name) {
        names.add(m.name.toLowerCase().replace(/[^a-z0-9]+/g, "_"));
      }
    }
  }
  return names;
}

function validateWildcard(
  row: ModuleRow,
  idx: CatalogIndex,
  vars: Set<string>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const p = (row.payload ?? {}) as { options?: unknown[] };
  const opts = Array.isArray(p.options) ? p.options : [];
  if (opts.length === 0) {
    issues.push({ severity: "warn", message: "No options - resolves to empty string" });
  }
  for (const [i, o] of opts.entries()) {
    const opt = o as { value?: unknown; is_null?: unknown };
    // Null option intentionally has value === "". Skip the empty-value
    // warning for it — see
    // docs/superpowers/specs/2026-05-24-null-wildcard-option-design.md.
    if (opt.is_null === true) continue;
    if (typeof opt.value !== "string" || opt.value.length === 0) {
      issues.push({ severity: "warn", message: `Option ${i + 1}: empty value` });
      continue;
    }
    for (const ref of extractRefs(opt.value)) {
      const target = idx.byId.get(ref.uuid);
      if (!target) {
        // Format priority: cached `#name` renders as `@name` (no
        // braces — reads like a normal var-style ref); fallback to
        // uuid renders as `@{uuid}` so the user can still copy/paste
        // the bare identifier when the name was never cached.
        const label = ref.name ? `@${ref.name}` : `@{${ref.uuid}}`;
        issues.push({
          severity: "error",
          message: `Option ${i + 1}: missing ref ${label}`,
        });
        continue;
      }
      if (ref.subcat) {
        const subs = idx.subcatsByWildcardId.get(ref.uuid);
        if (!subs || !subs.has(ref.subcat)) {
          issues.push({
            severity: "error",
            message: `Option ${i + 1}: ${target.name} has no subcategory "${ref.subcat}"`,
          });
        }
      }
    }
    for (const v of extractVars(opt.value)) {
      if (!vars.has(v)) {
        issues.push({
          severity: "warn",
          message: `Option ${i + 1}: $${v} is not bound to any module`,
        });
      }
    }
  }
  return issues;
}

function validateConstraint(row: ModuleRow, idx: CatalogIndex): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const p = (row.payload ?? {}) as {
    source_wildcard_id?: unknown;
    target_wildcard_id?: unknown;
    matrix?: unknown;
    broken_exceptions?: unknown[];
  };
  const src = p.source_wildcard_id;
  const tgt = p.target_wildcard_id;
  if (typeof src !== "string" || !src) {
    issues.push({ severity: "error", message: "Source wildcard not set" });
  } else if (!idx.byId.has(src)) {
    issues.push({ severity: "error", message: "Source wildcard deleted" });
  } else if (idx.byId.get(src)!.type !== "wildcard") {
    issues.push({ severity: "error", message: "Source is not a wildcard" });
  }
  if (typeof tgt !== "string" || !tgt) {
    issues.push({ severity: "error", message: "Target wildcard not set" });
  } else if (!idx.byId.has(tgt)) {
    issues.push({ severity: "error", message: "Target wildcard deleted" });
  } else if (idx.byId.get(tgt)!.type !== "wildcard") {
    issues.push({ severity: "error", message: "Target is not a wildcard" });
  }
  // Orphan matrix row / column flags (sub-cat present in the matrix but
  // gone from the linked wildcard) used to surface here. Removed: the
  // ConstraintEditor's matrix UI only renders cells whose row+col are in
  // the live sub-cat list, so the user has no way to find or edit an
  // orphan entry. Flagging it produced a permanent VALID warning the
  // user couldn't clear. Engine treats orphan cells as passthrough, so
  // they're harmless until a save auto-prunes them. Keeping the
  // `broken_exceptions` flag below — that path is actionable via re-edit.
  if (Array.isArray(p.broken_exceptions) && p.broken_exceptions.length > 0) {
    issues.push({
      severity: "warn",
      message: `${p.broken_exceptions.length} broken exception${
        p.broken_exceptions.length === 1 ? "" : "s"
      } from migration`,
    });
  }
  return issues;
}

function validateCombine(
  row: ModuleRow,
  idx: CatalogIndex,
  vars: Set<string>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const p = (row.payload ?? {}) as { template?: unknown; output_var?: unknown };
  if (typeof p.template !== "string" || p.template.length === 0) {
    issues.push({ severity: "warn", message: "Template is empty" });
  }
  if (typeof p.output_var !== "string" || p.output_var.length === 0) {
    issues.push({ severity: "warn", message: "Output variable name missing" });
  }
  if (typeof p.template === "string") {
    for (const ref of extractRefs(p.template)) {
      if (!idx.byId.has(ref.uuid)) {
        const label = ref.name ? `@${ref.name}` : `@{${ref.uuid}}`;
        issues.push({ severity: "error", message: `Template ref ${label} missing` });
      }
    }
    for (const v of extractVars(p.template)) {
      if (v === p.output_var) continue;
      if (!vars.has(v)) {
        issues.push({ severity: "warn", message: `$${v} is not bound to any module` });
      }
    }
  }
  return issues;
}

function validateDerivation(
  row: ModuleRow,
  idx: CatalogIndex,
  vars: Set<string>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const p = (row.payload ?? {}) as { rules?: unknown[] };
  const rules = Array.isArray(p.rules) ? p.rules : [];
  if (rules.length === 0) {
    issues.push({ severity: "warn", message: "No rules - derivation never fires" });
  }
  for (const [ri, rule] of rules.entries()) {
    const r = rule as { branches?: unknown[]; else?: { action?: unknown } };
    const branches = Array.isArray(r.branches) ? r.branches : [];
    if (branches.length === 0) {
      issues.push({ severity: "warn", message: `Rule ${ri + 1}: no branches` });
    }
    for (const [bi, branch] of branches.entries()) {
      const b = branch as {
        condition?: { var?: unknown; value?: unknown };
        action?: { target_var?: unknown; value?: unknown };
      };
      const condVar = b.condition?.var;
      if (typeof condVar === "string" && condVar.length > 0 && !vars.has(condVar)) {
        issues.push({
          severity: "warn",
          message: `Rule ${ri + 1} branch ${bi + 1}: $${condVar} not bound`,
        });
      }
      const condValue = b.condition?.value;
      if (typeof condValue === "string") {
        for (const ref of extractRefs(condValue)) {
          if (!idx.byId.has(ref.uuid)) {
            const label = ref.name ? `@${ref.name}` : `@{${ref.uuid}}`;
            issues.push({
              severity: "error",
              message: `Rule ${ri + 1} branch ${bi + 1}: condition ref ${label} missing`,
            });
          }
        }
      }
      const actionValue = b.action?.value;
      if (typeof actionValue === "string") {
        for (const ref of extractRefs(actionValue)) {
          if (!idx.byId.has(ref.uuid)) {
            const label = ref.name ? `@${ref.name}` : `@{${ref.uuid}}`;
            issues.push({
              severity: "error",
              message: `Rule ${ri + 1} branch ${bi + 1}: action ref ${label} missing`,
            });
          }
        }
      }
    }
  }
  return issues;
}

function validateFixedValues(row: ModuleRow): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const p = (row.payload ?? {}) as { values?: unknown[] };
  const values = Array.isArray(p.values) ? p.values : [];
  if (values.length === 0) {
    issues.push({ severity: "warn", message: "No values - module exports nothing" });
  }
  for (const [i, v] of values.entries()) {
    const val = v as { name?: unknown };
    if (typeof val.name !== "string" || val.name.length === 0) {
      issues.push({ severity: "warn", message: `Value ${i + 1}: variable name missing` });
    }
  }
  return issues;
}

/**
 * Public entry point. Caller passes the row + the live catalog and
 * receives a flat issue list. The validator runs across the union
 * of {modules, bundles} so cross-kind refs resolve uniformly.
 */
export function validateModule(
  row: ModuleRow,
  catalog: readonly ModuleRow[],
): ValidationIssue[] {
  const idx = buildCatalogIndex(catalog);
  const vars = knownVarNames(catalog);
  switch (row.type) {
    case "wildcard":     return validateWildcard(row, idx, vars);
    case "constraint":   return validateConstraint(row, idx);
    case "combine":      return validateCombine(row, idx, vars);
    case "derivation":   return validateDerivation(row, idx, vars);
    case "fixed_values": return validateFixedValues(row);
    default:             return [];
  }
}

/** Bundle validator - flags bundles whose `children[]` references
 *  no-longer-existing module OR bundle ids. Bundles can nest other
 *  bundles as children (`type: "bundle"`), so the caller must pass
 *  the bundle list as the third arg; without it nested bundle
 *  children read as "missing".
 *
 *  Discrimination is by `child.type`: `"bundle"` → look in `bundles`,
 *  anything else → look in `catalog`. Missing child type defaults to
 *  module lookup for backward compat with legacy rows. */
export function validateBundle(
  row: BundleRow,
  catalog: readonly ModuleRow[],
  bundles: readonly BundleRow[] = [],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const modulesById = new Map(catalog.map((m) => [m.id, m]));
  const bundlesById = new Map(bundles.map((b) => [b.id, b]));
  const children = Array.isArray(row.children) ? row.children : [];
  if (children.length === 0) {
    issues.push({ severity: "warn", message: "Bundle has no children" });
  }
  for (const [i, child] of children.entries()) {
    const c = child as { id?: unknown; type?: unknown };
    if (typeof c.id !== "string") {
      issues.push({ severity: "error", message: `Child ${i + 1}: target missing` });
      continue;
    }
    const lookupMap = c.type === "bundle" ? bundlesById : modulesById;
    if (!lookupMap.has(c.id)) {
      const kindLabel = c.type === "bundle" ? "bundle" : "module";
      issues.push({
        severity: "error",
        message: `Child ${i + 1}: target ${kindLabel} missing`,
      });
    }
  }
  return issues;
}

/** Pick the worst severity in an issue list - drives the icon tone. */
export function worstSeverity(issues: readonly ValidationIssue[]): ValidationSeverity | null {
  if (issues.length === 0) return null;
  return issues.some((i) => i.severity === "error") ? "error" : "warn";
}
