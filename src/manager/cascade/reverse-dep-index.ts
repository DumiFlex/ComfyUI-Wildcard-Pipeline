export interface IncomingRef {
  from_kind: "wildcard" | "fixed_values" | "combine" | "derivation" | "constraint" | "bundle";
  from_id: string;
  from_name: string;
  ref_path: string;
}

export interface LibraryFixture {
  wildcards: Array<{ id: string; name: string; payload: any; category_id?: string | null }>;
  fixed_values: Array<{ id: string; name: string; payload: any; category_id?: string | null }>;
  combines: Array<{ id: string; name: string; payload: any; category_id?: string | null }>;
  derivations: Array<{ id: string; name: string; payload: any; category_id?: string | null }>;
  constraints: Array<{ id: string; name: string; payload: any }>;
  bundles: Array<{ id: string; name: string; children: Array<{ id: string; type: string }> }>;
  categories: Array<{ id: string; name: string }>;
}

export interface ReverseDepIndex {
  toEntity: Map<string, IncomingRef[]>;
  toSubcat: Map<string, IncomingRef[]>;
  toOptionValue: Map<string, IncomingRef[]>;
  toFixedValueName: Map<string, IncomingRef[]>;
  toCombineVar: Map<string, IncomingRef[]>;
  toCategory: Map<string, IncomingRef[]>;
  /** Stable per-option id → refs from constraint exceptions. Lets the
   * WildcardEditor surface a count badge on options that other entities
   * reference, and route option deletes through the cascade flow. */
  toOptionId: Map<string, IncomingRef[]>;
}

export interface DiffEntry {
  entity_id: string;
  removed?: boolean;
  remove_ref?: { kind: string; id?: string; wildcard_id?: string; name?: string; option_id?: string };
  rename_ref?: { kind: string; old: string; new: string };
  /** Set by fix_option_delete: source wildcard's `entity_id` had this
   * option id removed from `payload.options[]`. */
  remove_option?: string;
}

const REF_REGEX = /@\{([0-9a-f]{8})(?::([^}]*))?\}/g;
const VAR_REGEX = /\$([A-Za-z_][A-Za-z0-9_]*)/g;

function pushRef(map: Map<string, IncomingRef[]>, key: string, ref: IncomingRef): void {
  if (!map.has(key)) {
    map.set(key, []);
  }
  map.get(key)!.push(ref);
}

function extractRefs(text: string): Array<{ uuid: string; subcat: string | undefined }> {
  const refs: Array<{ uuid: string; subcat: string | undefined }> = [];
  REF_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = REF_REGEX.exec(text)) !== null) {
    refs.push({ uuid: match[1], subcat: match[2] });
  }
  return refs;
}

function extractVars(text: string): string[] {
  const vars: string[] = [];
  VAR_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = VAR_REGEX.exec(text)) !== null) {
    vars.push(match[1]);
  }
  return vars;
}

function walkObjectForStrings(obj: Record<string, unknown>, callback: (val: string) => void): void {
  for (const value of Object.values(obj)) {
    if (typeof value === "string") {
      callback(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") {
          callback(item);
        } else if (item !== null && typeof item === "object") {
          walkObjectForStrings(item as Record<string, unknown>, callback);
        }
      }
    } else if (value !== null && typeof value === "object") {
      walkObjectForStrings(value as Record<string, unknown>, callback);
    }
  }
}

