<template>
  <Teleport to="body">
    <div v-if="visible" class="wp-modal-backdrop" @mousedown.self="close">
      <div class="wp-modal">
        <div class="wp-modal-header">
          <span class="wp-modal-title">Add Module</span>
          <button type="button" class="wp-modal-close" @click="close">&times;</button>
        </div>

        <!-- Category tabs -->
        <div class="wp-modal-tabs">
          <button
            v-for="cat in categories"
            :key="cat.type"
            type="button"
            class="wp-tab"
            :class="{ active: activeTab === cat.type, ['tab-' + cat.type]: true }"
            @click="activeTab = cat.type"
          >
            {{ cat.label }}
          </button>
        </div>

        <div v-if="showSearch" class="wp-modal-search">
          <select v-model="selectedModalCategory" class="wp-cat-filter">
            <option value="">All categories</option>
            <option v-for="c in (activeTab === 'wildcard' ? wildcardCategories : constraintCategories)" :key="c" :value="c">{{ c }}</option>
          </select>
          <input
            ref="searchInput"
            v-model="searchQuery"
            class="wp-search-input"
            placeholder="Search..."
            @keydown.escape="close"
          />
        </div>

        <div class="wp-modal-body">
          <!-- Wildcard: list from API -->
          <template v-if="activeTab === 'wildcard'">
            <div v-if="loadingWildcards" class="wp-modal-loading">Loading...</div>
            <div v-else-if="!filteredWildcards.length" class="wp-modal-empty">
              <template v-if="searchQuery && wildcards.length">No matches.</template>
              <template v-else>
                No wildcards found. Create them in the
                <a href="/wp/wildcards" target="_blank">Manager</a>.
              </template>
            </div>
            <div
              v-for="wc in filteredWildcards"
              :key="wc.name"
              class="wp-modal-item"
              @click="selectWildcard(wc)"
            >
              <span class="wp-module-tag tag-wildcard">wildcard</span>
              <span class="wp-modal-item-name">{{ wc.name }}</span>
              <span class="wp-modal-item-meta">{{ wc.options.length }} options</span>
            </div>
          </template>

          <!-- Constrain: list from API -->
          <template v-else-if="activeTab === 'constrain'">
            <div v-if="loadingConstraints" class="wp-modal-loading">Loading...</div>
            <div v-else-if="!filteredConstraints.length" class="wp-modal-empty">
              <template v-if="searchQuery && constraints.length">No matches.</template>
              <template v-else>
                No constraints found. Create them in the
                <a href="/wp/constraints" target="_blank">Manager</a>.
              </template>
            </div>
            <div
              v-for="ct in filteredConstraints"
              :key="ct.name"
              class="wp-modal-item"
              @click="selectConstraint(ct)"
            >
              <span class="wp-module-tag tag-constrain">constrain</span>
              <span class="wp-modal-item-name">{{ ct.name }}</span>
              <span class="wp-modal-item-meta">{{ ct.rules.length }} rules</span>
              <span v-if="getTargetPreview(ct)" class="wp-modal-item-targets">{{ getTargetPreview(ct) }}</span>
            </div>
          </template>

          <!-- Fixed: inline form -->
          <template v-else-if="activeTab === 'fixed'">
            <div class="wp-modal-form">
              <label class="wp-form-label">Value</label>
              <input
                v-model="fixedForm.value"
                class="wp-form-input"
                placeholder="Enter a fixed value..."
              />
              <label class="wp-form-label">Capture as</label>
              <input
                v-model="fixedForm.capture_as"
                class="wp-form-input"
                placeholder="$variable_name"
              />
              <button
                type="button"
                class="wp-form-submit"
                :disabled="!fixedForm.value || !fixedForm.capture_as"
                @click="submitFixed"
              >Add Fixed Module</button>
            </div>
          </template>

          <!-- Combine: inline form -->
          <template v-else-if="activeTab === 'combine'">
            <div class="wp-modal-form">
              <label class="wp-form-label">Template</label>
              <input
                v-model="combineForm.template"
                class="wp-form-input"
                placeholder="$var1, $var2 style"
              />
              <label class="wp-form-label">Capture as</label>
              <input
                v-model="combineForm.capture_as"
                class="wp-form-input"
                placeholder="$variable_name"
              />
              <button
                type="button"
                class="wp-form-submit"
                :disabled="!combineForm.template || !combineForm.capture_as"
                @click="submitCombine"
              >Add Combine Module</button>
            </div>
          </template>

          <!-- Condition: inline form -->
          <template v-else-if="activeTab === 'condition'">
            <div class="wp-modal-form">
              <label class="wp-form-label">Variable</label>
              <input
                v-model="conditionForm.variable"
                class="wp-form-input"
                placeholder="variable_name"
              />
              <label class="wp-form-label">If equals (optional)</label>
              <input
                v-model="conditionForm.if_equals"
                class="wp-form-input"
                placeholder="match value"
              />
              <label class="wp-form-label">Value</label>
              <input
                v-model="conditionForm.value"
                class="wp-form-input"
                placeholder="output value"
              />
              <label class="wp-form-label">Capture as</label>
              <input
                v-model="conditionForm.capture_as"
                class="wp-form-input"
                placeholder="$variable_name"
              />
              <button
                type="button"
                class="wp-form-submit"
                :disabled="!conditionForm.variable || !conditionForm.capture_as"
                @click="submitCondition"
              >Add Condition Module</button>
            </div>
          </template>

          <!-- Export: inline form -->
          <template v-else-if="activeTab === 'export'">
            <div class="wp-modal-form">
              <label class="wp-form-label">Variables (comma-separated)</label>
              <input
                v-model="exportForm.variablesRaw"
                class="wp-form-input"
                placeholder="location, lighting, mood"
              />
              <label class="wp-form-label">Prefix (optional)</label>
              <input
                v-model="exportForm.prefix"
                class="wp-form-input"
                placeholder="env_"
              />
              <button
                type="button"
                class="wp-form-submit"
                :disabled="!exportForm.variablesRaw.trim()"
                @click="submitExport"
              >Add Export Module</button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue';
