<script setup lang="ts">
/**
 * Library health — one page over the whole library listing what is broken
 * (problems), probably a mistake (warnings) and clutter (tidy up), each row
 * with a way to fix it. The checks live in `engine/health.py`; this page
 * groups them, filters, ignores and deletes. Bundles also get an on-demand
 * variety run (200 random seeds through the Test Runner's engine path).
 */
import Disclosure from "@/kit/Disclosure.vue";
import SearchInput from "@/kit/SearchInput.vue";
import WpSegmented, { type SegmentedOption } from "@/kit/WpSegmented.vue";
import WpSwitch from "@/kit/WpSwitch.vue";
import ProgressBar from "@/kit/ProgressBar.vue";
import Banner from "@/kit/Banner.vue";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import Button from "@/kit/Button.vue";
import Chip from "@/kit/Chip.vue";
import ConfirmModal from "@/kit/ConfirmModal.vue";
import DataTable, { type DataColumn } from "@/kit/DataTable.vue";
import Drawer from "@/kit/Drawer.vue";
import EmptyState from "@/kit/EmptyState.vue";
import Icon from "@/kit/Icon.vue";
import RelativeDate from "@/kit/RelativeDate.vue";
import CommunityUpdateDialog from "../components/CommunityUpdateDialog.vue";
import { api, ApiError } from "../api/client";
import type {
  BundleRow, HealthCheckInfo, HealthFinding, HealthItem, HealthSeverity, HealthVariety,
} from "../api/types";
import { useToast } from "@/kit/useToast";
import { registerPageNote } from "../composables/useOpenEditor";
import { useHealthStore } from "../stores/healthStore";
import { useModuleStore } from "../stores/moduleStore";
import { useBundleStore } from "../stores/bundleStore";
import { useCategoryStore } from "../stores/categoryStore";
import { useCommunityUpdateStore, type UpdateEntry } from "../stores/communityUpdateStore";
import { kindIcon } from "../../components/shared/kind-icons";

const router = useRouter();
const toast = useToast();
const health = useHealthStore();
const moduleStore = useModuleStore();
const bundleStore = useBundleStore();
const categoryStore = useCategoryStore();
const communityUpdates = useCommunityUpdateStore();

type Filter = "all" | HealthSeverity;
const filter = ref<Filter>("all");
const query = ref("");
const showIgnored = ref(false);

const SEVERITY_LABEL: Record<HealthSeverity, string> = {
  problem: "Problem",
  warning: "Warning",
  tidy: "Tidy up",
};
const SEVERITY_TONE: Record<HealthSeverity, "danger" | "warn" | "info"> = {
  problem: "danger",
  warning: "warn",
  tidy: "info",
};
const SEVERITY_ICON: Record<HealthSeverity, string> = {
  problem: "pi-times-circle",
  warning: "pi-exclamation-triangle",
  tidy: "pi-inbox",
};
const SUMMARY: Array<{ severity: HealthSeverity; text: string }> = [
  { severity: "problem", text: "Print wrong or nothing" },
  { severity: "warning", text: "Probably a mistake" },
  { severity: "tidy", text: "Clutter, nothing breaks" },
];

/** One line per check under its title: why it matters. */
const WHY: Record<string, string> = {
  missing_ref: "A @{reference} to a deleted wildcard prints nothing where it sits.",
  constraint_missing_wildcard: "A constraint whose wildcard is gone never applies.",
  constraint_stale_rule: "Rules that name options or tags the wildcard no longer has never match.",
  bundle_missing_bundle: "Inserting the bundle skips the missing part.",
  empty_bundle: "Inserting it adds nothing.",
  unnamed: "Items without a name are hard to find in pickers and references.",
  wildcard_dead: "It always prints nothing.",
  unset_read: "Unless something on the canvas sets the variable, it prints as empty.",
  duplicate_name: "Two items with one name are easy to mix up in pickers.",
  same_options: "Often the same pack imported twice.",
  duplicate_options: "A repeated option rolls twice as often. A higher weight says that more clearly.",
  zero_weight: "Weight 0 options stay in the list but never roll.",
  shared_variable: "On one chain the later wildcard replaces the earlier one's value.",
  bundle_detached: "The bundle still runs its copies, but they no longer follow the library.",
  unused: "Nothing in the library uses these. Items placed only on a canvas show here unless that canvas is open.",
  unread_variable: "Nothing in the library prints these variables. An Assembler on a canvas might.",
  bundle_outdated: "The bundle keeps the copy from when it was saved. Open it to take the library's version.",
  tag_once: "Often a typo of another tag.",
  empty_category: "Nothing is filed under these categories.",
  newer_format: "Some settings were left out when it was installed.",
  community_update: "The author published a newer version.",
};