export function buildIndex(lib: LibraryFixture): ReverseDepIndex {
  const idx: ReverseDepIndex = {
    toEntity: new Map(),
    toSubcat: new Map(),
    toOptionValue: new Map(),
    toFixedValueName: new Map(),
    toCombineVar: new Map(),
    toCategory: new Map(),
    toOptionId: new Map(),
  };

  for (const wildcard of lib.wildcards) {
    const payload = wildcard.payload as Record<string, unknown>;
    const options = (payload.options as Array<Record<string, unknown>>) || [];

    for (const option of options) {
      const value = option.value as string;
      if (typeof value === "string") {
        const refs = extractRefs(value);
        for (const ref of refs) {
          const incomingRef: IncomingRef = {
            from_kind: "wildcard",
            from_id: wildcard.id,
            from_name: wildcard.name,
            ref_path: value,
          };
          pushRef(idx.toEntity, ref.uuid, incomingRef);
          if (ref.subcat) {
            pushRef(idx.toSubcat, `${ref.uuid}:${ref.subcat}`, incomingRef);
          }
        }

        const vars = extractVars(value);
        for (const varName of vars) {
          const varRef: IncomingRef = {
            from_kind: "wildcard",
            from_id: wildcard.id,
            from_name: wildcard.name,
            ref_path: value,
          };
          pushRef(idx.toCombineVar, varName, varRef);
          pushRef(idx.toFixedValueName, varName, varRef);
        }
      }
    }

    if (wildcard.category_id) {
      const catRef: IncomingRef = {
        from_kind: "wildcard",
        from_id: wildcard.id,
        from_name: wildcard.name,
        ref_path: "category",
      };
      pushRef(idx.toCategory, wildcard.category_id, catRef);
    }
  }

  for (const combine of lib.combines) {
    const payload = combine.payload as Record<string, unknown>;
    const template = payload.template as string;
    if (typeof template === "string") {
      const vars = extractVars(template);
      for (const varName of vars) {
        const varRef: IncomingRef = {
          from_kind: "combine",
          from_id: combine.id,
          from_name: combine.name,
          ref_path: template,
        };
        pushRef(idx.toCombineVar, varName, varRef);
        pushRef(idx.toFixedValueName, varName, varRef);
      }
    }

    if (combine.category_id) {
      const catRef: IncomingRef = {
        from_kind: "combine",
        from_id: combine.id,
        from_name: combine.name,
        ref_path: "category",
      };
      pushRef(idx.toCategory, combine.category_id, catRef);
    }
  }

  for (const derivation of lib.derivations) {
    const payload = derivation.payload as Record<string, unknown>;
    const rules = (payload.rules as Array<Record<string, unknown>>) || [];

    for (const rule of rules) {
      const branches = (rule.branches as Array<Record<string, unknown>>) || [];
      for (const branch of branches) {
        const actions = (branch.actions as Array<Record<string, unknown>>) || [];
        for (const action of actions) {
          walkObjectForStrings(action, (val: string) => {
            const refs = extractRefs(val);
            for (const ref of refs) {
              const incomingRef: IncomingRef = {
                from_kind: "derivation",
                from_id: derivation.id,
                from_name: derivation.name,
                ref_path: val,
              };
              pushRef(idx.toEntity, ref.uuid, incomingRef);
              if (ref.subcat) {
                pushRef(idx.toSubcat, `${ref.uuid}:${ref.subcat}`, incomingRef);
              }
            }

            const vars = extractVars(val);
            for (const varName of vars) {
              const varRef: IncomingRef = {
                from_kind: "derivation",
                from_id: derivation.id,
                from_name: derivation.name,
                ref_path: val,
              };
              pushRef(idx.toCombineVar, varName, varRef);
              pushRef(idx.toFixedValueName, varName, varRef);
            }
          });
        }
      }
    }

    if (derivation.category_id) {
      const catRef: IncomingRef = {
        from_kind: "derivation",
        from_id: derivation.id,
        from_name: derivation.name,
        ref_path: "category",
      };
      pushRef(idx.toCategory, derivation.category_id, catRef);
    }
  }

  for (const constraint of lib.constraints) {
    const payload = constraint.payload as Record<string, unknown>;

    const targetId = payload.target_wildcard_id as string;
    if (targetId) {
      const entityRef: IncomingRef = {
        from_kind: "constraint",
        from_id: constraint.id,
        from_name: constraint.name,
        ref_path: `target:${targetId}`,
      };
      pushRef(idx.toEntity, targetId, entityRef);
    }

    const sourceId = payload.source_wildcard_id as string;
    if (sourceId) {
      const entityRef: IncomingRef = {
        from_kind: "constraint",
        from_id: constraint.id,
        from_name: constraint.name,
        ref_path: `source:${sourceId}`,
      };
      pushRef(idx.toEntity, sourceId, entityRef);
    }

    const matrix = payload.matrix as Record<string, Record<string, unknown>>;
    if (matrix && typeof matrix === "object") {
      for (const [sourceKey, targetMap] of Object.entries(matrix)) {
        if (targetMap && typeof targetMap === "object") {
          if (sourceId) {
            const subcatRef: IncomingRef = {
              from_kind: "constraint",
              from_id: constraint.id,
              from_name: constraint.name,
              ref_path: `matrix_source:${sourceKey}`,
            };
            pushRef(idx.toSubcat, `${sourceId}:${sourceKey}`, subcatRef);
          }

          for (const targetKey of Object.keys(targetMap)) {
            if (targetId) {
              const targetSubcatRef: IncomingRef = {
                from_kind: "constraint",
                from_id: constraint.id,
                from_name: constraint.name,
                ref_path: `matrix_target:${targetKey}`,
              };
              pushRef(idx.toSubcat, `${targetId}:${targetKey}`, targetSubcatRef);
            }
          }
        }
      }
    }

    // Per-option-id refs from exception rows. Each exception axis points
    // at one option by stable id; the WildcardEditor uses these counts to
    // gate the option-Remove cascade flow.
    const exceptions = (payload.exceptions as Array<Record<string, unknown>>) || [];
    for (let exIdx = 0; exIdx < exceptions.length; exIdx++) {
      const ex = exceptions[exIdx];
      const exSource = ex.source_id;
      const exTarget = ex.target_id;
      if (typeof exSource === "string" && exSource.length > 0) {
        const exRef: IncomingRef = {
          from_kind: "constraint",
          from_id: constraint.id,
          from_name: constraint.name,
          ref_path: `exceptions[${exIdx}].source_id`,
        };
        pushRef(idx.toOptionId, exSource, exRef);
      }
      if (
        typeof exTarget === "string"
        && exTarget.length > 0
        && exTarget !== exSource
      ) {
        const exRef: IncomingRef = {
          from_kind: "constraint",
          from_id: constraint.id,
          from_name: constraint.name,
          ref_path: `exceptions[${exIdx}].target_id`,
        };
        pushRef(idx.toOptionId, exTarget, exRef);
      }
    }
  }

  for (const bundle of lib.bundles) {
    const children = (bundle.children as Array<Record<string, unknown>>) || [];
    for (const child of children) {
      const childId = child.id as string;
      if (childId) {
        const childRef: IncomingRef = {
          from_kind: "bundle",
          from_id: bundle.id,
          from_name: bundle.name,
          ref_path: `child:${childId}`,
        };
        pushRef(idx.toEntity, childId, childRef);
      }
    }
  }

  return idx;
}