import type { PipelineModule } from '@/types';
import type { WildcardData, ConstraintData } from '@/api/client';
import { wildcardApi, constraintApi } from '@/api/client';

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
  (e: 'select', module: PipelineModule): void;
}>();

const categories = [
  { type: 'wildcard' as const, label: 'Wildcard' },
  { type: 'constrain' as const, label: 'Constrain' },
  { type: 'fixed' as const, label: 'Fixed' },
  { type: 'combine' as const, label: 'Combine' },
  { type: 'condition' as const, label: 'Condition' },
  { type: 'export' as const, label: 'Export' },
];

const activeTab = ref<PipelineModule['type']>('wildcard');
const searchQuery = ref('');
const searchInput = ref<HTMLInputElement | null>(null);
const selectedModalCategory = ref('');

const showSearch = computed(() => activeTab.value === 'wildcard' || activeTab.value === 'constrain');

const filteredWildcards = computed(() => {
  let list = wildcards.value;
  if (selectedModalCategory.value) {
    list = list.filter((wc) => wc.category === selectedModalCategory.value);
  }
  if (!searchQuery.value) return list;
  const q = searchQuery.value.toLowerCase();
  return list.filter((wc) => wc.name.toLowerCase().includes(q));
});

const filteredConstraints = computed(() => {
  let list = constraints.value;
  if (selectedModalCategory.value) {
    list = list.filter((ct) => ct.category === selectedModalCategory.value);
  }
  if (!searchQuery.value) return list;
  const q = searchQuery.value.toLowerCase();
  return list.filter((ct) => ct.name.toLowerCase().includes(q));
});

/* ── API data ── */
const wildcards = ref<WildcardData[]>([]);
const constraints = ref<ConstraintData[]>([]);
const wildcardCategories = ref<string[]>([]);
const constraintCategories = ref<string[]>([]);
const loadingWildcards = ref(false);
const loadingConstraints = ref(false);

/* ── Inline forms ── */
const fixedForm = ref({ value: '', capture_as: '' });
const combineForm = ref({ template: '', capture_as: '' });
const conditionForm = ref({ variable: '', if_equals: '', value: '', capture_as: '' });
const exportForm = ref({ variablesRaw: '', prefix: '' });

/* ── Fetch data when modal opens ── */
watch(() => props.visible, async (open) => {
  if (!open) return;
  searchQuery.value = '';
  selectedModalCategory.value = '';
  fixedForm.value = { value: '', capture_as: '' };
  combineForm.value = { template: '', capture_as: '' };
  conditionForm.value = { variable: '', if_equals: '', value: '', capture_as: '' };
  exportForm.value = { variablesRaw: '', prefix: '' };

  loadingWildcards.value = true;
  loadingConstraints.value = true;
  try {
    const [wcs, wcCats] = await Promise.all([
      wildcardApi.list(),
      wildcardApi.categories()
    ]);
    wildcards.value = wcs;
    wildcardCategories.value = wcCats;
  } catch {
    wildcards.value = [];
    wildcardCategories.value = [];
  } finally {
    loadingWildcards.value = false;
  }
  try {
    const [cts, ctCats] = await Promise.all([
      constraintApi.list(),
      constraintApi.categories()
    ]);
    constraints.value = cts;
    constraintCategories.value = ctCats;
  } catch {
    constraints.value = [];
    constraintCategories.value = [];
  } finally {
    loadingConstraints.value = false;
  }
  await nextTick();
  searchInput.value?.focus();
});