const FILTERS = computed<SegmentedOption<Filter>[]>(() => {
  const c = health.counts;
  return [
    { value: "all", label: `All ${c.problem + c.warning + c.tidy}` },
    { value: "problem", label: `Problems ${c.problem}` },
    { value: "warning", label: `Warnings ${c.warning}` },
    { value: "tidy", label: `Tidy up ${c.tidy}` },
  ];
});

function matches(f: HealthFinding, q: string): boolean {
  if (!q) return true;
  const hay = [f.item.name, f.item.id, f.detail, ...(f.values ?? []), ...(f.others ?? []).map((o) => o.name)]
    .join(" ").toLowerCase();
  return hay.includes(q);
}

const ignoredCount = computed(() => health.findings.filter((f) => health.ignored.has(f.key)).length);

interface Group { check: HealthCheckInfo; rows: HealthFinding[] }
const groups = computed<Group[]>(() => {
  const q = query.value.trim().toLowerCase();
  const shown = health.findings.filter((f) =>
    (filter.value === "all" || f.severity === filter.value)
    && (showIgnored.value || !health.ignored.has(f.key))
    && matches(f, q));
  const order: HealthSeverity[] = ["problem", "warning", "tidy"];
  return [...health.checks]
    .sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))
    .map((check) => ({ check, rows: shown.filter((f) => f.check === check.id) }))
    .filter((g) => g.rows.length > 0);
});

const COLUMNS: DataColumn<HealthFinding>[] = [
  { key: "item", label: "Item", width: "240px" },
  { key: "detail", label: "What's wrong" },
  { key: "actions", label: "Actions", hideLabel: true, align: "right", width: "220px" },
];

// ── Opening ───────────────────────────────────────────────────────────────
const EDIT_PATH: Record<string, string> = {
  wildcard: "wildcards",
  fixed_values: "fixed-values",
  combine: "combines",
  derivation: "derivations",
  constraint: "constraints",
  bundle: "bundles",
  template: "templates",
};

function itemIcon(item: HealthItem): string {
  if (item.kind === "tag") return "pi-hashtag";
  return kindIcon(item.type).split(" ").pop() ?? "pi-circle";
}

function open(item: HealthItem): void {
  if (item.kind === "tag") {
    void router.push({ path: "/all", query: { tag: item.id } });
  } else if (item.kind === "category") {
    void router.push("/categories");
  } else {
    const base = EDIT_PATH[item.type];
    if (base) void router.push(`/${base}/${item.id}/edit`);
  }
}

function openLabel(f: HealthFinding): string {
  if (f.item.kind === "tag") return "Show items";
  if (f.item.kind === "category") return "Categories";
  return "Open";
}

// ── Community updates ─────────────────────────────────────────────────────
const updateEntry = ref<UpdateEntry | null>(null);
function openUpdate(f: HealthFinding): void {
  updateEntry.value = communityUpdates.entryFor(f.item.id);
}

// ── Ignore ────────────────────────────────────────────────────────────────
async function toggleIgnore(f: HealthFinding): Promise<void> {
  const ignoring = !health.ignored.has(f.key);
  try {
    await (ignoring ? health.setIgnored([f.key]) : health.setIgnored([], [f.key]));
    if (ignoring) {
      toast.push({
        severity: "info", summary: `Ignored "${f.item.name}"`,
        detail: "Turn on Show ignored to bring it back.", life: 3000,
      });
    }
  } catch (e) {
    reportError(e, "Couldn't save that");
  }
}

