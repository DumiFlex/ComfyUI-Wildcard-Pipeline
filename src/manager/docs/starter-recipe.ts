/**
 * Starter Set recipe — pure data + tiny payload builders for the
 * "Create starter" tutorial buttons (Phase A of the Starter Set Tutorial,
 * see `docs/superpowers/plans/2026-05-28-starter-set-tutorial.md`).
 *
 * This module is deliberately ComfyUI-free and side-effect-free: it knows
 * the *shape* of each starter module's payload but never talks to the API,
 * the stores, or the router. The composable (`useStarterSet.ts`) is the only
 * thing that turns these payloads into real library rows.
 *
 * CRITICAL — fresh ids per build: every `WildcardOption` / `NamedValue` /
 * `DerivationRule` carries an `id`. These are minted with `newShortId()`
 * INSIDE the `buildPayload` functions, NOT baked into module-level constants.
 * Calling a builder twice yields two payloads with disjoint id sets, so a
 * recreate (failsafe / dangling-id recovery) never reuses a stale option id.
 */
import type {
  CombinePayload,
  ConstraintPayload,
  DerivationPayload,
  ModuleType,
  TemplateCreateInput,
  WildcardPayload,
} from "../api/types";
import { newShortId } from "../utils/ids";

/** A slot in the starter set. The six module slots are created as library
 *  modules + bundled; `template` is a standalone Prompt template. */
export type StarterSlot =
  | "subject"
  | "mood"
  | "style"
  | "scene"
  | "accent"
  | "pairing"
  | "template";

/** The six module slots, in dependency order. `pairing` (constraint) is
 *  last because it needs the created `subject` + `mood` wildcard ids.
 *  `template` is intentionally absent — it's not a module + not bundled. */
export const STARTER_MODULE_SLOTS: readonly Exclude<StarterSlot, "template">[] = [
  "subject",
  "mood",
  "style",
  "scene",
  "accent",
  "pairing",
] as const;

/** RUNTIME order for the bundle's `children[]` — NOT the creation order above.
 *  A bundle's child array order IS the in-Context resolution order, and module
 *  order is load-bearing:
 *    - a constraint only re-weights the FIRST instance of its target wildcard
 *      that appears DOWNSTREAM of itself, so `pairing` must sit between its
 *      source (`subject`) and target (`mood`);
 *    - `subject` must precede `mood` so the constraint sees a resolved source pick;
 *    - `scene` (combine `$mood $subject`) and `accent` (derivation reading `$mood`)
 *      must come after both wildcards have resolved.
 *  Hence: source → constraint → target → fixed → combine → derivation. */
export const STARTER_BUNDLE_ORDER: readonly Exclude<StarterSlot, "template">[] = [
  "subject",
  "pairing",
  "mood",
  "style",
  "scene",
  "accent",
] as const;

/** Name constants — referenced by the store/composable + asserted in tests. */
export const STARTER_BUNDLE_NAME = "Starter set";
export const STARTER_TEMPLATE_NAME = "Starter prompt";

/** Per-slot display names for the created library modules. */
export const STARTER_MODULE_NAMES: Record<Exclude<StarterSlot, "template">, string> = {
  subject: "Starter subject",
  mood: "Starter mood",
  style: "Starter style",
  scene: "Starter scene",
  accent: "Starter accent",
  pairing: "Starter pairing",
};

/** Context the constraint (`pairing`) builder needs: the two created
 *  wildcard ids it wires `source_wildcard_id` / `target_wildcard_id` to.
 *  The optional display names let the constraint self-describe its axes —
 *  stamped into `source_wildcard_name` / `target_wildcard_name` so a starter
 *  constraint that's never opened in the editor still renders the wildcard
 *  name (not a raw uuid) on the community. Display-only; the engine resolves
 *  by id and never reads them. Absent → names are simply omitted. */
export interface PairingBuildContext {
  subjectId: string;
  moodId: string;
  subjectName?: string;
  moodName?: string;
}

/** Minimal shape of the fixed_values payload. Mirrors the server's
 *  `{values:[{id,name,value}]}` — `name` carries NO `$` prefix (the engine
 *  emits `$<name>`). Not exported from `api/types.ts`, so typed locally. */
interface FixedValuesPayload {
  values: { id: string; name: string; value: string }[];
}

// ----- Per-slot payload builders (fresh ids minted on each call) -----

/** subject (wildcard): two sub_categories, two options each, var `$subject`. */
export function buildSubjectPayload(): WildcardPayload {
  return {
    var_binding: "subject",
    sub_categories: ["feline", "canine"],
    options: [
      { id: newShortId(), value: "cat", weight: 1, sub_categories: ["feline"] },
      { id: newShortId(), value: "tiger", weight: 1, sub_categories: ["feline"] },
      { id: newShortId(), value: "dog", weight: 1, sub_categories: ["canine"] },
      { id: newShortId(), value: "wolf", weight: 1, sub_categories: ["canine"] },
    ],
  };
}

