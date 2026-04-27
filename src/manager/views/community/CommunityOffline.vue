<script setup lang="ts">
/**
 * Community → Offline state.
 *
 * Mock-only — drives the `wp-community-force-offline` localStorage flag so
 * the user can toggle the demo offline / online without fiddling with code.
 */
import { ref } from "vue";
import { useRouter } from "vue-router";
import Button from "primevue/button";
import { useCommunityStore } from "../../stores/communityStore";
import { isForceOffline, setForceOffline } from "../../community/mockApi";

const router = useRouter();
const store = useCommunityStore();

const forced = ref(isForceOffline());

async function retry() {
  const status = await store.refreshApiStatus();
  if (status === "online") {
    router.replace({ name: "community-discover" });
  }
}

async function forceOnline() {
  setForceOffline(false);
  forced.value = false;
  await store.refreshApiStatus();
  router.replace({ name: "community-discover" });
}

function forceOffline() {
  setForceOffline(true);
  forced.value = true;
  store.setApiStatus("offline");
}
</script>

<template>
  <div class="wp-comm-page">
    <div class="wp-comm-empty">
      <i class="pi pi-wifi wp-comm-empty__icon" style="color: var(--wp-danger);" aria-hidden="true" />
      <h3>Registry unreachable</h3>
      <p>
        Community registry is offline. We'll keep retrying.
      </p>
      <div class="actions">
        <Button label="Try again" icon="pi pi-refresh" @click="retry" />
        <Button
          v-if="forced"
          label="Force online (demo)"
          icon="pi pi-check"
          severity="secondary"
          outlined
          @click="forceOnline"
        />
        <Button
          v-else
          label="Force offline (demo)"
          icon="pi pi-times-circle"
          severity="secondary"
          outlined
          @click="forceOffline"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
@import "../../community/community.css";

.actions {
  display: flex;
  gap: 8px;
  justify-content: center;
  margin-top: 16px;
  flex-wrap: wrap;
}
</style>
