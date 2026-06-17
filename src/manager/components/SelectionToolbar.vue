<script setup lang="ts">
/**
 * SelectionToolbar — bulk-action bar shown in the wildcard editor's bulk mode
 * when ≥1 option row is checked. Acts on ALL checked rows at once.
 *
 * Presentational: emits intents (apply-tag / remove-tag / set-weight / delete /
 * clear); the host editor mutates + tracks dirty. Applying a tag that isn't in
 * `tags` is a new sub-category — emitted via apply-tag too; the host decides to
 * auto-create it (in Ungrouped).
 */
import { computed, ref } from "vue";
import Button from "./ui/Button.vue";
import Input from "./ui/Input.vue";

interface Props {
  count: number;
  /** Existing sub-category tags, for the apply / remove menus. */
  tags: string[];
}
const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "apply-tag", tag: string): void;
  (e: "remove-tag", tag: string): void;
  (e: "set-weight", weight: number): void;
  (e: "delete-selected"): void;
  (e: "clear"): void;
}>();

type Menu = "apply" | "remove" | "weight" | null;
const openMenu = ref<Menu>(null);
const newTag = ref("");
const weight = ref(1);
const applyFilter = ref("");

function toggle(menu: Exclude<Menu, null>) {
  openMenu.value = openMenu.value === menu ? null : menu;
  newTag.value = "";
  applyFilter.value = "";
}
function close() { openMenu.value = null; }

const filteredTags = computed(() => {
  const q = applyFilter.value.trim().toLowerCase();
  const list = [...props.tags].sort((a, b) => a.localeCompare(b));
  return q ? list.filter((t) => t.toLowerCase().includes(q)) : list;
});
// "new tag" = typed name not matching any existing tag (case-insensitive).
const newTagIsNovel = computed(() => {
  const n = newTag.value.trim();
  return n.length > 0 && !props.tags.some((t) => t.toLowerCase() === n.toLowerCase());
});

function applyTag(tag: string) { emit("apply-tag", tag); close(); }
function applyNewTag() {
  const n = newTag.value.trim();
  if (!n) return;
  emit("apply-tag", n);
  close();
}
function removeTag(tag: string) { emit("remove-tag", tag); close(); }
function applyWeight() {
  const n = Number(weight.value);
  if (!Number.isFinite(n) || n < 0) return;
  emit("set-weight", n);
  close();
}
</script>