/** mood (wildcard): two sub_categories, two options each, var `$mood`. */
export function buildMoodPayload(): WildcardPayload {
  return {
    var_binding: "mood",
    sub_categories: ["calm", "intense"],
    options: [
      { id: newShortId(), value: "serene", weight: 1, sub_categories: ["calm"] },
      { id: newShortId(), value: "sleepy", weight: 1, sub_categories: ["calm"] },
      { id: newShortId(), value: "fierce", weight: 1, sub_categories: ["intense"] },
      { id: newShortId(), value: "dramatic", weight: 1, sub_categories: ["intense"] },
    ],
  };
}

/** style (fixed_values): a single named value → emits `$style`. */
export function buildStylePayload(): FixedValuesPayload {
  return {
    values: [{ id: newShortId(), name: "style", value: "oil painting" }],
  };
}

/** scene (combine): `$mood $subject` → `$scene`. */
export function buildScenePayload(): CombinePayload {
  return {
    template: "$mood $subject",
    output_var: "scene",
    input_vars: ["mood", "subject"],
  };
}

/** accent (derivation): one rule keying off `$mood == dramatic` → `$accent`. */
export function buildAccentPayload(): DerivationPayload {
  return {
    rules: [
      {
        id: newShortId(),
        branches: [
          {
            condition: { var: "mood", op: "equals", value: "dramatic" },
            action: { target_var: "accent", mode: "replace", value: "cinematic lighting" },
          },
        ],
        else: { action: { target_var: "accent", mode: "replace", value: "soft lighting" } },
      },
    ],
  };
}

/** pairing (constraint): wires subject→mood, matrix keyed by subject's
 *  sub_categories × mood's sub_categories. Boosts the "matching" energy
 *  (feline↔intense, canine↔calm) and reduces the mismatched pairing. */
export function buildPairingPayload(ctx: PairingBuildContext): ConstraintPayload {
  return {
    source_wildcard_id: ctx.subjectId,
    target_wildcard_id: ctx.moodId,
    // Cached axis names — stamped only when the ctx carries them so legacy
    // callers (ids-only) stay clean. Display-only; the engine never reads them.
    ...(ctx.subjectName ? { source_wildcard_name: ctx.subjectName } : {}),
    ...(ctx.moodName ? { target_wildcard_name: ctx.moodName } : {}),
    exceptions: [],
    matrix: {
      feline: {
        intense: { mode: "boost", factor: 3 },
        calm: { mode: "reduce", factor: 0.3 },
      },
      canine: {
        calm: { mode: "boost", factor: 3 },
        intense: { mode: "reduce", factor: 0.3 },
      },
    },
  };
}

/** TemplateCreateInput for the standalone starter prompt template. */
export function buildTemplateInput(): TemplateCreateInput {
  return {
    name: STARTER_TEMPLATE_NAME,
    template_string: "$scene, $style, $accent, masterpiece, highly detailed",
  };
}

/**
 * Slot descriptor. The five non-constraint module builders take no context;
 * the constraint builder takes `PairingBuildContext`. We model the union as a
 * discriminated set keyed by `needsContext` so callers can branch type-safely
 * without `as any`.
 */
export type StarterModuleSlot = Exclude<StarterSlot, "template">;

export interface SimpleSlotDescriptor {
  slot: Exclude<StarterModuleSlot, "pairing">;
  kind: ModuleType;
  name: string;
  needsContext: false;
  buildPayload(): Record<string, unknown>;
}

export interface PairingSlotDescriptor {
  slot: "pairing";
  kind: ModuleType;
  name: string;
  needsContext: true;
  buildPayload(ctx: PairingBuildContext): Record<string, unknown>;
}

export type StarterSlotDescriptor = SimpleSlotDescriptor | PairingSlotDescriptor;

/** Descriptor table — one entry per module slot, in dependency order via
 *  `STARTER_MODULE_SLOTS`. `buildPayload` is wrapped to the
 *  `Record<string, unknown>` the API create body expects. */
export const STARTER_MODULE_DESCRIPTORS: Record<StarterModuleSlot, StarterSlotDescriptor> = {
  subject: {
    slot: "subject", kind: "wildcard", name: STARTER_MODULE_NAMES.subject,
    needsContext: false, buildPayload: () => ({ ...buildSubjectPayload() }),
  },
  mood: {
    slot: "mood", kind: "wildcard", name: STARTER_MODULE_NAMES.mood,
    needsContext: false, buildPayload: () => ({ ...buildMoodPayload() }),
  },
  style: {
    slot: "style", kind: "fixed_values", name: STARTER_MODULE_NAMES.style,
    needsContext: false, buildPayload: () => ({ ...buildStylePayload() }),
  },
  scene: {
    slot: "scene", kind: "combine", name: STARTER_MODULE_NAMES.scene,
    needsContext: false, buildPayload: () => ({ ...buildScenePayload() }),
  },
  accent: {
    slot: "accent", kind: "derivation", name: STARTER_MODULE_NAMES.accent,
    needsContext: false, buildPayload: () => ({ ...buildAccentPayload() }),
  },
  pairing: {
    slot: "pairing", kind: "constraint", name: STARTER_MODULE_NAMES.pairing,
    needsContext: true, buildPayload: (ctx: PairingBuildContext) => ({ ...buildPairingPayload(ctx) }),
  },
};
