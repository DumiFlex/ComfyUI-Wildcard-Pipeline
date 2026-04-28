/**
 * Pinia store for the Community tab.
 *
 * Wraps the mock API in `community/mockApi.ts`. State (auth, install
 * history, stars) is persisted via mockApi → localStorage so the SPA's
 * runtime ref state stays in sync across reloads.
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import * as api from "../community/mockApi";
import type {
  CommunityApiStatus,
  CommunityAtom,
  CommunityInstallEntry,
  CommunitySearchQuery,
  CommunityUploadPayload,
  CommunityUser,
} from "../community/types";

export const useCommunityStore = defineStore("community", () => {
  const currentUser = ref<CommunityUser | null>(api.getCurrentUser());
  const apiStatus = ref<CommunityApiStatus>("online");
  const installed = ref<Set<string>>(new Set(api.getInstalled()));
  const starred = ref<Set<string>>(new Set(api.getStarred()));
  const myUploads = ref<Set<string>>(new Set(api.getMyUploads()));
  const installHistory = ref<CommunityInstallEntry[]>(api.getInstallHistory());
  const featured = ref<CommunityAtom[]>([]);
  const feed = ref<CommunityAtom[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  /** Mock-only: read-only assumed engine version. */
  const engineVersion = ref("1.4");

  /* ------------------------------ helpers ------------------------------ */

  function setApiStatus(status: CommunityApiStatus) {
    apiStatus.value = status;
  }

  async function refreshApiStatus() {
    try {
      apiStatus.value = await api.getApiStatus();
    } catch {
      apiStatus.value = "offline";
    }
    return apiStatus.value;
  }

  /* -------------------------------- auth ------------------------------- */

  async function signIn() {
    try {
      currentUser.value = await api.signInWithGitHub();
    } catch (e) {
      apiStatus.value = "offline";
      throw e;
    }
  }

  async function signOut() {
    await api.signOut();
    currentUser.value = null;
  }

  /* ------------------------------- catalog ----------------------------- */

  async function loadFeatured() {
    try {
      featured.value = await api.getFeatured();
      apiStatus.value = "online";
    } catch {
      featured.value = [];
      apiStatus.value = "offline";
    }
  }

  async function search(query: CommunitySearchQuery = {}) {
    loading.value = true;
    error.value = null;
    try {
      feed.value = await api.searchModules({ ...query, engine: engineVersion.value });
      apiStatus.value = "online";
    } catch (e) {
      feed.value = [];
      apiStatus.value = "offline";
      error.value = e instanceof Error ? e.message : "error";
    } finally {
      loading.value = false;
    }
  }

  async function getModule(id: string) {
    return await api.getModule(id);
  }

  /* --------------------------- install + stars ------------------------- */

  async function install(id: string) {
    await api.installModule(id);
    installed.value = new Set([...installed.value, id]);
    installHistory.value = api.getInstallHistory();
  }

  async function uninstall(id: string) {
    await api.uninstallModule(id);
    const next = new Set(installed.value);
    next.delete(id);
    installed.value = next;
  }

  async function toggleStar(id: string) {
    const willStar = !starred.value.has(id);
    await api.starModule(id, willStar);
    const next = new Set(starred.value);
    if (willStar) next.add(id);
    else next.delete(id);
    starred.value = next;
  }

  /* ------------------------------- upload ------------------------------ */

  async function upload(payload: CommunityUploadPayload) {
    const result = await api.uploadModule(payload);
    myUploads.value = new Set([...myUploads.value, result.id]);
    return result;
  }

  /* ------------------------------ getters ------------------------------ */

  const isInstalled = computed(() => (id: string) => installed.value.has(id));
  const isStarred = computed(() => (id: string) => starred.value.has(id));
  const isMyUpload = computed(() => (id: string) => myUploads.value.has(id));

  return {
    // state
    currentUser,
    apiStatus,
    installed,
    starred,
    myUploads,
    installHistory,
    featured,
    feed,
    loading,
    error,
    engineVersion,
    // actions
    setApiStatus,
    refreshApiStatus,
    signIn,
    signOut,
    loadFeatured,
    search,
    getModule,
    install,
    uninstall,
    toggleStar,
    upload,
    // getters
    isInstalled,
    isStarred,
    isMyUpload,
  };
});
