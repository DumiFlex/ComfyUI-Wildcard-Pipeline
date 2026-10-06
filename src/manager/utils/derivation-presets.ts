/**
 * Ready-made derivation rules the editor can drop in.
 *
 * "LoRA by model" pairs with the WP Model Info node: it sets `$loras` from
 * `$model_variant`, so one prompt template carries the right LoRA tags for
 * whichever checkpoint is loaded. The LoRA names are placeholders the user
 * swaps for their own; it is an ordinary rule, so no schema change.
 */
import type { DerivationRule } from "../api/types";

export const LORA_BY_MODEL_TARGET = "loras";

/** Variants the preset branches on, matching the shipped Model Info rules. */
export const LORA_BY_MODEL_VARIANTS = ["pony", "illustrious"] as const;

export function loraByModelRule(id: string): DerivationRule {
  return {
    id,
    branches: LORA_BY_MODEL_VARIANTS.map((variant) => ({
      condition: { var: "model_variant", op: "equals" as const, value: variant },
      action: {
        target_var: LORA_BY_MODEL_TARGET,
        mode: "replace" as const,
        value: `<lora:my_${variant}_lora:0.8>`,
      },
    })),
    else: { action: { target_var: LORA_BY_MODEL_TARGET, mode: "replace", value: "" } },
  };
}