// ── Delete ────────────────────────────────────────────────────────────────
function canDelete(f: HealthFinding): boolean {
  return (f.check === "unused" && f.item.kind === "module")
    || (f.check === "empty_category" && f.item.kind === "category");
}

const deleting = ref<HealthFinding[] | null>(null);
const deleteBusy = ref(false);
const deleteTitle = computed(() => {
  const rows = deleting.value ?? [];
  return rows.length === 1 ? `Delete "${rows[0].item.name}"?` : `Delete ${rows.length} items?`;
});
const deleteBody = computed(() => {
  const rows = deleting.value ?? [];
  if (rows.length === 1 && rows[0].item.kind === "category") {
    return "Removes the empty category. No item changes.";
  }
  return "Removes them from the library. Copies already placed on a canvas keep working, "
    + "and a backup from Settings › Library & data can bring them back.";
});

function askDeleteAll(group: Group): void {
  deleting.value = group.rows.filter((f) => canDelete(f) && !health.ignored.has(f.key));
}

async function confirmDelete(): Promise<void> {
  const rows = deleting.value ?? [];
  deleteBusy.value = true;
  let done = 0;
  try {
    for (const f of rows) {
      if (f.item.kind === "category") await categoryStore.remove(f.item.id);
      else await moduleStore.remove(f.item.id);
      done += 1;
    }
    toast.push({
      severity: "success",
      summary: done === 1 ? `Deleted "${rows[0].item.name}"` : `Deleted ${done} items`,
      life: 3000,
    });
  } catch (e) {
    reportError(e, done ? `Deleted ${done}, then stopped` : "Delete failed");
  } finally {
    deleteBusy.value = false;
    deleting.value = null;
    void health.refresh();
  }
}

// ── Variety ───────────────────────────────────────────────────────────────
const varietyBundle = ref<BundleRow | null>(null);
const variety = ref<HealthVariety | null>(null);
const varietyBusy = ref(false);
const varietyOpen = computed({
  get: () => varietyBundle.value !== null,
  set: (v: boolean) => { if (!v) varietyBundle.value = null; },
});

/** Bumped per run, so a slow earlier run can't land in a newer drawer. */
let varietyRun = 0;

async function runVariety(b: BundleRow): Promise<void> {
  const run = ++varietyRun;
  varietyBundle.value = b;
  variety.value = null;
  varietyBusy.value = true;
  try {
    const res = await api.health.variety(b.id);
    if (run === varietyRun) variety.value = res;
  } catch (e) {
    if (run !== varietyRun) return;
    reportError(e, "Variety check failed");
    varietyBundle.value = null;
  } finally {
    if (run === varietyRun) varietyBusy.value = false;
  }
}

const varietyPercent = computed(() => Math.round((variety.value?.ratio ?? 0) * 100));
const varietyTone = computed(() => {
  const p = varietyPercent.value;
  return p >= 60 ? "success" : p >= 25 ? "warn" : "danger";
});

function openInTestRunner(): void {
  const b = varietyBundle.value;
  if (!b) return;
  varietyBundle.value = null;
  void router.push({ path: "/test", query: { kind: "bundle", module: b.id } });
}

// ── Load ──────────────────────────────────────────────────────────────────
function reportError(e: unknown, summary: string): void {
  const msg = e instanceof ApiError ? e.message : String(e);
  toast.push({ severity: "error", summary, detail: msg, life: 4000 });
}

onMounted(() => {
  // The first visit's ensure() starts a scan; later visits check again.
  if (!health.ensure()) void health.refresh();
  if (!bundleStore.catalog.length) void bundleStore.fetchCatalog().catch(() => {});
});

registerPageNote(() => {
  const c = health.counts;
  if (!health.scan) return "Library health page: checking the library";
  const head = `Library health page: ${c.problem} problems, ${c.warning} warnings, ${c.tidy} to tidy up`;
  const lines = groups.value.slice(0, 12).map((g) =>
    `${g.check.title} (${g.rows.length}): ${g.rows.slice(0, 6).map((f) => f.item.name).join(", ")}`);
  return [head, ...lines].join(". ");
});
</script>

