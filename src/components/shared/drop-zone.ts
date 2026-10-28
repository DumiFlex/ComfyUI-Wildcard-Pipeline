/**
 * File checks for DropZone: does a file (or a dragged item, whose name is
 * not known until the drop) match an `accept` list like the file input's
 * ("image/*,.txt,application/json")?
 */
export function acceptList(accept: string | undefined): string[] {
  return (accept ?? "").split(",").map((a) => a.trim().toLowerCase()).filter(Boolean);
}

function typeMatches(type: string, rule: string): boolean {
  if (!type) return false;
  const t = type.toLowerCase();
  return rule.endsWith("/*") ? t.startsWith(rule.slice(0, -1)) : t === rule;
}

/** A dropped file: by its extension or its type. An empty list takes all. */
export function fileAccepted(file: { name: string; type: string }, accept: string | undefined): boolean {
  const rules = acceptList(accept);
  if (!rules.length) return true;
  const name = file.name.toLowerCase();
  return rules.some((r) => (r.startsWith(".") ? name.endsWith(r) : typeMatches(file.type, r)));
}

/**
 * A dragged item, before the drop: only its type is known. Returns false
 * only when it surely won't be taken; an item with no type, or a list that
 * names extensions (which we can't see yet), gets the benefit of the doubt.
 */
export function dragItemMaybeAccepted(type: string, accept: string | undefined): boolean {
  const rules = acceptList(accept);
  if (!rules.length || !type) return true;
  if (rules.some((r) => r.startsWith("."))) return true;
  return rules.some((r) => typeMatches(type, r));
}

/** "2.4 MB", "820 KB". */
export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}
