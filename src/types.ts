export interface WildcardOption {
  value: string;
  weight: number;
  tags?: string[];
}

export interface WildcardModule {
  type: "wildcard";
  source?: string;
  options?: WildcardOption[];
  capture_as: string;
}

export interface FixedModule {
  type: "fixed";
  value: string;
  capture_as: string;
}

export interface CombineModule {
  type: "combine";
  template: string;
  capture_as: string;
}

export interface ConstraintRule {
  when_value: string;
  rule_type: "exclusion" | "weight_bias";
  values: string[];
  multiplier?: number;
}

export interface ConstrainModule {
  type: "constrain";
  target: string;
  source?: string;
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
}

export interface ExportModule {
  type: "export";
  variables: string[];
  prefix?: string;
}

export type PipelineModule = WildcardModule | FixedModule | CombineModule | ConstrainModule | ConditionModule | ExportModule;

export type ModuleType = PipelineModule["type"];

export const MODULE_TYPE_LABELS: Record<ModuleType, string> = {
  wildcard: "Wildcard",
  fixed: "Fixed",
  combine: "Combine",
  constrain: "Constrain",
  condition: "Condition",
  export: "Export",
};