<template>
  <div class="wp-route-root">
  <div class="wp-page wp-health">
    <div class="wp-page__header">
      <div class="wp-page__title-wrap">
        <h1 class="wp-page__title">Library health</h1>
        <p class="wp-page__subtitle">
          What in your library is broken, probably a mistake, or just clutter.
          <template v-if="health.scan">
            Checked <RelativeDate :value="health.scan.checked_at" />,
            {{ health.scan.canvas ? "with the open canvas" : "without a canvas" }}.
          </template>
        </p>
      </div>
      <div class="wp-page__actions">
        <Button
          variant="secondary"
          icon="pi-refresh"
          :loading="health.loading"
          data-test="health-recheck"
          @click="health.refresh()"
        >Check again</Button>
      </div>
    </div>

    <Banner v-if="health.error" tone="danger" title="Couldn't check the library">{{ health.error }}</Banner>

    <div class="wp-health__summary" aria-label="Summary">
      <div
        v-for="s in SUMMARY"
        :key="s.severity"
        class="wp-health__card"
        :data-severity="s.severity"
        :data-test="`health-card-${s.severity}`"
      >
        <span class="wp-health__card-icon"><Icon :name="SEVERITY_ICON[s.severity]" /></span>
        <span class="wp-health__card-text">
          <span class="wp-health__card-count">{{ health.counts[s.severity] }}</span>
          <span class="wp-health__card-label">{{ SEVERITY_LABEL[s.severity] }}: {{ s.text.toLowerCase() }}</span>
        </span>
      </div>
    </div>

    <div class="wp-health__toolbar">
      <WpSegmented v-model="filter" :options="FILTERS" size="sm" aria-label="Show" test-prefix="health-filter" />
      <SearchInput
        v-model="query"
        class="wp-health__search"
        size="sm"
        placeholder="Search by item or text"
        aria-label="Search findings"
        clear-label="Clear search"
      />
      <WpSwitch
        v-if="ignoredCount"
        v-model="showIgnored"
        class="wp-health__ignored"
        :label="`Show ${ignoredCount} ignored`"
        data-test="health-show-ignored"
      />
    </div>

    <Banner v-if="health.scan && !health.scan.canvas" tone="info" size="sm" note>
      No ComfyUI canvas is open, so items placed only on a canvas may show as not used.
      Open your workflow in another tab and check again.
    </Banner>

    <div v-if="health.scan && groups.length" class="wp-health__groups">
      <Disclosure
        v-for="g in groups"
        :key="g.check.id"
        boxed
        :default-open="g.check.severity !== 'tidy' || groups.length <= 3"
        :count="g.rows.length"
        :trigger-attrs="{ 'data-test': `health-group-${g.check.id}` }"
      >
        <template #summary>
          <Chip :tone="SEVERITY_TONE[g.check.severity]">{{ SEVERITY_LABEL[g.check.severity] }}</Chip>
          <span class="wp-health__group-title">{{ g.check.title }}</span>
        </template>
        <template v-if="g.check.id === 'unused' && g.rows.some((f) => canDelete(f) && !health.ignored.has(f.key))" #actions>
          <Button variant="ghost" size="sm" icon="pi-trash" data-test="health-delete-all" @click="askDeleteAll(g)">
            Delete all
          </Button>
        </template>
        <p class="wp-health__why">{{ WHY[g.check.id] }}</p>
        <DataTable
          :columns="COLUMNS"
          :rows="g.rows"
          row-key="key"
          size="sm"
          :aria-label="g.check.title"
          :row-attrs="(f) => ({ 'data-test': `health-row-${f.key}`, 'data-ignored': health.ignored.has(f.key) ? 'true' : undefined })"
        >
          <template #cell-item="{ row: f }">
            <Button
              variant="link"
              size="sm"
              class="wp-health__item"
              :icon="itemIcon(f.item)"
              :data-kind="f.item.type"
              :title="`Open ${f.item.name}`"
              @click="open(f.item)"
            >{{ f.item.name || f.item.id }}</Button>
          </template>
          <template #cell-detail="{ row: f }">
            <span class="wp-health__detail">{{ f.detail }}</span>
            <span v-if="f.others?.length" class="wp-health__others">
              <Button
                v-for="o in f.others"
                :key="`${o.kind}:${o.id}`"
                variant="outline"
                size="sm"
                :icon="itemIcon(o)"
                :title="`Open ${o.name}`"
                @click="open(o)"
              >{{ o.name || o.id }}</Button>
            </span>
          </template>
          <template #cell-actions="{ row: f }">
            <span class="wp-health__actions">
              <Button
                v-if="f.check === 'community_update'"
                variant="ghost" size="sm" data-test="health-update"
                @click="openUpdate(f)"
              >Update</Button>
              <Button v-else variant="ghost" size="sm" @click="open(f.item)">{{ openLabel(f) }}</Button>
              <Button
                v-if="canDelete(f)"
                variant="ghost" size="sm" icon="pi-trash"
                :aria-label="`Delete ${f.item.name}`"
                :data-test="`health-delete-${f.item.id}`"
                @click="deleting = [f]"
              />
              <Button
                variant="ghost" size="sm"
                :data-test="`health-ignore-${f.key}`"
                @click="toggleIgnore(f)"
              >{{ health.ignored.has(f.key) ? "Unignore" : "Ignore" }}</Button>
            </span>
          </template>
        </DataTable>
      </Disclosure>
    </div>

    <EmptyState
      v-else-if="health.scan && (query || filter !== 'all')"
      icon="pi-search"
      headline="Nothing matches"
      body="Try another filter or search."
      variant="no-results"
    />
    <EmptyState
      v-else-if="health.scan"
      icon="pi-check-circle"
      headline="Your library looks healthy"
      body="Nothing broken, nothing that looks like a mistake, nothing to tidy."
    />

    <section v-if="bundleStore.catalog.length" class="wp-health__variety" aria-labelledby="wp-health-variety">
      <h2 id="wp-health-variety" class="wp-health__h2">Variety</h2>
      <p class="wp-health__why">
        Runs a bundle 200 times with random seeds and shows how many prompts came out different,
        which variables never change and which options never came up.
      </p>
      <DataTable
        :columns="[{ key: 'name', label: 'Bundle' }, { key: 'children', label: 'Items', width: '90px', mono: true }, { key: 'actions', label: 'Actions', hideLabel: true, align: 'right', width: '160px' }]"
        :rows="bundleStore.catalog"
        row-key="id"
        size="sm"
        aria-label="Bundles"
      >
        <template #cell-name="{ row: b }">
          <span class="wp-health__bundle">
            <Icon name="pi-box" class="wp-health__kind" data-kind="bundle" />
            <span class="wp-health__item-name">{{ b.name }}</span>
          </span>
        </template>
        <template #cell-children="{ row: b }">{{ (b.children ?? []).length }}</template>
        <template #cell-actions="{ row: b }">
          <Button
            variant="ghost" size="sm" icon="pi-chart-bar"
            :data-test="`health-variety-${b.id}`"
            @click="runVariety(b)"
          >Check variety</Button>
        </template>
      </DataTable>
    </section>
  </div>

  <Drawer v-model:open="varietyOpen" :title="varietyBundle ? `Variety: ${varietyBundle.name}` : 'Variety'" width="520px">
    <div class="wp-health-variety" data-test="health-variety">
      <p v-if="varietyBusy" class="wp-health__why">Running the bundle 200 times…</p>
      <ProgressBar v-if="varietyBusy" :value="null" label="Running" />
      <template v-else-if="variety">
        <p class="wp-health__why">Ran the bundle {{ variety.runs }} times with random seeds.</p>
        <div class="wp-health-variety__stats">
          <div class="wp-health-variety__stat">
            <span class="wp-health-variety__big" :data-tone="varietyTone">{{ variety.distinct }} of {{ variety.runs }}</span>
            <span class="wp-health-variety__label">different prompts ({{ varietyPercent }}%)</span>
          </div>
          <div class="wp-health-variety__stat">
            <span class="wp-health-variety__big">{{ variety.failed }} failed</span>
            <span class="wp-health-variety__label">runs that raised an error</span>
          </div>
        </div>
        <ProgressBar :value="varietyPercent" :max="100" :tone="varietyTone" :label="`${varietyPercent}% different`" />

        <section v-if="variety.stuck.length" class="wp-health-variety__block">
          <h3 class="wp-health-variety__h3"><Icon name="pi-exclamation-triangle" /> Never changes</h3>
          <div v-for="s in variety.stuck" :key="s.var" class="wp-health-variety__row">
            <code class="wp-health__var">${{ s.var }}</code>
            <span>always "{{ s.value }}", though {{ s.name }} has more options</span>
          </div>
        </section>

        <section v-if="variety.never_picked.length" class="wp-health-variety__block">
          <h3 class="wp-health-variety__h3">Options that never came up</h3>
          <div v-for="n in variety.never_picked" :key="n.id" class="wp-health-variety__row wp-health-variety__row--stack">
            <span><strong>{{ n.name }}</strong> <span class="wp-dim">{{ n.count }} of {{ n.total }}</span></span>
            <span class="wp-health-variety__chips">
              <code v-for="o in n.options" :key="o" class="wp-health__opt">{{ o }}</code>
            </span>
          </div>
          <p class="wp-health__why">A constraint may rule them out, or their weight is low.</p>
        </section>

        <section v-if="variety.warnings.length" class="wp-health-variety__block">
          <h3 class="wp-health-variety__h3">Run warnings</h3>
          <div v-for="w in variety.warnings" :key="`${w.type}:${w.message}`" class="wp-health-variety__row">
            <span>{{ w.message || w.type }}</span>
            <span class="wp-dim">{{ w.count }} runs</span>
          </div>
        </section>

        <p v-if="!variety.stuck.length && !variety.never_picked.length" class="wp-health__why">
          Every option came up and every variable changed.
        </p>
      </template>
    </div>
    <template #footer>
      <Button variant="secondary" @click="openInTestRunner">Open in Test Runner</Button>
      <Button
        variant="primary"
        :loading="varietyBusy"
        :disabled="!varietyBundle"
        @click="varietyBundle && runVariety(varietyBundle)"
      >Run again</Button>
    </template>
  </Drawer>

  <ConfirmModal
    :open="deleting !== null"
    :title="deleteTitle"
    :body="deleteBody"
    confirm-label="Delete"
    tone="danger"
    :loading="deleteBusy"
    @confirm="confirmDelete"
    @cancel="deleting = null"
  />
  <CommunityUpdateDialog :open="updateEntry !== null" :entry="updateEntry" @close="updateEntry = null" />
  </div>
