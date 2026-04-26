import type {
  CategoryCreateInput, CategoryRow,
  ImportBundle, ImportResult,
  MatchRequest, MatchResponse,
  ModuleCreateInput, ModuleListResponse, ModuleRow, ModuleUpdateInput,
  SnapshotShape, TestRequest, TestResponse,
} from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined ?? {}),
  };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const resp = await fetch(path, { ...init, headers });
  if (resp.status === 204) return undefined as T;
  let body: unknown;
  try { body = await resp.json(); } catch { body = null; }
  if (!resp.ok) {
    const message = (body as { error?: string } | null)?.error
      ?? `request failed (${resp.status})`;
    throw new ApiError(resp.status, message);
  }
  return body as T;
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") usp.append(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

interface ListParams {
  type?: string;
  category?: string;
  q?: string;
  favorites?: boolean;
  limit?: number;
  offset?: number;
}

export const api = {
  modules: {
    list(params: ListParams = {}) {
      const query = qs({
        type: params.type,
        category: params.category,
        q: params.q,
        favorites: params.favorites ? "1" : undefined,
        limit: params.limit,
        offset: params.offset,
      });
      return request<ModuleListResponse>(`/wp/api/modules${query}`, { method: "GET" });
    },
    get(id: string) {
      return request<ModuleRow>(`/wp/api/modules/${id}`, { method: "GET" });
    },
    create(body: ModuleCreateInput) {
      return request<ModuleRow>("/wp/api/modules", {
        method: "POST", body: JSON.stringify(body),
      });
    },
    update(id: string, body: ModuleUpdateInput) {
      return request<ModuleRow>(`/wp/api/modules/${id}`, {
        method: "PUT", body: JSON.stringify(body),
      });
    },
    delete(id: string) {
      return request<void>(`/wp/api/modules/${id}`, { method: "DELETE" });
    },
    snapshot(id: string) {
      return request<SnapshotShape>(`/wp/api/modules/${id}/snapshot`, { method: "POST" });
    },
    duplicate(id: string) {
      return request<ModuleRow>(`/wp/api/modules/${id}/duplicate`, { method: "POST" });
    },
    favorite(id: string) {
      return request<ModuleRow>(`/wp/api/modules/${id}/favorite`, { method: "POST" });
    },
    match(body: MatchRequest) {
      return request<MatchResponse>("/wp/api/modules/match", {
        method: "POST", body: JSON.stringify(body),
      });
    },
  },
  categories: {
    list() {
      return request<{ items: CategoryRow[] }>("/wp/api/categories", { method: "GET" });
    },
    create(body: CategoryCreateInput) {
      return request<CategoryRow>("/wp/api/categories", {
        method: "POST", body: JSON.stringify(body),
      });
    },
    update(id: string, body: Partial<CategoryCreateInput>) {
      return request<CategoryRow>(`/wp/api/categories/${id}`, {
        method: "PUT", body: JSON.stringify(body),
      });
    },
    delete(id: string) {
      return request<void>(`/wp/api/categories/${id}`, { method: "DELETE" });
    },
  },
  test(body: TestRequest) {
    return request<TestResponse>("/wp/api/test", {
      method: "POST", body: JSON.stringify(body),
    });
  },
  exportBundle() {
    return request<ImportBundle>("/wp/api/export", { method: "GET" });
  },
  importBundle(bundle: ImportBundle) {
    return request<ImportResult>("/wp/api/import", {
      method: "POST", body: JSON.stringify(bundle),
    });
  },
};