watch(activeTab, () => {
  searchQuery.value = '';
  selectedModalCategory.value = '';
  nextTick(() => searchInput.value?.focus());
});

function close() {
  emit('update:visible', false);
}

/* ── Selection handlers ── */

function selectWildcard(wc: WildcardData) {
  const capture = '$' + wc.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  emit('select', {
    type: 'wildcard',
    source: wc.id,
    capture_as: capture,
  });
  close();
}

function selectConstraint(ct: ConstraintData) {
  emit('select', {
    type: 'constrain',
    source: ct.id,
  });
  close();
}

function getTargetPreview(ct: ConstraintData): string {
  const unique = [...new Set(ct.rules.map(r => ('target' in r ? r.target : undefined)).filter(Boolean))];
  if (!unique.length) return '';
  if (unique.length <= 3) return '→ ' + unique.join(', ');
  return '→ ' + unique.slice(0, 3).join(', ') + '...';
}

function submitFixed() {
  const f = fixedForm.value;
  const capture = f.capture_as.startsWith('$') ? f.capture_as : '$' + f.capture_as;
  emit('select', { type: 'fixed', value: f.value, capture_as: capture });
  close();
}

function submitCombine() {
  const f = combineForm.value;
  const capture = f.capture_as.startsWith('$') ? f.capture_as : '$' + f.capture_as;
  emit('select', { type: 'combine', template: f.template, capture_as: capture });
  close();
}

function submitCondition() {
  const f = conditionForm.value;
  const capture = f.capture_as.startsWith('$') ? f.capture_as : '$' + f.capture_as;
  emit('select', {
    type: 'condition',
    variable: f.variable,
    if_equals: f.if_equals || undefined,
    value: f.value,
    capture_as: capture,
  });
  close();
}

function submitExport() {
  const f = exportForm.value;
  const variables = f.variablesRaw.split(',').map(v => v.trim()).filter(Boolean);
  emit('select', {
    type: 'export',
    variables,
    prefix: f.prefix || undefined,
  });
  close();
}
</script>

<style>
@import './widget-theme.css';
</style>

<style scoped>
.wp-modal-backdrop, .wp-modal-backdrop * {
  box-sizing: border-box;
}

.wp-modal-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(2px);
  z-index: 9998;
  display: flex;
  align-items: center;
  justify-content: center;
}

