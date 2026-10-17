/**
 * Client-side shape check for an import envelope. `parseCheckedPayload`
 * runs it after `parsePayload`'s migration chain, and every install path
 * (Import tab, pack converter, `installEnvelope` for community installs and
 * dependency downloads) goes through that, so a malformed pack is refused
 * before it reaches `POST /import/commit`.
 *
 * Kept out of `parse.ts` because it pulls in Zod: the canvas reaches
 * `installEnvelope` from the ContextWidget chunk, so `install.ts` loads this
 * module with a dynamic `import()` and Zod stays in a chunk that only
 * downloads when something is installed.
 *
 * It checks each module row's `payload` against the strict validator's
 * payload schema at CURRENT (envelopes stamped CURRENT < v <= MAX_KNOWN are
 * additive over the same shape) and each bundle's children list, mirroring
 * the server's `_validate_payload_shapes` so both sides refuse the same
 * packs. Ids are not checked: `normalizeInvalidIds` mints them. Row-level
 * columns (`name`, `created_at`, community origin,
 * fingerprints …) are left to the server: exports carry more of them than
 * the publish shape lists, and the engine's `validate_payload` on commit
 * stays the authority. Nothing is stripped or rewritten; this only decides
 * yes or no.
 */
import { z } from "zod";
import { getValidator, type ModuleSubtype } from "@/validators";
import { bundleV1Child } from "@/validators/bundle/v1";
import { CURRENT_SCHEMA_VERSION, type RawPayload } from "./migrations";
import { parsePayload, type ParseResult } from "./parse";

// The bucket decides the subtype (as on the server); a row's own `type`
// is not trusted, older exports spell it differently.
const MODULE_BUCKETS: ReadonlyArray<readonly [keyof RawPayload, ModuleSubtype]> = [
  ["wildcards", "wildcard"],
  ["fixed_values", "fixed_values"],
  ["combines", "combine"],
  ["derivations", "derivation"],
  ["constraints", "constraint"],
];

const payloadSchemas = new Map<ModuleSubtype, z.ZodTypeAny>();

function payloadSchema(subtype: ModuleSubtype): z.ZodTypeAny {
  let schema = payloadSchemas.get(subtype);
  if (!schema) {
    const row = getValidator({ kind: "module", subtype, version: CURRENT_SCHEMA_VERSION, mode: "strict" });
    schema = row instanceof z.ZodObject ? (row.shape as Record<string, z.ZodTypeAny>).payload : undefined;
    if (!schema) throw new Error(`validator for ${subtype} has no payload schema`);
    payloadSchemas.set(subtype, schema);
  }
  return schema;
}

// Children may be absent (the server skips those bundles too); each child
// needs the id + type the engine routes it by.
const bundleShape = z.object({
  children: z.array(bundleV1Child).optional(),
});

function label(bucket: string, index: number, entity: Record<string, unknown>): string {
  const name = typeof entity.name === "string" && entity.name ? ` "${entity.name}"` : "";
  return `${bucket}[${index}]${name}`;
}

function firstIssue(error: z.ZodError, prefix: string): string {
  const issue = error.issues[0];
  const path = [prefix, ...issue.path.map(String)].filter(Boolean).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

/** Returns a reason naming the first bad row, or `null` when every row fits. */
export function checkEnvelopeShapes(envelope: RawPayload): string | null {
  for (const [bucket, subtype] of MODULE_BUCKETS) {
    const rows = envelope[bucket] as Array<Record<string, unknown>>;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        return `${bucket}[${i}]: must be an object`;
      }
      const result = payloadSchema(subtype).safeParse(row.payload);
      if (!result.success) {
        return `${label(bucket, i, row)}: ${firstIssue(result.error, "payload")}`;
      }
    }
  }
  for (let i = 0; i < envelope.bundles.length; i++) {
    const row = envelope.bundles[i];
    const result = bundleShape.safeParse(row);
    if (!result.success) {
      const entity = row && typeof row === "object" ? row : {};
      return `${label("bundles", i, entity)}: ${firstIssue(result.error, "")}`;
    }
  }
  return null;
}

/** `parsePayload` plus the shape check: the parse every install path uses. */
export function parseCheckedPayload(raw: string): ParseResult {
  const parsed = parsePayload(raw);
  if (!parsed.ok) return parsed;
  const shapeError = checkEnvelopeShapes(parsed.payload);
  return shapeError ? { ok: false, reason: `invalid item: ${shapeError}` } : parsed;
}
