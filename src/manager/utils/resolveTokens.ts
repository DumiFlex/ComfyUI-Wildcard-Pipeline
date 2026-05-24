/**
 * TS twin of engine/syntax/resolve.py. Walks the token list emitted by
 * tokenizeRich, dispatching by kind. Used by Test Runner; same semantics
 * as the Python engine.
 */
import { tokenizeRich, type RichToken } from "../../widgets/richTokenize";

export type SurfaceKind =
  | "wildcard"
  | "combine"
  | "derivation"
  | "assembler"
  | "fixed_values";

export interface ResolveModule {
  type: string;
  var_binding: string;
  options: Array<{ value: string; weight: number }>;
}

export interface ResolveWarning {
  type: string;
  severity: "info" | "warn" | "error";
  module_id: string;
  source_field: string;
  position: number;
  token_index: number | null;
  detail: Record<string, unknown>;
  message: string;
}

export interface ResolveContext {
  rng: { random(): number; randrange(n: number): number };
  rngSeed?: number;
  maxRefDepth: number;
  strict: boolean;
  surface: SurfaceKind;
  developerMode: boolean;
  warnings: ResolveWarning[];
  vars: Record<string, string>;
  modules: Record<string, ResolveModule>;
}

export class UnknownRefError extends Error {
  constructor(public uuid: string) {
    super(`unknown wildcard ref: @{${uuid}}`);
  }
}

export class RefOutOfSurfaceError extends Error {
  constructor(public uuid: string, public surface: string) {
    super(`ref @{${uuid}} not allowed in ${surface!} surface`);
  }
}

export class RecursionLimitExceeded extends Error {}

export class CycleDetectedError extends Error {
  constructor(public chain: string[]) {
    super("cycle: " + chain.map((u) => `@{${u}}`).join(" → "));
  }
}

export function resolveTokens(text: string, ctx: ResolveContext): string {
  const tokens = tokenizeRich(text);
  return resolveTokenList(tokens, ctx, 0, []);
}

function resolveTokenList(
  tokens: RichToken[],
  ctx: ResolveContext,
  depth: number,
  visited: string[],
): string {
  const parts: string[] = [];
  for (const tok of tokens) {
    switch (tok.kind) {
      case "text":
        parts.push(tok.raw);
        break;
      case "escape":
        parts.push((tok.meta?.literal as string) ?? "");
        break;
      case "var":
        parts.push(resolveVar(tok, ctx));
        break;
      case "ref":
        parts.push(resolveRef(tok, ctx, depth, visited));
        break;
      case "dp-brace":
        parts.push(resolveInlinePick(tok, ctx, depth, visited));
        break;
      case "dp-multi":
        parts.push(resolveMultiPick(tok, ctx, depth, visited));
        break;
      // dp-pipe, dp-weight not emitted at top level — assertion failure if we hit them
      default:
        throw new Error(`unknown token kind: ${tok.kind}`);
    }
  }
  return parts.join("");
}

function resolveVar(tok: RichToken, ctx: ResolveContext): string {
  const name = (tok.meta?.name as string) ?? "";
  if (name.startsWith("__")) return "";
  return ctx.vars[name] ?? "";
}

