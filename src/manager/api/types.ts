export type ModuleType = "wildcard" | "fixed_values";

export interface ModuleRow {
  id: string;
  type: ModuleType;
  name: string;
  description: string;
  category_id: string | null;
  tags: string[];
  is_favorite: boolean;
  payload: Record<string, unknown>;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ModuleListResponse {
  items: ModuleRow[];
  total: number;
}

export interface ModuleCreateInput {
  type: ModuleType;
  name: string;
  description?: string;
  category_id?: string | null;
  tags?: string[];
  payload: Record<string, unknown>;
  is_favorite?: boolean;
}

export interface ModuleUpdateInput {
  name?: string;
  description?: string;
  category_id?: string | null;
  tags?: string[];
  payload?: Record<string, unknown>;
  is_favorite?: boolean;
}

export interface CategoryRow {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  sort_order: number;
}

export interface CategoryCreateInput {
  name: string;
  color?: string | null;
  icon?: string | null;
  sort_order?: number;
}

export interface SnapshotShape {
  library_id: string;
  library_snapshot_at: string;
  library_version_at_snapshot: number;
  type: ModuleType;
  name: string;
  category_id: string | null;
  payload: Record<string, unknown>;
  instance: {
    variable_binding: string;
    enabled_options: string[] | null;
    category_filter: string | null;
  };
}

export interface MatchRequest {
  type: ModuleType;
  name: string;
  payload_hash: string;
}

export type MatchResponse =
  | { matched: false }
  | { matched: true; id: string; version: number };

export interface TestRequest {
  type: ModuleType;
  payload: Record<string, unknown>;
  instance: Record<string, unknown>;
  samples: number;
}

export interface TestResponse {
  results: Record<string, string>[];
  histogram: Record<string, number>;
}

export interface ImportBundle {
  version: 1;
  exported_at?: string;
  modules: ModuleRow[];
  categories: CategoryRow[];
}

export interface ImportResult {
  modules_imported: number;
  categories_imported: number;
  skipped: string[];
}