export function refsTo(idx: ReverseDepIndex, kind: string, id: string): IncomingRef[] {
  if (kind === "wildcard" || kind === "fixed_values") {
    return idx.toEntity.get(id) || [];
  }
  return [];
}

export function subcatRefsTo(idx: ReverseDepIndex, wildcard_id: string, subcat: string): IncomingRef[] {
  const key = `${wildcard_id}:${subcat}`;
  return idx.toSubcat.get(key) || [];
}

export function combineVarRefsTo(idx: ReverseDepIndex, name: string): IncomingRef[] {
  return idx.toCombineVar.get(name) || [];
}

export function categoryRefsTo(idx: ReverseDepIndex, category_id: string): IncomingRef[] {
  return idx.toCategory.get(category_id) || [];
}

export function optionRefsTo(idx: ReverseDepIndex, option_id: string): IncomingRef[] {
  return idx.toOptionId.get(option_id) || [];
}

export function applyDiff(idx: ReverseDepIndex, diff: DiffEntry[]): void {
  for (const entry of diff) {
    if (entry.removed) {
      const entityId = entry.entity_id;

      idx.toEntity.forEach((refs, key) => {
        const filtered = refs.filter((r) => r.from_id !== entityId);
        if (filtered.length === 0) {
          idx.toEntity.delete(key);
        } else {
          idx.toEntity.set(key, filtered);
        }
      });

      idx.toSubcat.forEach((refs, key) => {
        const filtered = refs.filter((r) => r.from_id !== entityId);
        if (filtered.length === 0) {
          idx.toSubcat.delete(key);
        } else {
          idx.toSubcat.set(key, filtered);
        }
      });

      idx.toOptionValue.forEach((refs, key) => {
        const filtered = refs.filter((r) => r.from_id !== entityId);
        if (filtered.length === 0) {
          idx.toOptionValue.delete(key);
        } else {
          idx.toOptionValue.set(key, filtered);
        }
      });

      idx.toFixedValueName.forEach((refs, key) => {
        const filtered = refs.filter((r) => r.from_id !== entityId);
        if (filtered.length === 0) {
          idx.toFixedValueName.delete(key);
        } else {
          idx.toFixedValueName.set(key, filtered);
        }
      });

      idx.toCombineVar.forEach((refs, key) => {
        const filtered = refs.filter((r) => r.from_id !== entityId);
        if (filtered.length === 0) {
          idx.toCombineVar.delete(key);
        } else {
          idx.toCombineVar.set(key, filtered);
        }
      });

      idx.toCategory.forEach((refs, key) => {
        const filtered = refs.filter((r) => r.from_id !== entityId);
        if (filtered.length === 0) {
          idx.toCategory.delete(key);
        } else {
          idx.toCategory.set(key, filtered);
        }
      });

      idx.toOptionId.forEach((refs, key) => {
        const filtered = refs.filter((r) => r.from_id !== entityId);
        if (filtered.length === 0) {
          idx.toOptionId.delete(key);
        } else {
          idx.toOptionId.set(key, filtered);
        }
      });
    } else if (entry.remove_ref) {
      const entityId = entry.entity_id;
      const removeRef = entry.remove_ref;

      if (removeRef.kind === "subcat" && removeRef.wildcard_id && removeRef.name) {
        const key = `${removeRef.wildcard_id}:${removeRef.name}`;
        const refs = idx.toSubcat.get(key) || [];
        const filtered = refs.filter((r) => r.from_id !== entityId);
        if (filtered.length === 0) {
          idx.toSubcat.delete(key);
        } else {
          idx.toSubcat.set(key, filtered);
        }
      } else if (removeRef.kind === "category" && removeRef.id) {
        const refs = idx.toCategory.get(removeRef.id) || [];
        const filtered = refs.filter((r) => r.from_id !== entityId);
        if (filtered.length === 0) {
          idx.toCategory.delete(removeRef.id);
        } else {
          idx.toCategory.set(removeRef.id, filtered);
        }
      } else if (removeRef.kind === "wildcard" && removeRef.id) {
        const refs = idx.toEntity.get(removeRef.id) || [];
        const filtered = refs.filter((r) => r.from_id !== entityId);
        if (filtered.length === 0) {
          idx.toEntity.delete(removeRef.id);
        } else {
          idx.toEntity.set(removeRef.id, filtered);
        }
      } else if (removeRef.kind === "option" && removeRef.option_id) {
        const refs = idx.toOptionId.get(removeRef.option_id) || [];
        const filtered = refs.filter((r) => r.from_id !== entityId);
        if (filtered.length === 0) {
          idx.toOptionId.delete(removeRef.option_id);
        } else {
          idx.toOptionId.set(removeRef.option_id, filtered);
        }
      }
    } else if (entry.remove_option) {
      // Source wildcard's own option removed — drop its toOptionId entry
      // entirely so any subsequent refsTo lookup returns empty.
      idx.toOptionId.delete(entry.remove_option);
    }
  }
}
