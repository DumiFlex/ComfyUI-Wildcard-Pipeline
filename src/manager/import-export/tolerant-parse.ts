/**
 * Tolerant strip-unknown parse for newer-than-CURRENT payloads.
 *
 * See community-web spec
 * docs/superpowers/specs/2026-06-05-schema-versioning-migration-design.md
 * §3: when payload.schema_version > CURRENT and the AND-fold over the
 * catalog interval is all-additive, sister tolerantly drops unknown
 * fields and validates the result against CURRENT's strict shape.
 *
 * IMPORTANT: this function only handles the "shape projection" — the
 * caller is responsible for separately preserving the original payload
 * bytes in original_payload_json (the verbatim-local mirror).
 */
import type { SafeParseReturnType } from "zod";

import { getValidator, type ModuleSubtype } from "@/validators";

export function parseTolerantAsCurrentShape(
  payload: Record<string, unknown>,
  currentVersion: number,
  kind: "module",
  subtype: ModuleSubtype,
): SafeParseReturnType<unknown, Record<string, unknown>>;
export function parseTolerantAsCurrentShape(
  payload: Record<string, unknown>,
  currentVersion: number,
  kind: "bundle",
): SafeParseReturnType<unknown, Record<string, unknown>>;
export function parseTolerantAsCurrentShape(
  payload: Record<string, unknown>,
  currentVersion: number,
  kind: "module" | "bundle",
  subtype?: ModuleSubtype,
): SafeParseReturnType<unknown, Record<string, unknown>> {
  const spec = kind === "module"
    ? {
        kind: "module" as const,
        subtype: subtype!,
        version: currentVersion,
        mode: "tolerant" as const,
      }
    : {
        kind: "bundle" as const,
        version: currentVersion,
        mode: "tolerant" as const,
      };

  const validator = getValidator(spec);

  if (kind === "bundle") {
    // Pre-strip each child against its subtype's tolerant validator
    // BEFORE running the bundle root validator. The bundle root's own
    // .strip() only drops unknown top-level fields; children inside
    // the discriminated union remain strict unless we pre-process.
    const children = Array.isArray((payload as Record<string, unknown>).children)
      ? ((payload as Record<string, unknown>).children as Record<string, unknown>[])
      : [];
    const strippedChildren = children.map((child) => {
      const subtypeVal = (child as Record<string, unknown>).type;
      if (typeof subtypeVal !== "string") return child;
      const childResult = parseTolerantAsCurrentShape(
        child,
        currentVersion,
        "module",
        subtypeVal as ModuleSubtype,
      );
      return childResult.success ? childResult.data : child;
    });
    const reshaped = { ...payload, children: strippedChildren };
    return validator.safeParse(reshaped) as SafeParseReturnType<unknown, Record<string, unknown>>;
  }

  return validator.safeParse(payload) as SafeParseReturnType<unknown, Record<string, unknown>>;
}