</template>

<style scoped>
.wp-route-root { display: contents; }

.wp-health { gap: var(--wp-space-6); }

.wp-health__summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--wp-space-4);
}
.wp-health__card {
  display: flex;
  align-items: center;
  gap: var(--wp-space-5);
  padding: var(--wp-space-6);
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-md);
  color: var(--wp-text);
  font: inherit;
}
.wp-health__card-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: var(--wp-radius-md);
  flex-shrink: 0;
}
.wp-health__card[data-severity="problem"] .wp-health__card-icon { color: var(--wp-danger); background: color-mix(in oklab, var(--wp-danger) 14%, transparent); }
.wp-health__card[data-severity="warning"] .wp-health__card-icon { color: var(--wp-warn); background: color-mix(in oklab, var(--wp-warn) 14%, transparent); }
.wp-health__card[data-severity="tidy"] .wp-health__card-icon { color: var(--wp-info); background: color-mix(in oklab, var(--wp-info) 14%, transparent); }
.wp-health__card-text { display: flex; flex-direction: column; min-width: 0; }
.wp-health__card-count { font-size: var(--wp-text-xl, 20px); line-height: 28px; font-weight: 600; }
.wp-health__card-label { color: var(--wp-text-muted); }

.wp-health__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--wp-space-4);
}
.wp-health__search { flex: 1 1 220px; max-width: 320px; }
.wp-health__ignored { margin-left: auto; }

