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

export type PipelineModule = WildcardModule | FixedModule | CombineModule;

export type ModuleType = PipelineModule["type"];

export const MODULE_TYPE_LABELS: Record<ModuleType, string> = {
  wildcard: "Wildcard",
  fixed: "Fixed",
  combine: "Combine",
};