function resolveRef(
  tok: RichToken,
  ctx: ResolveContext,
  depth: number,
  visited: string[],
): string {
  const uuid = (tok.meta?.uuid as string) ?? "";

  if (depth >= ctx.maxRefDepth) {
    const chain = [...visited, uuid];
    if (ctx.strict) throw new RecursionLimitExceeded("max ref depth exceeded");
    pushWarning(ctx, {
      type: "recursion_limit", severity: "error", position: tok.start,
      detail: { chain, limit: ctx.maxRefDepth },
      message: `Recursion limit reached at depth ${ctx.maxRefDepth}`,
    });
    return "";
  }

  if (visited.includes(uuid)) {
    const chain = [...visited, uuid];
    if (ctx.strict) throw new CycleDetectedError(chain);
    pushWarning(ctx, {
      type: "cycle_detected", severity: "error", position: tok.start,
      detail: { chain },
      message: "Cycle: " + chain.map((u) => `@{${u}}`).join(" → "),
    });
    return "";
  }

  if (ctx.surface !== "wildcard") {
    if (ctx.strict) throw new RefOutOfSurfaceError(uuid, ctx.surface);
    const mod = ctx.modules[uuid];
    pushWarning(ctx, {
      type: "ref_out_of_surface", severity: "info", position: tok.start,
      detail: { uuid, name: mod?.var_binding ?? null, surface: ctx.surface },
      message: `@{${uuid}} ignored in ${ctx.surface!} surface`,
    });
    return "";
  }

  const module = ctx.modules[uuid];
  if (!module) {
    if (ctx.strict) throw new UnknownRefError(uuid);
    pushWarning(ctx, {
      type: "unknown_ref", severity: "warn", position: tok.start,
      detail: { uuid, name: null },
      message: `Unknown wildcard ref @{${uuid}}`,
    });
    return "";
  }

  const chosen = pickWeighted(module.options ?? [], ctx.rng);
  if (!chosen) return "";
  const chosenValue = String(chosen.value ?? "");
  if (!chosenValue) return "";

  const nested = tokenizeRich(chosenValue);
  return resolveTokenList(nested, ctx, depth + 1, [...visited, uuid]);
}

function resolveInlinePick(
  tok: RichToken,
  ctx: ResolveContext,
  depth: number,
  visited: string[],
): string {
  const branches = (tok.meta?.branches as string[]) ?? [];
  if (!branches.length) return "";
  const idx = ctx.rng.randrange(branches.length);
  const chosen = branches[idx];
  if (!chosen) return "";
  return resolveTokenList(tokenizeRich(chosen), ctx, depth, visited);
}

function resolveMultiPick(
  tok: RichToken,
  ctx: ResolveContext,
  depth: number,
  visited: string[],
): string {
  const count = (tok.meta?.count as number) ?? 0;
  const sep = (tok.meta?.sep as string) ?? "";
  const branches = [...((tok.meta?.branches as string[]) ?? [])];

  if (count <= 0) return "";
  const nPicks = Math.min(count, branches.length);
  if (nPicks === 0) return "";

  const weights = branches.map(parseBranchWeight);
  const values = branches.map(stripBranchWeight);

  const chosenIndices: number[] = [];
  const availableIdx = branches.map((_, i) => i);
  const availableW = [...weights];

  for (let i = 0; i < nPicks; i++) {
    if (!availableIdx.length) break;
    const pickIdx = weightedPickIndex(availableW, ctx.rng);
    chosenIndices.push(availableIdx.splice(pickIdx, 1)[0]);
    availableW.splice(pickIdx, 1);
  }

  return chosenIndices
    .map((idx) => resolveTokenList(tokenizeRich(values[idx]), ctx, depth, visited))
    .join(sep);
}

function pickWeighted(
  options: Array<{ value: string; weight: number }>,
  rng: ResolveContext["rng"],
): { value: string; weight: number } | null {
  if (!options.length) return null;
  const total = options.reduce((s, o) => s + Math.max(0, Number(o.weight) || 0), 0);
  if (total <= 0) return options[0];
  const r = rng.random() * total;
  let acc = 0;
  for (const o of options) {
    acc += Math.max(0, Number(o.weight) || 0);
    if (r <= acc) return o;
  }
  return options[options.length - 1];
}

function parseBranchWeight(branch: string): number {
  if (!branch.includes("::")) return 1;
  const [prefix] = branch.split("::");
  const n = Number(prefix);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return n;
}

function stripBranchWeight(branch: string): string {
  if (!branch.includes("::")) return branch;
  const idx = branch.indexOf("::");
  const prefix = branch.slice(0, idx);
  if (!Number.isFinite(Number(prefix))) return branch;
  return branch.slice(idx + 2);
}

function weightedPickIndex(weights: number[], rng: ResolveContext["rng"]): number {
  const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (total <= 0) return 0;
  const r = rng.random() * total;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += Math.max(0, weights[i]);
    if (r <= acc) return i;
  }
  return weights.length - 1;
}

function pushWarning(ctx: ResolveContext, partial: Partial<ResolveWarning>): void {
  ctx.warnings.push({
    type: "",
    severity: "warn",
    module_id: "",
    source_field: "",
    position: 0,
    token_index: null,
    detail: {},
    message: "",
    ...partial,
  } as ResolveWarning);
}
