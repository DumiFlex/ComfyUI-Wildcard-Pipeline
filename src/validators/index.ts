/**
 * Validator registry: lookup a Zod schema for (kind, subtype, version, mode).
 *
 * Strict mode: schema as written (.strict() — unknown keys reject).
 * Tolerant mode: same schema but with .strip() applied — unknown keys
 * silently dropped. Tolerant mode is used only on the install-from-
 * newer-payload path; see spec §3.
 */
import { z } from "zod";
import { wildcardV1, fixedValuesV1, combineV1, derivationV1, constraintV1 } from "./module/v1";
import { bundleV1 } from "./bundle/v1";

export type ModuleSubtype =
  | "wildcard"
  | "fixed_values"
  | "combine"
  | "derivation"
  | "constraint";
export type ValidatorKind = "module" | "bundle";
export type ValidatorMode = "strict" | "tolerant";

interface ModuleSpec {
  kind: "module";
  subtype: ModuleSubtype;
  version: number;
  mode: ValidatorMode;
}

interface BundleSpec {
  kind: "bundle";
  version: number;
  mode: ValidatorMode;
}

export type ValidatorSpec = ModuleSpec | BundleSpec;

const REGISTRY: Record<string, z.ZodTypeAny> = {
  "module:wildcard:1": wildcardV1,
  "module:fixed_values:1": fixedValuesV1,
  "module:combine:1": combineV1,
  "module:derivation:1": derivationV1,
  "module:constraint:1": constraintV1,
  "bundle::1": bundleV1,
};

export function getValidator(spec: ValidatorSpec): z.ZodTypeAny {
  const key = spec.kind === "module"
    ? `module:${spec.subtype}:${spec.version}`
    : `bundle::${spec.version}`;
  const base = REGISTRY[key];
  if (!base) {
    throw new Error(`no validator for ${key}`);
  }
  // Tolerant mode rewraps the strict object schema with .strip() (Zod's
  // default — unknown keys silently dropped instead of rejecting).
  if (spec.mode === "tolerant" && base instanceof z.ZodObject) {
    return base.strip();
  }
  return base;
}
