import { defineStore } from "pinia";
import { ref } from "vue";
import { api } from "../api/client";
import type {
  DatabaseInfo, MaintenanceOp, MaintenanceResult,
} from "../api/types";

/**
 * Read-only DB info + maintenance op runner.
 *
 * Auto-refetch policy (matches spec):
 *   - on success: refetch info to reflect new size/freelist/etc.
 *   - on {ok:false} body: refetch — migrate-partial state may have changed
 *   - on network/throw: do NOT refetch (server unreachable; would just fail)
 */
export const useDatabaseStore = defineStore("database", () => {
  const info = ref<DatabaseInfo | null>(null);
  const loading = ref(false);
  const runningOp = ref<MaintenanceOp | null>(null);
  const lastError = ref<string | null>(null);

  async function fetchInfo(): Promise<void> {
    loading.value = true;
    lastError.value = null;
    try {
      info.value = await api.database.info();
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err);
    } finally {
      loading.value = false;
    }
  }

  async function runOp(op: MaintenanceOp): Promise<MaintenanceResult> {
    runningOp.value = op;
    let result: MaintenanceResult;
    let serverReached = true;
    try {
      result = await api.database.maintenance(op);
    } catch (err) {
      serverReached = false;
      result = {
        ok: false,
        op,
        duration_ms: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      runningOp.value = null;
    }
    if (serverReached) {
      await fetchInfo();
    }
    return result;
  }

  return { info, loading, runningOp, lastError, fetchInfo, runOp };
});