.wp-health__groups { display: flex; flex-direction: column; gap: var(--wp-space-4); }
.wp-health__group-title { font-weight: 600; }
.wp-health__why {
  margin: 0 0 var(--wp-space-4);
  color: var(--wp-text-muted);
  font-size: var(--wp-text-sm, 12px);
}

.wp-health__item { max-width: 100%; font-weight: 600; }
.wp-health__bundle { display: inline-flex; align-items: center; gap: var(--wp-space-2, 8px); font-weight: 600; }
.wp-health__item :deep(.wp-btn__label) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-health__item[data-kind="wildcard"] :deep(.pi) { color: var(--wp-kind-wildcard); }
.wp-health__item[data-kind="fixed_values"] :deep(.pi) { color: var(--wp-kind-fixed); }
.wp-health__item[data-kind="combine"] :deep(.pi) { color: var(--wp-kind-combine); }
.wp-health__item[data-kind="derivation"] :deep(.pi) { color: var(--wp-kind-derivation); }
.wp-health__item[data-kind="constraint"] :deep(.pi) { color: var(--wp-kind-constraint); }
.wp-health__kind { flex-shrink: 0; color: var(--wp-text-muted); }

.wp-health__detail { color: var(--wp-text-muted); }
.wp-health__others { display: inline-flex; flex-wrap: wrap; gap: var(--wp-space-2); margin-left: var(--wp-space-3); vertical-align: middle; }
.wp-health__actions { display: inline-flex; gap: var(--wp-space-2); white-space: nowrap; }
:deep(tr[data-ignored="true"]) { opacity: 0.6; }