.wp-modal {
  background: var(--p-surface-800, #1e293b);
  border: 1px solid var(--p-surface-600, #475569);
  border-radius: var(--wp-radius);
  width: 480px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.wp-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--p-surface-600, #475569);
}

.wp-modal-title {
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 14px;
  font-weight: 600;
  color: var(--p-text-color, #f8fafc);
}

.wp-modal-close {
  background: none;
  border: none;
  color: var(--p-text-muted-color, #94a3b8);
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}
.wp-modal-close:hover {
  color: var(--wp-red);
}

/* ── Tabs ── */
.wp-modal-tabs {
  display: flex;
  gap: 2px;
  padding: 8px 10px 0;
  border-bottom: 1px solid var(--p-surface-600, #475569);
}

.wp-tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--p-text-muted-color, #94a3b8);
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 11px;
  padding: 6px 10px;
  cursor: pointer;
  transition: all 0.15s;
}
.wp-tab:hover {
  color: var(--p-text-color, #f8fafc);
}
.wp-tab.active {
  color: var(--p-primary-color, #818cf8);
  border-bottom-color: var(--p-primary-color, #818cf8);
}
.wp-tab.active.tab-wildcard { color: var(--p-primary-color, #818cf8); border-bottom-color: var(--p-primary-color, #818cf8); }
.wp-tab.active.tab-constrain { color: var(--wp-amber); border-bottom-color: var(--wp-amber); }
.wp-tab.active.tab-fixed { color: var(--p-text-color, #f8fafc); border-bottom-color: var(--p-text-color, #f8fafc); }
.wp-tab.active.tab-combine { color: var(--wp-teal); border-bottom-color: var(--wp-teal); }
.wp-tab.active.tab-condition { color: var(--wp-green); border-bottom-color: var(--wp-green); }
.wp-tab.active.tab-export { color: var(--wp-pink); border-bottom-color: var(--wp-pink); }

/* ── Search ── */
.wp-modal-search {
  padding: 8px 10px;
  border-bottom: 1px solid var(--p-surface-600, #475569);
  flex-shrink: 0;
}

.wp-cat-filter {
  width: 100%;
  padding: 5px 8px;
  background: var(--p-surface-700, #334155);
  border: 1px solid var(--p-surface-600, #475569);
  border-radius: var(--wp-radius-sm);
  color: var(--p-text-color, #f8fafc);
  font-size: 11px;
  margin-bottom: 4px;
}

.wp-search-input {
  width: 100%;
  padding: 6px 10px;
  background: var(--p-surface-700, #334155);
  border: 1px solid var(--p-surface-600, #475569);
  border-radius: var(--wp-radius-sm);
  color: var(--p-text-color, #f8fafc);
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 12px;
  outline: none;
  transition: border-color 0.15s;
}
.wp-search-input:focus {
  border-color: var(--p-primary-color, #818cf8);
}
.wp-search-input::placeholder {
  color: var(--p-text-muted-color, #94a3b8);
}

/* ── Body ── */
.wp-modal-body {
  padding: 10px;
  overflow-y: auto;
  flex: 1 1 auto;
  min-height: 80px;
}

.wp-modal-loading,
.wp-modal-empty {
  font-size: 12px;
  color: var(--p-text-muted-color, #94a3b8);
  text-align: center;
  padding: 20px 10px;
}
.wp-modal-empty a {
  color: var(--p-primary-color, #818cf8);
  text-decoration: underline;
}

/* ── Selectable items (wildcards/constraints) ── */
.wp-modal-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--wp-radius-sm);
  cursor: pointer;
  transition: all 0.15s;
  flex-wrap: wrap;  /* allow targets to wrap to next line */
}
.wp-modal-item:hover {
  background: var(--p-surface-700, #334155);
}

.wp-modal-item-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--p-text-color, #f8fafc);
  flex: 1;
}

.wp-modal-item-meta {
  font-size: 10px;
  font-family: var(--wp-font-sans, sans-serif);
  color: var(--p-text-muted-color, #94a3b8);
}

.wp-modal-item-targets {
  font-size: 10px;
  font-family: var(--wp-font-sans, sans-serif);
  color: var(--wp-amber);
  width: 100%;
  margin-top: 2px;
}

/* ── Inline forms ── */
.wp-modal-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.wp-form-label {
  font-size: 11px;
  font-family: var(--wp-font-sans, sans-serif);
  color: var(--p-text-muted-color, #94a3b8);
  letter-spacing: 0.02em;
}

.wp-form-input {
  width: 100%;
  padding: 7px 10px;
  background: var(--p-surface-700, #334155);
  border: 1px solid var(--p-surface-600, #475569);
  border-radius: var(--wp-radius-sm);
  color: var(--p-text-color, #f8fafc);
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 12px;
  outline: none;
  transition: border-color 0.15s;
}
.wp-form-input:focus {
  border-color: var(--p-primary-color, #818cf8);
}
.wp-form-input::placeholder {
  color: var(--p-text-muted-color, #94a3b8);
}

.wp-form-submit {
  margin-top: 4px;
  padding: 8px 16px;
  background: var(--p-primary-color, #818cf8);
  color: #fff;
  border: none;
  border-radius: var(--wp-radius-sm);
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.wp-form-submit:hover:not(:disabled) {
  background: var(--p-primary-600, #6366f1);
}
.wp-form-submit:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── Reuse tag styles from PipelineWidget ── */
.wp-module-tag {
  font-size: 9px;
  font-family: var(--wp-font-sans, sans-serif);
  padding: 1px 6px;
  border-radius: 3px;
  letter-spacing: 0.02em;
  font-weight: 500;
  flex-shrink: 0;
}
.tag-wildcard {
  background: var(--wp-accent-glow);
  color: var(--p-primary-color, #818cf8);
  border: 1px solid rgba(124, 106, 247, 0.2);
}
.tag-constrain {
  background: var(--wp-amber-bg);
  color: var(--wp-amber);
  border: 1px solid rgba(251, 191, 36, 0.2);
}
</style>
