/**
 * Row and label looks shared by WP Toggles and WP Seeds: a PrimeIcons name
 * (without `pi-`) and `#rrggbb` colours, chosen with the kit's IconPicker and
 * ColorField. Looks are frontend-only: the engine never reads them.
 */
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const ICON_RE = /^[a-z0-9-]{1,40}$/;

/** A `#rrggbb` colour (lower case), or "" for anything else. */
export function hexColor(v: unknown): string {
  return typeof v === "string" && HEX_RE.test(v.trim()) ? v.trim().toLowerCase() : "";
}

/** A PrimeIcons name (without `pi-`), or "" for anything else. */
export function iconName(v: unknown): string {
  const s = (typeof v === "string" ? v.trim() : "").replace(/^pi-/, "");
  return ICON_RE.test(s) ? s : "";
}

/** A colour field's value: the colour, or `none`. */
export function colorFieldValue(v: string | undefined): string {
  return v ?? "none";
}

/** A colour field's pick as a stored colour (`none` clears it). */
export function pickedColor(v: string): string | undefined {
  return hexColor(v.slice(0, 7)) || undefined;
}

/** A label's variable colour 1..8 from saved JSON (absent: undefined). */
export function labelColorIndex(v: unknown): number | undefined {
  return typeof v === "number" && v >= 1 && v <= 8 ? Math.round(v) : undefined;
}