.wp-health__variety { display: flex; flex-direction: column; gap: var(--wp-space-3); }
.wp-health__h2 { margin: 0; font-size: var(--wp-text-lg, 16px); line-height: 22px; font-weight: 600; }

.wp-health__var,
.wp-health__opt {
  font-family: var(--wp-font-mono);
  font-size: var(--wp-text-sm, 12px);
}
.wp-health__var { color: var(--wp-accent-text); }
.wp-health__opt {
  padding: 0 var(--wp-space-3);
  border-radius: var(--wp-radius-sm);
  background: var(--wp-bg-4, var(--wp-bg-3));
}

.wp-health-variety { display: flex; flex-direction: column; gap: var(--wp-space-6); }
.wp-health-variety__stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--wp-space-4); }
.wp-health-variety__stat {
  display: flex;
  flex-direction: column;
  padding: var(--wp-space-5) var(--wp-space-6);
  border-radius: var(--wp-radius-md);
  background: var(--wp-bg-3);
}
.wp-health-variety__big { font-size: var(--wp-text-xl, 20px); line-height: 28px; font-weight: 600; }
.wp-health-variety__big[data-tone="success"] { color: var(--wp-success); }
.wp-health-variety__big[data-tone="warn"] { color: var(--wp-warn); }
.wp-health-variety__big[data-tone="danger"] { color: var(--wp-danger); }
.wp-health-variety__label { color: var(--wp-text-muted); }
.wp-health-variety__block { display: flex; flex-direction: column; gap: var(--wp-space-3); }
.wp-health-variety__h3 {
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
  margin: 0;
  font-size: var(--wp-text-md, 13px);
  font-weight: 600;
}
.wp-health-variety__row {
  display: flex;
  align-items: center;
  gap: var(--wp-space-4);
  padding: var(--wp-space-4) var(--wp-space-5);
  border-radius: var(--wp-radius-md);
  background: var(--wp-bg-3);
}
.wp-health-variety__row--stack { flex-direction: column; align-items: flex-start; }
.wp-health-variety__chips { display: flex; flex-wrap: wrap; gap: var(--wp-space-2); }
</style>
