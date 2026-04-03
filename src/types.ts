export interface WildcardOption {
  value: string;
  weight: number;
  tags?: string[];
}

export interface ResourceData {
  id: string;
  name: string;
  tags?: string[];
  category?: string;
}

export interface WildcardBase extends ResourceData {
  version: number;
  options: WildcardOption[];
}

export interface ConstraintBase extends ResourceData {
  rules: ConstraintRule[];
}

export interface PipelineBase extends ResourceData {
  version: number;
  modules: PipelineModule[];
}

export interface WildcardModule {
  type: "wildcard";
  source?: string;
  options?: WildcardOption[];
  capture_as: string;
  __dismissed_conflicts?: DismissableConflictType[];
}

export interface FixedModule {
  type: "fixed";
  value: string;
  capture_as: string;
  __dismissed_conflicts?: DismissableConflictType[];
}

export interface CombineModule {
  type: "combine";
  template: string;
  capture_as: string;
  __dismissed_conflicts?: DismissableConflictType[];
}

export interface ConstraintRule {
  target: string;
  when_variable: string;
  when_value: string;
  rule_type: "exclusion" | "weight_bias";
  values: string[];
  multiplier?: number;
}

export interface ConstraintRuleDraft {
  when_value: string;
  rule_type: "exclusion" | "weight_bias";
  values: string[];
  multiplier?: number;
}

export interface ConstrainModule {
  type: "constrain";
  source?: string;
  target?: string;
  options?: WildcardOption[];
  rules?: ConstraintRule[];
  capture_as?: string;
}

export interface PipelineConstrainModule extends ConstrainModule {
  target?: string;
  options?: WildcardOption[];
  rules?: ConstraintRule[];
  capture_as?: string;
}

export interface ConditionModule {
  type: "condition";
  variable: string;
  if_equals?: string;
  unless_equals?: string;
  value: string;
  fallback?: string;
  capture_as: string;
  __dismissed_conflicts?: DismissableConflictType[];
}

export type DismissableConflictType = "context_overwrite" | "duplicate_variable";

export const DISMISSABLE_CONFLICT_TYPES: readonly DismissableConflictType[] = [
  "context_overwrite",
  "duplicate_variable",
];

export type PipelineModule =
  | WildcardModule
  | FixedModule
  | CombineModule
  | ConstrainModule
  | ConditionModule;

export type WildcardDraft = Omit<WildcardBase, "id"> & { id?: string };
export type ConstraintDraft = Omit<ConstraintBase, "id" | "rules"> & { id?: string; rules: ConstraintRuleDraft[] };
export type PipelineDraft = Omit<PipelineBase, "id"> & { id?: string };

export type WildcardResource = WildcardBase | WildcardDraft;
export type ConstraintResource = ConstraintBase | ConstraintDraft;
export type PipelineResource = PipelineBase | PipelineDraft;

export type ModuleType = PipelineModule["type"];

export const MODULE_TYPE_LABELS: Record<ModuleType, string> = {
  wildcard: "Wildcard",
  fixed: "Fixed",
  combine: "Combine",
  constrain: "Constrain",
  condition: "Condition",
};
