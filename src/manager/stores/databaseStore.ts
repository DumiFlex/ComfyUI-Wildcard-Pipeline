import { defineStore } from "pinia";
import { ref } from "vue";
import { api } from "../api/client";
import type {
  DatabaseConfig, DatabaseConfigUpdate,
  DatabaseInfo, MaintenanceOp, MaintenanceResult,
} from "../api/types";

/**
 * Read-only DB info + maintenance op runner, plus location-config state.
 *
 * Maintenance auto-refetch policy (matches spec):
 *   - on success: refetch info to reflect new size/freelist/etc.
 *   - on {ok:false} body: refetch — migrate-partial state may have changed
 *   - on network/throw: do NOT refetch (server unreachable; would just fail)
 *
 * Location-config actions (additive, do not touch maintenance state):
 *   - `fetchConfig()` — loads sidecar preference + pending move + per-location
 *     existence/size into `config`.
 *   - `setConfig(update)` — PUT a partial update; omitted keys preserved,
 *     `null` values explicitly clear. Returns the new `DatabaseConfig` on
 *     success or `null` on failure (with `configError` populated).
 *   - `cancelPendingMove()` — DELETE shortcut for clearing only `pending_move`.
 *
 * `configError` is independent from `lastError` so a maintenance failure does
 * not blank out a config-error banner and vice versa.
 */
export const useDatabaseStore = defineStore("database", () => {
  const info = ref<DatabaseInfo | null>(null);
  const loading = ref(false);
  const runningOp = ref<MaintenanceOp | null>(null);
  const lastError = ref<string | null>(null);

  const config = ref<DatabaseConfig | null>(null);
  const configLoading = ref(false);
  const configError = ref<string | null>(null);
  const savingConfig = ref(false);

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

  async function fetchConfig(): Promise<void> {
    configLoading.value = true;
    configError.value = null;
    try {
      config.value = await api.database.config();
    } catch (err) {
      configError.value = err instanceof Error ? err.message : String(err);
    } finally {
      configLoading.value = false;
    }
  }

  async function setConfig(update: DatabaseConfigUpdate): Promise<DatabaseConfig | null> {
    savingConfig.value = true;
    configError.value = null;
    try {
      const result = await api.database.setConfig(update);
      config.value = result;
      return result;
    } catch (err) {
      configError.value = err instanceof Error ? err.message : String(err);
      return null;
    } finally {
      savingConfig.value = false;
    }
  }

  async function cancelPendingMove(): Promise<void> {
    savingConfig.value = true;
    configError.value = null;
    try {
      config.value = await api.database.clearPendingMove();
    } catch (err) {
      configError.value = err instanceof Error ? err.message : String(err);
    } finally {
      savingConfig.value = false;
    }
  }

  return {
    info, loading, runningOp, lastError, fetchInfo, runOp,
    config, configLoading, configError, savingConfig,
    fetchConfig, setConfig, cancelPendingMove,
  };
});
