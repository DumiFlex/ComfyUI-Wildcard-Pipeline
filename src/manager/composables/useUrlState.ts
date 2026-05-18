import { reactive, watch, type UnwrapNestedRefs } from "vue";
import { useRoute, useRouter } from "vue-router";

/** Field kinds the schema understands. Add new kinds here when needed. */
type SchemaKind = "string" | "string-or-null" | "int" | "csv";

interface FieldSpec<V> {
  type: SchemaKind;
  default: V;
  /** Override the URL query param name. Defaults to the state key. */
  urlKey?: string;
}

/** Schema maps each state key to its field spec. */
export type UrlSchema<T> = { [K in keyof T]: FieldSpec<T[K]> };

/** Read a single query value (Vue Router's LocationQueryValue can include null items in arrays). */
function readQuery(val: string | null | (string | null)[] | undefined): string | null {
  if (val == null) return null;
  if (Array.isArray(val)) return val.find((v) => v != null) ?? null;
  return val;
}

function parseField<V>(raw: string | null, spec: FieldSpec<V>): V {
  if (raw == null) return spec.default;
  switch (spec.type) {
    case "string":
      return raw as unknown as V;
    case "string-or-null":
      return (raw === "" ? null : raw) as unknown as V;
    case "int": {
      const n = parseInt(raw, 10);
      return (Number.isFinite(n) ? n : spec.default) as unknown as V;
    }
    case "csv":
      return raw.split(",").map((s) => s.trim()).filter(Boolean) as unknown as V;
  }
}

function serializeField<V>(value: V, spec: FieldSpec<V>): string | undefined {
  // Compare against default; if equal, omit from URL.
  if (Array.isArray(value) && Array.isArray(spec.default)) {
    if (value.length === 0 && spec.default.length === 0) return undefined;
    return (value as unknown as string[]).join(",");
  }
  if (value === spec.default) return undefined;
  if (value === null) return undefined; // null is always omitted
  switch (spec.type) {
    case "string":
      return (value as unknown as string) || undefined;
    case "string-or-null":
      return value === null ? undefined : (value as unknown as string);
    case "int":
      return String(value);
    case "csv":
      return (value as unknown as string[]).join(",") || undefined;
  }
}

/**
 * Sync a typed reactive state object with URL query params.
 *
 * - Reads URL on mount; parses each known field per its schema spec.
 * - Watches state; writes back to URL using `router.replace` (no history entry per keystroke).
 * - Defaults are omitted from the URL so links stay short.
 * - Unknown query keys are ignored (and preserved in the URL).
 */
export function useUrlState<T extends object>(
  schema: UrlSchema<T>,
): UnwrapNestedRefs<T> {
  const route = useRoute();
  const router = useRouter();

  // Initial state from URL.
  const initial = {} as T;
  for (const key of Object.keys(schema) as (keyof T)[]) {
    const spec = schema[key];
    const urlKey = spec.urlKey ?? (key as string);
    const raw = readQuery(route.query[urlKey]);
    initial[key] = parseField(raw, spec);
  }
  const state = reactive(initial) as UnwrapNestedRefs<T>;

  // Watch state → URL.
  let writing = false;
  watch(
    () => {
      // Build a stable snapshot of state to trigger watcher.
      const snap: Record<string, unknown> = {};
      for (const key of Object.keys(schema)) {
        snap[key] = (state as Record<string, unknown>)[key];
      }
      return JSON.stringify(snap);
    },
    () => {
      if (writing) return;
      writing = true;
      const nextQuery: Record<string, string | undefined> = {
        ...route.query,
      } as Record<string, string | undefined>;
      for (const key of Object.keys(schema) as (keyof T)[]) {
        const spec = schema[key];
        const urlKey = spec.urlKey ?? (key as string);
        const serialized = serializeField(
          (state as Record<string, unknown>)[key as string],
          spec,
        );
        if (serialized === undefined) delete nextQuery[urlKey];
        else nextQuery[urlKey] = serialized;
      }
      void router
        .replace({
          path: route.path,
          query: nextQuery as Record<string, string>,
        })
        .finally(() => {
          writing = false;
        });
    },
  );

  return state;
}
