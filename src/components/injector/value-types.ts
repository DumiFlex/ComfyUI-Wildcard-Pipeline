/**
 * The Context Injector's value types: the icon and colour each wire type
 * wears, shared by the Injector's rows and WP Debug so a value looks the
 * same on both. Unknown types get a plain circle.
 */

export interface ValueTypeLook {
  icon: string;
  color: string;
}

export const VALUE_TYPES: Record<string, ValueTypeLook> = {
  // Engine-native primitives
  string: { icon: "pi-pencil", color: "var(--wp-amber)" },
  int: { icon: "pi-hashtag", color: "var(--wp-green)" },
  float: { icon: "pi-percentage", color: "var(--wp-var-7)" },
  boolean: { icon: "pi-check-square", color: "var(--wp-var-5)" },
  // Common ComfyUI tensor / model types, stringified by the engine but
  // worth surfacing so the user reads the wire kind.
  image: { icon: "pi-image", color: "var(--wp-var-1)" },
  mask: { icon: "pi-clone", color: "var(--wp-var-6)" },
  latent: { icon: "pi-cloud", color: "var(--wp-var-4)" },
  conditioning: { icon: "pi-comment", color: "var(--wp-var-2)" },
  model: { icon: "pi-cube", color: "var(--wp-var-8)" },
  clip: { icon: "pi-tag", color: "var(--wp-var-3)" },
  vae: { icon: "pi-box", color: "var(--wp-var-6)" },
  audio: { icon: "pi-volume-up", color: "var(--wp-var-7)" },
  video: { icon: "pi-video", color: "var(--wp-var-4)" },
  noise: { icon: "pi-sparkles", color: "var(--wp-var-6)" },
  sigmas: { icon: "pi-chart-line", color: "var(--wp-var-1)" },
  guider: { icon: "pi-compass", color: "var(--wp-var-3)" },
  sampler: { icon: "pi-sliders-h", color: "var(--wp-var-2)" },
};

/** The engine's trace says Python type names (`str`, `bool`). */
const ALIASES: Record<string, string> = { str: "string", bool: "boolean", tensor: "image" };

export const UNKNOWN_TYPE: ValueTypeLook = { icon: "pi-circle", color: "var(--wp-text-dim)" };
/** A templated row (filled from the node's inputs). */
export const TEMPLATE_TYPE: ValueTypeLook = { icon: "pi-bolt", color: "var(--wp-kind-injector)" };

export function valueTypeLook(type: string | undefined | null): ValueTypeLook {
  const t = (type ?? "").trim().toLowerCase();
  return VALUE_TYPES[ALIASES[t] ?? t] ?? UNKNOWN_TYPE;
}
