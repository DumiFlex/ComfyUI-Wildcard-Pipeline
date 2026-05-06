import { kindIcon } from "../../shared/kind-icons";

export const KIND_TITLE: Record<string, string> = {
  wildcard: "wildcard",
  fixed_values: "fixed",
  combine: "combine",
  derivation: "derivation",
  constraint: "constraint",
};

export function kindHeaderIcon(kind: string): string {
  return kindIcon(kind);
}