<template>
  <div class="wpc-seltoolbar">
    <span class="wpc-seltoolbar__count">{{ count }} selected</span>

    <div class="wpc-seltoolbar__group">
      <!-- Apply sub-category -->
      <div class="wpc-seltoolbar__menuwrap">
        <Button variant="ghost" size="sm" icon="pi-tag" icon-right="pi-chevron-down" @click="toggle('apply')">
          Apply sub-category
        </Button>
        <div v-if="openMenu === 'apply'" class="wpc-seltoolbar__menu" role="menu">
          <input
            v-model="newTag"
            class="wp-input wp-input--sm"
            placeholder="New or existing tag…"
            aria-label="New sub-category"
            @keydown.enter.prevent="applyNewTag"
            @keydown.esc="close"
          />
          <button
            v-if="newTagIsNovel"
            type="button"
            class="wpc-seltoolbar__menuitem wpc-seltoolbar__menuitem--new"
            @click="applyNewTag"
          >
            <i class="pi pi-plus" aria-hidden="true"></i> Create &amp; apply “{{ newTag.trim() }}”
          </button>
          <div class="wpc-seltoolbar__menulist">
            <button
              v-for="t in filteredTags"
              :key="t"
              type="button"
              class="wpc-seltoolbar__menuitem"
              @click="applyTag(t)"
            >{{ t }}</button>
            <div v-if="!filteredTags.length && !newTagIsNovel" class="wpc-seltoolbar__menuempty">No sub-categories yet</div>
          </div>
        </div>
      </div>

      <!-- Remove sub-category -->
      <div class="wpc-seltoolbar__menuwrap">
        <Button variant="ghost" size="sm" icon="pi-minus-circle" icon-right="pi-chevron-down" @click="toggle('remove')">
          Remove sub-category
        </Button>
        <div v-if="openMenu === 'remove'" class="wpc-seltoolbar__menu" role="menu">
          <div class="wpc-seltoolbar__menulist">
            <button
              v-for="t in filteredTags"
              :key="t"
              type="button"
              class="wpc-seltoolbar__menuitem"
              @click="removeTag(t)"
            >{{ t }}</button>
            <div v-if="!filteredTags.length" class="wpc-seltoolbar__menuempty">No sub-categories</div>
          </div>
        </div>
      </div>

      <!-- Set weight -->
      <div class="wpc-seltoolbar__menuwrap">
        <Button variant="ghost" size="sm" icon="pi-sliders-h" icon-right="pi-chevron-down" @click="toggle('weight')">
          Set weight
        </Button>
        <div v-if="openMenu === 'weight'" class="wpc-seltoolbar__menu wpc-seltoolbar__menu--weight" role="menu">
          <Input
            v-model="weight"
            type="number"
            size="sm"
            :min="0"
            :step="0.1"
            aria-label="Weight"
            @keydown.enter.prevent="applyWeight"
            @keydown.esc="close"
          />
          <Button variant="primary" size="sm" @click="applyWeight">Apply</Button>
        </div>
      </div>
    </div>

    <div class="wpc-seltoolbar__spacer"></div>

    <Button variant="danger" size="sm" icon="pi-trash" @click="emit('delete-selected')">Delete</Button>
    <Button variant="ghost" size="sm" @click="emit('clear')">Clear</Button>
  </div>

  <!-- click-outside backdrop (button so it's keyboard-dismissable + lint-clean) -->
  <button
    v-if="openMenu"
    type="button"
    class="wpc-seltoolbar__backdrop"
    aria-label="Close menu"
    @click="close"
  ></button>
</template>

<style scoped>
.wpc-seltoolbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid color-mix(in oklab, var(--wp-accent) 40%, transparent);
  border-radius: 8px;
  background: color-mix(in oklab, var(--wp-accent) 12%, var(--wp-bg-2));
  flex-wrap: wrap;
}
.wpc-seltoolbar__count {
  font-size: 13px;
  font-weight: 600;
  color: var(--wp-text);
  white-space: nowrap;
}
.wpc-seltoolbar__group { display: flex; gap: 6px; flex-wrap: wrap; }
.wpc-seltoolbar__spacer { flex: 1; }
.wpc-seltoolbar__menuwrap { position: relative; }
.wpc-seltoolbar__menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 30;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--wp-border);
  border-radius: 8px;
  background: var(--wp-bg-1);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.wpc-seltoolbar__menu--weight { flex-direction: row; align-items: center; min-width: 0; }
.wpc-seltoolbar__menu--weight :deep(.wp-input-group) { width: 96px; }
.wpc-seltoolbar__menulist {
  display: flex;
  flex-direction: column;
  max-height: 220px;
  overflow-y: auto;
}
.wpc-seltoolbar__menuitem {
  text-align: left;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--wp-text);
  font-size: 13px;
  cursor: pointer;
}
.wpc-seltoolbar__menuitem:hover { background: var(--wp-bg-3); }
.wpc-seltoolbar__menuitem--new { color: var(--wp-accent); font-weight: 600; }
.wpc-seltoolbar__menuempty { padding: 6px 8px; font-size: 12px; color: var(--wp-text-muted); }
.wpc-seltoolbar__backdrop {
  position: fixed;
  inset: 0;
  z-index: 19;
  border: none;
  padding: 0;
  margin: 0;
  background: transparent;
  cursor: default;
}
</style>
