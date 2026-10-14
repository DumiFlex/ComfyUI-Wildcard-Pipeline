<script setup lang="ts">
/**
 * Pack builder — a whole pack from one description: plan, build and check
 * on the real engine, install as one undoable import.
 *
 * State and steps live in `usePackBuilder`; this page lays them out, with
 * the plan step split into `components/pack/*`. Settings and reference
 * images go with every plan request. The planner's questions come in
 * rounds and answers become decisions; the plan can be edited by hand or
 * one item at a time with the AI; review findings apply, dismiss or go to
 * the planner. Building goes item by item (each can be skipped, and has a
 * time limit), the test run flags problems and the builder repairs them
 * before offering Install. "Extend with AI" on a bundle opens this page
 * aimed at that bundle (`pb.target`).
 */
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import Button from "../components/ui/Button.vue";
import Card from "../components/ui/Card.vue";
import AiImagePicker from "../components/ai/AiImagePicker.vue";
import PackFindings from "../components/pack/PackFindings.vue";
import PackPlanList from "../components/pack/PackPlanList.vue";
import PackQuestions from "../components/pack/PackQuestions.vue";
import PackSettings from "../components/pack/PackSettings.vue";
import { registerPageNote } from "../composables/useOpenEditor";
import { usePackBuilder, type ItemStatus } from "../composables/usePackBuilder";
import { useAiConfig } from "../composables/useAiConfig";
import { useToast } from "../composables/useToast";
import { useModuleStore } from "../stores/moduleStore";
import { useBundleStore } from "../stores/bundleStore";
import { useTemplateStore } from "../stores/templateStore";
import type { AiPackItem } from "../api/types";

const pb = usePackBuilder();

// Tell the AI chat which pack is being built, so it can help with the plan.
registerPageNote(() => {
  const plan = pb.plan.value;
  if (!plan) return "Pack builder, nothing planned yet";
  const items = plan.items.map((it) => `${it.name} (${it.kind}${it.var ? ` $${it.var}` : ""})`).join(", ");
  const check = pb.check.value;
  const problems = check ? Object.values(check.problems).flat().slice(0, 5) : [];
  return [
    `Pack builder, step ${pb.phase.value}, pack "${plan.title}": ${items}`,
    pb.target.value ? `Extending the bundle ${pb.target.value.name}` : "",
    check ? `Test run: ${check.runs} seeds; ${problems.length ? `problems: ${problems.join("; ")}` : "no problems"}` : "",
  ].filter(Boolean).join(". ");
});
const { convo } = pb;
const { config, ready } = useAiConfig();
const router = useRouter();
const toast = useToast();
const moduleStore = useModuleStore();
const bundleStore = useBundleStore();
const templateStore = useTemplateStore();
const open = ref(new Set<string>());
const showSettings = ref(false);
const fixing = ref("");
const fixNote = ref("");

const modelLabel = computed(() => config.value?.model ?? "");
const result = computed(() => convo.result.value);
const draft = computed(() => pb.draft.value);
const items = computed(() => draft.value?.items ?? []);
const keptCount = computed(() => pb.plan.value?.items.length ?? 0);
const busy = computed(() => convo.loading.value || !!pb.changing.value || pb.searching.value);
const builtItems = computed(() => {
  const p = pb.plan.value;
  if (!p) return [];
  return p.items
    .filter((i) => pb.states.value[i.key])
    .sort((a, b) => order(a) - order(b));
});
const problemCount = computed(() => {
  const c = pb.check.value;
  if (!c) return 0;
  return Object.entries(c.problems)
    .reduce((n, [k, list]) => n + list.filter((t) => !pb.dismissedNotes.value.has(`${k}:${t}`)).length, 0)
    + c.notes.length;
});
const moduleCount = computed(
  () => builtItems.value.filter(
    (i) => i.kind !== "template" && i.kind !== "library" && pb.states.value[i.key]?.result,
  ).length,
);
const hasTemplate = computed(
  () => builtItems.value.some((i) => i.kind === "template" && pb.states.value[i.key]?.result),
);
const installable = computed(() => builtItems.value.some(
  (i) => i.kind !== "template" && pb.states.value[i.key]?.result,
));
const steps = computed(() => [
  { label: "Describe", done: !!result.value, on: !result.value },
  { label: "Plan", done: pb.phase.value !== "plan", on: !!result.value && pb.phase.value === "plan" },
  { label: "Build & check", done: pb.phase.value === "installed", on: pb.phase.value === "build" },
  { label: "Install", done: pb.phase.value === "installed", on: false },
]);
const settingsLine = computed(() => {
  const s = pb.settings.value;
  return [
    { reuse: "reuses your library", inspire: "new, in your library's style", new: "all new" }[s.library],
    { auto: "negatives on", template: "template negative only", none: "no negatives" }[s.negatives],
    s.structure === "sections" ? "sub-bundles" : "one bundle",
    s.style === "auto" ? "" : s.style === "tags" ? "tags" : "phrases",
    s.rating === "auto" ? "" : s.rating === "nsfw" ? "NSFW" : "safe",
    s.count ? `${s.count} options each` : "",
  ].filter(Boolean).join(" · ");
});

const RANK: Record<AiPackItem["kind"], number> = {
  fixed_values: 0, library: 1, wildcard: 1, derivation: 2, combine: 3, constraint: 4, template: 5,
};
function order(i: AiPackItem): number {
  return RANK[i.kind] * 1000 + items.value.indexOf(i);
}

function kindLabel(i: AiPackItem): string {
  if (i.existing) return "in bundle";
  if (i.kind === "fixed_values") return "fixed";
  if (i.kind === "library") return "yours";
  return i.kind === "wildcard" && !i.var ? "vocabulary" : i.kind;
}

function status(key: string): ItemStatus {
  return pb.states.value[key]?.status ?? "waiting";
}

function spinning(key: string): boolean {
  const s = status(key);
  return s === "building" || s === "fixing" || s === "retrying";
}

const STATUS_LABEL: Partial<Record<ItemStatus, string>> = {
  retrying: "retrying", fixing: "fixing", skipped: "skipped", failed: "failed",
};

function builtMeta(i: AiPackItem): string {
  const r = pb.states.value[i.key]?.result;
  if (!r) return STATUS_LABEL[status(i.key)] ?? "";
  const p = r.payload as Record<string, unknown>;
  if ((i.kind === "wildcard" || i.kind === "library") && Array.isArray(p.options)) {
    return `${p.options.length} options`;
  }
  if (Array.isArray(p.values)) return `${p.values.length} value${p.values.length === 1 ? "" : "s"}`;
  if (i.kind === "derivation" && Array.isArray(p.rules)) {
    return `${p.rules.length} rule${p.rules.length === 1 ? "" : "s"}`;
  }
  if (i.kind === "constraint") return `${r.preview.length} rule${r.preview.length === 1 ? "" : "s"}`;
  return "";
}

function problems(key: string): string[] {
  return (pb.check.value?.problems[key] ?? []).filter((t) => !pb.dismissedNotes.value.has(`${key}:${t}`));
}

function quality(key: string): string[] {
  return (pb.check.value?.quality ?? [])
    .filter((q) => q.key === key && !pb.dismissedNotes.value.has(`${key}:${q.text}`))
    .map((q) => q.text);
}

const STYLE_LABEL = { tags: "Danbooru-style tags", sentences: "natural phrases" } as const;
const shape = computed(() => {
  const p = draft.value;
  if (!p) return "";
  return [
    `Written as ${STYLE_LABEL[p.style] ?? "tags"}`,
    p.model ? `for ${p.model}` : "",
    p.anchor ? `everything follows $${p.anchor}` : "",
  ].filter(Boolean).join(" · ");
});
const showSample = ref(!!pb.sample.value);

function toggle(key: string): void {
  const next = new Set(open.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  open.value = next;
}

function onKey(ev: KeyboardEvent, run: () => void): void {
  if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
    ev.preventDefault();
    run();
  }
}

function startFix(key: string): void {
  fixing.value = fixing.value === key ? "" : key;
  fixNote.value = "";
}

async function rebuildWith(key: string): Promise<void> {
  const note = [fixNote.value.trim(), ...problems(key), ...quality(key)].filter(Boolean).join("; ");
  fixing.value = "";
  fixNote.value = "";
  await pb.rebuild(key, note);
}

async function install(): Promise<void> {
  const res = await pb.install();
  if (!res) return;
  void Promise.all([
    moduleStore.fetchCatalog().catch(() => undefined),
    bundleStore.fetchCatalog().catch(() => undefined),
    templateStore.fetchCatalog().catch(() => undefined),
  ]);
  toast.push({
    severity: "success",
    summary: pb.target.value ? `Added to ${pb.target.value.name}` : `Installed ${draft.value?.title ?? "the pack"}`,
    detail: `Tagged #${res.tag}`,
    life: 8000,
    action: { label: "Undo", run: undo },
  });
}

async function undo(): Promise<void> {
  if (await pb.undoInstall()) {
    void moduleStore.fetchCatalog().catch(() => undefined);
    void bundleStore.fetchCatalog().catch(() => undefined);
    void templateStore.fetchCatalog().catch(() => undefined);
    toast.push({ severity: "info", summary: "Pack removed", life: 4000 });
  }
}

function openBundle(id = pb.installed.value?.bundle_id): void {
  if (id) void router.push({ name: "bundles-edit", params: { id } });
}
function openTemplate(): void {
  const id = pb.installed.value?.template_id;
  if (id) void router.push({ name: "templates-edit", params: { id } });
}
function stopExtending(): void {
  pb.target.value = null;
}
</script>

<template>
  <div class="wp-route-root">
  <div class="wp-page wp-pack" data-test="pack-builder">
    <div class="wp-page__header">
      <div class="wp-page__title-wrap">
        <h1 class="wp-page__title">Pack builder</h1>
        <ol class="wp-pack__steps" aria-label="Steps">
          <li
            v-for="(s, i) in steps"
            :key="s.label"
            :data-done="s.done ? 'true' : undefined"
            :data-on="s.on ? 'true' : undefined"
          >{{ i + 1 }} {{ s.label }}<i v-if="s.done" class="pi pi-check" aria-hidden="true" /></li>
        </ol>
      </div>
      <span v-if="modelLabel" class="wp-pack__model">{{ modelLabel }}</span>
    </div>

    <p v-if="pb.target.value" class="wp-pack__target" data-test="pack-target">
      <i class="pi pi-box" aria-hidden="true" />
      <span>Extending <b>{{ pb.target.value.name }}</b>: the plan adds to it, and installing puts the new modules and sub-bundles inside it.</span>
      <button v-if="!result" type="button" class="wp-pack__link" @click="stopExtending">Make a new pack instead</button>
    </p>

    <p v-if="!ready" class="wp-pack__off" data-test="pack-off">
      The pack builder needs the AI assistant. Turn it on and pick a model in
      <RouterLink to="/settings/ai">Settings › AI assistant</RouterLink>.
    </p>

    <!-- ── Describe ─────────────────────────────────────────────────── -->
    <div v-else-if="!result" class="wp-pack__describe">
      <Card :title="pb.target.value ? 'What should it add?' : 'Describe the pack'">
        <p class="wp-pack__hint">
          <template v-if="pb.target.value">
            Say what the bundle should gain: new slots, rules between what it has, a sub-bundle for a part of it.
            The assistant sees what the bundle holds and plans only the additions.
          </template>
          <template v-else>
            Say what the pack should make and the rules between its parts. The assistant plans the
            wildcards, fixed values, rules, constraints, combines and a template, builds them one at a time, tests them on
            the engine, and installs everything as one collection you can undo.
          </template>
        </p>
        <textarea
          v-model="convo.instruction.value"
          class="wp-textarea wp-pack__request"
          rows="5"
          :placeholder="pb.target.value ? 'Add weather that fits the season, and keep elves away from guns.' : `A fantasy character pack: race, class, an outfit and a weapon that fit the class. Elves never use guns. Give each character a title like 'Elven Archmage'.`"
          aria-label="Describe the pack"
          data-test="pack-request" data-ai-anchor="pack-request" data-ai-label="Describe the pack"
          :disabled="convo.loading.value"
          @keydown="onKey($event, pb.askPlan)"
        ></textarea>
        <button
          type="button"
          class="wp-pack__toggle"
          :aria-expanded="showSample"
          data-test="pack-sample-toggle"
          @click="showSample = !showSample"
        ><i :class="['pi', showSample ? 'pi-chevron-down' : 'pi-chevron-right']" aria-hidden="true" /> Start from a prompt you like</button>
        <template v-if="showSample">
          <textarea
            v-model="pb.sample.value"
            class="wp-textarea wp-pack__request"
            rows="3"
            placeholder="1girl, long red hair, green eyes, sundress, sitting on a pier, sunset, masterpiece, best quality"
            aria-label="A prompt you like"
            data-test="pack-sample"
            :disabled="convo.loading.value"
          ></textarea>
          <p class="wp-pack__dim">The plan splits it into slots, reuses your wildcards where they fit and builds the rest, so the pack makes more prompts like it.</p>
        </template>
        <p class="wp-pack__label">Reference images</p>
        <AiImagePicker
          :images="pb.images"
          :disabled="convo.loading.value"
          hint="The planner reads subject, outfit, setting, palette, lighting and style from them and plans slots that make more pictures like these."
        />
        <button
          type="button"
          class="wp-pack__toggle"
          :aria-expanded="showSettings"
          data-test="pack-settings-toggle"
          @click="showSettings = !showSettings"
        ><i :class="['pi', showSettings ? 'pi-chevron-down' : 'pi-chevron-right']" aria-hidden="true" /> Pack settings <span class="wp-pack__dim">· {{ settingsLine }}</span></button>
        <PackSettings v-if="showSettings" v-model="pb.settings.value" class="wp-pack__settings" :disabled="convo.loading.value" />
        <div class="wp-pack__row">
          <span class="wp-pack__dim">Ctrl+Enter plans it. Nothing is saved until you install.</span>
          <Button v-if="convo.loading.value" size="sm" icon="pi-stop" @click="pb.stop">Stop</Button>
          <Button
            v-else
            variant="primary"
            icon="pi-microchip-ai"
            :disabled="!convo.instruction.value.trim()"
            data-test="pack-plan" data-ai-anchor="pack-plan" data-ai-label="Plan it button"
            @click="pb.askPlan"
          >Plan it</Button>
        </div>
        <p v-if="convo.loading.value" class="wp-pack__status" role="status">
          <i class="pi pi-spin pi-spinner" aria-hidden="true" /> Planning… local models can take a minute.
        </p>
        <p v-if="convo.error.value" class="wp-pack__error" role="alert">{{ convo.error.value }}</p>
      </Card>
    </div>

    <!-- ── Plan ─────────────────────────────────────────────────────── -->
    <div v-else-if="pb.phase.value === 'plan'" class="wp-pack__grid">
      <div class="wp-pack__col">
        <Card title="Your request">
          <ol class="wp-pack__asks">
            <li v-for="(a, i) in convo.asked.value" :key="i">{{ a }}</li>
          </ol>
          <div class="wp-pack__row">
            <span v-if="convo.count.value > 1" class="wp-pack__nav">
              <button type="button" aria-label="Earlier plan" :disabled="convo.index.value <= 0 || busy" @click="convo.go(-1)"><i class="pi pi-chevron-left" aria-hidden="true" /></button>
              Plan {{ convo.index.value + 1 }} of {{ convo.count.value }}
              <button type="button" aria-label="Later plan" :disabled="convo.index.value >= convo.count.value - 1 || busy" @click="convo.go(1)"><i class="pi pi-chevron-right" aria-hidden="true" /></button>
            </span>
            <span class="wp-pack__spacer" />
            <Button variant="ghost" size="sm" data-test="pack-reset" @click="pb.reset">Start over</Button>
          </div>
        </Card>
        <Card v-if="pb.questions.value.length" :title="`Questions from the assistant · ${pb.questions.value.length}`">
          <PackQuestions />
        </Card>
        <Card v-if="pb.research.value.length" title="The assistant wants to search the web" data-test="pack-research">
          <ul class="wp-pack__research">
            <li v-for="q in pb.research.value" :key="q"><i class="pi pi-search" aria-hidden="true" /> {{ q }}</li>
          </ul>
          <p class="wp-pack__dim">Only the search words leave your machine; the results are read as reference, never as instructions.</p>
          <div class="wp-pack__row">
            <span class="wp-pack__spacer" />
            <Button size="sm" variant="ghost" :disabled="busy" data-test="pack-research-skip" @click="pb.skipResearch">Skip</Button>
            <Button size="sm" icon="pi-search" :loading="pb.searching.value" :disabled="busy" data-test="pack-research-allow" @click="pb.allowResearch">Allow and update the plan</Button>
          </div>
        </Card>
        <Card v-if="pb.decisions.value.length || draft?.assumptions.length" title="Decided and assumed" data-test="pack-decisions">
          <div v-if="pb.decisions.value.length" class="wp-pack__chips">
            <span class="wp-pack__dim">You decided:</span>
            <button
              v-for="(d, i) in pb.decisions.value"
              :key="d.question"
              type="button"
              class="wp-pack__chip"
              :title="`${d.question} Click to change it.`"
              :disabled="busy"
              data-test="pack-decision"
              @click="pb.reopenDecision(i)"
            ><b>{{ d.question.length > 40 ? d.question.slice(0, 38) + '…' : d.question }}</b> {{ d.answer }}</button>
          </div>
          <div v-if="draft?.assumptions.length" class="wp-pack__chips">
            <span class="wp-pack__dim">The assistant assumed:</span>
            <button
              v-for="a in draft.assumptions"
              :key="a"
              type="button"
              class="wp-pack__chip wp-pack__chip--guess"
              title="Click to correct it"
              :disabled="busy"
              data-test="pack-assumption"
              @click="pb.changeAssumption(a)"
            >{{ a }}</button>
          </div>
        </Card>
        <Card title="Plan review">
          <PackFindings />
        </Card>
        <Card title="Change the plan">
          <textarea
            v-model="convo.instruction.value"
            class="wp-textarea wp-pack__request"
            rows="2"
            placeholder="Add a $time_of_day wildcard with day, dusk and night…"
            aria-label="Change the plan"
            data-test="pack-edit"
            :disabled="convo.loading.value"
            @keydown="onKey($event, pb.refinePlan)"
          ></textarea>
          <button
            type="button"
            class="wp-pack__toggle"
            :aria-expanded="showSettings"
            data-test="pack-settings-toggle"
            @click="showSettings = !showSettings"
          ><i :class="['pi', showSettings ? 'pi-chevron-down' : 'pi-chevron-right']" aria-hidden="true" /> Settings and images <span class="wp-pack__dim">· {{ settingsLine }}{{ pb.images.images.value.length ? ` · ${pb.images.images.value.length} image${pb.images.images.value.length === 1 ? '' : 's'}` : '' }}</span></button>
          <template v-if="showSettings">
            <PackSettings v-model="pb.settings.value" class="wp-pack__settings" :disabled="convo.loading.value" />
            <AiImagePicker :images="pb.images" :disabled="convo.loading.value" compact class="wp-pack__settings" />
          </template>
          <div class="wp-pack__row">
            <span class="wp-pack__dim">Your answers, edits and removed items go along.</span>
            <Button v-if="convo.loading.value" size="sm" icon="pi-stop" @click="pb.stop">Stop</Button>
            <Button
              v-else
              size="sm"
              icon="pi-reply"
              :disabled="!pb.canRefine.value"
              data-test="pack-refine"
              @click="pb.refinePlan"
            >Update plan</Button>
          </div>
          <p v-if="convo.loading.value" class="wp-pack__status" role="status">
            <i class="pi pi-spin pi-spinner" aria-hidden="true" /> Updating the plan…
          </p>
          <p v-if="convo.error.value" class="wp-pack__error" role="alert">{{ convo.error.value }}</p>
          <p v-if="pb.error.value" class="wp-pack__error" role="alert">{{ pb.error.value }}</p>
        </Card>
      </div>

      <Card class="wp-pack__plan" :title="`Plan · ${keptCount} items`">
        <p class="wp-pack__title">{{ draft?.title }}
          <span v-if="draft?.rating === 'nsfw'" class="wp-pack__nsfw">NSFW</span>
          <span v-if="pb.edited.value" class="wp-pack__edited" data-test="pack-edited">edited by you</span>
        </p>
        <p v-if="draft?.summary" class="wp-pack__dim">{{ draft.summary }}</p>
        <p v-if="shape" class="wp-pack__shape" data-test="pack-shape">{{ shape }}</p>
        <PackPlanList />
        <div v-if="draft?.inputs?.length" class="wp-pack__inputs" data-test="pack-inputs">
          <p class="wp-pack__dim">Set from outside (a WP Context Injector row each):</p>
          <ul>
            <li v-for="inp in draft.inputs" :key="inp.var">
              <code>${{ inp.var }}</code> {{ inp.about }}<span v-if="inp.example" class="wp-pack__dim"> · tested as "{{ inp.example }}"</span>
            </li>
          </ul>
        </div>
        <ul v-if="draft?.warnings.length" class="wp-pack__warnings">
          <li v-for="(w, j) in draft.warnings" :key="j"><i class="pi pi-info-circle" aria-hidden="true" /> {{ w }}</li>
        </ul>
        <div class="wp-pack__row">
          <span class="wp-pack__spacer" />
          <Button
            variant="primary"
            icon="pi-cog"
            :disabled="!keptCount || busy"
            data-test="pack-build" data-ai-anchor="pack-build" data-ai-label="Build button"
            @click="pb.build"
          >Build this pack</Button>
        </div>
      </Card>
    </div>

    <!-- ── Build, check, install ────────────────────────────────────── -->
    <div v-else class="wp-pack__grid">
      <Card :title="`Built · ${pb.builtCount.value} of ${keptCount}`">
        <ul class="wp-pack__items">
          <li v-for="i in builtItems" :key="i.key" class="wp-pack__built" data-test="pack-built" :data-status="status(i.key)">
            <div class="wp-pack__item">
              <span class="wp-pack__state" :data-status="status(i.key)">
                <i v-if="spinning(i.key)" class="pi pi-spin pi-spinner" aria-hidden="true" />
                <i v-else-if="status(i.key) === 'failed'" class="pi pi-times-circle" aria-hidden="true" />
                <i v-else-if="status(i.key) === 'skipped'" class="pi pi-forward" aria-hidden="true" />
                <i v-else-if="status(i.key) === 'waiting'" class="pi pi-circle" aria-hidden="true" />
                <i v-else-if="problems(i.key).length" class="pi pi-exclamation-triangle" aria-hidden="true" />
                <i v-else class="pi pi-check" aria-hidden="true" />
              </span>
              <span class="wp-pack__kind" :data-kind="i.kind">{{ kindLabel(i) }}</span>
              <button type="button" class="wp-pack__item-main wp-pack__expand" :aria-expanded="open.has(i.key)" @click="toggle(i.key)">
                <span class="wp-pack__item-name">{{ i.name }}</span>
                <span v-if="pb.states.value[i.key].fixed?.length && status(i.key) !== 'fixing'" class="wp-pack__fixed">
                  fixed: {{ pb.states.value[i.key].fixed?.[0] }}
                </span>
              </button>
              <span class="wp-pack__item-meta">{{ builtMeta(i) }}</span>
              <button
                v-if="pb.current.value === i.key"
                type="button"
                class="wp-pack__icon-btn"
                :aria-label="`Skip ${i.name}`"
                title="Skip this item"
                data-test="pack-skip-current"
                @click="pb.skipCurrent"
              ><i class="pi pi-forward" aria-hidden="true" /></button>
              <template v-else-if="!pb.working.value && pb.phase.value === 'build' && i.kind !== 'library'">
                <button
                  type="button"
                  class="wp-pack__icon-btn"
                  :aria-label="`Rebuild ${i.name}`"
                  title="Build it again"
                  data-test="pack-rebuild"
                  @click="pb.rebuild(i.key, [...problems(i.key), ...quality(i.key)].join('; '))"
                ><i class="pi pi-refresh" aria-hidden="true" /></button>
                <button
                  type="button"
                  class="wp-pack__icon-btn"
                  :aria-label="`Rebuild ${i.name} with a note`"
                  title="Rebuild with a note"
                  data-test="pack-fix-note"
                  @click="startFix(i.key)"
                ><i class="pi pi-pencil" aria-hidden="true" /></button>
                <button
                  v-if="!pb.states.value[i.key].result && status(i.key) !== 'skipped'"
                  type="button"
                  class="wp-pack__icon-btn"
                  :aria-label="`Leave ${i.name} out`"
                  title="Leave it out"
                  data-test="pack-skip"
                  @click="pb.skipItem(i.key)"
                ><i class="pi pi-forward" aria-hidden="true" /></button>
              </template>
            </div>
            <p v-if="pb.states.value[i.key].error" class="wp-pack__error">{{ pb.states.value[i.key].error }}</p>
            <div v-if="fixing === i.key" class="wp-pack__fixbox">
              <input
                v-model="fixNote"
                class="wp-input wp-input--sm"
                placeholder="What to do differently (more variety, fewer colours, …)"
                aria-label="Note for the rebuild"
                data-test="pack-fix-input"
                @keydown.enter.prevent="rebuildWith(i.key)"
              >
              <Button size="sm" icon="pi-refresh" data-test="pack-fix-go" @click="rebuildWith(i.key)">Rebuild</Button>
            </div>
            <ul v-if="problems(i.key).length" class="wp-pack__warnings">
              <li v-for="(w, j) in problems(i.key)" :key="j">
                <i class="pi pi-exclamation-triangle" aria-hidden="true" /> <span>{{ w }}</span>
                <button v-if="!pb.working.value" type="button" class="wp-pack__mini" data-test="pack-problem-dismiss" @click="pb.dismissNote(i.key, w)">Dismiss</button>
              </li>
            </ul>
            <ul v-if="quality(i.key).length" class="wp-pack__findings" data-test="pack-quality">
              <li v-for="(w, j) in quality(i.key)" :key="j" data-level="tip">
                <i class="pi pi-lightbulb" aria-hidden="true" /> <span>{{ w }}. Rebuild it to spread the picks.</span>
                <button v-if="!pb.working.value" type="button" class="wp-pack__mini" @click="pb.dismissNote(i.key, w)">Dismiss</button>
              </li>
            </ul>
            <div v-if="open.has(i.key) && pb.states.value[i.key].result" class="wp-pack__detail">
              <ul class="wp-pack__preview">
                <li v-for="(line, j) in pb.states.value[i.key].result?.preview" :key="j">{{ line }}</li>
              </ul>
              <ul v-if="pb.states.value[i.key].result?.warnings.length" class="wp-pack__warnings">
                <li v-for="(w, j) in pb.states.value[i.key].result?.warnings" :key="j"><i class="pi pi-info-circle" aria-hidden="true" /> {{ w }}</li>
              </ul>
            </div>
          </li>
        </ul>
        <p v-if="pb.working.value" class="wp-pack__status" role="status" data-test="pack-stage">
          <i class="pi pi-spin pi-spinner" aria-hidden="true" /> {{ pb.stage.value }}
          <Button v-if="pb.current.value" size="sm" variant="ghost" icon="pi-forward" data-test="pack-skip-stage" @click="pb.skipCurrent">Skip this item</Button>
          <Button size="sm" variant="ghost" icon="pi-stop" @click="pb.stop">Stop</Button>
        </p>
        <p v-else-if="pb.phase.value === 'build'" class="wp-pack__summary" data-test="pack-summary">
          {{ pb.summary.value.built }} built<template v-if="pb.summary.value.failed">, {{ pb.summary.value.failed }} failed</template><template v-if="pb.summary.value.skipped">, {{ pb.summary.value.skipped }} skipped</template><template v-if="pb.summary.value.waiting">, {{ pb.summary.value.waiting }} not built</template>.
          <template v-if="pb.summary.value.failed">Retry a failed item, rebuild it with a note, or leave it out.</template>
        </p>
        <p v-if="pb.error.value" class="wp-pack__error" role="alert">{{ pb.error.value }}</p>
      </Card>

      <div class="wp-pack__col">
        <Card v-if="pb.check.value" :title="`Test run · ${pb.check.value.runs} seeds on the real engine`">
          <p v-if="!problemCount" class="wp-pack__ok" data-test="pack-ok"><i class="pi pi-check" aria-hidden="true" /> No warnings, every variable set.</p>
          <ul v-else class="wp-pack__warnings" data-test="pack-problems">
            <template v-for="i in builtItems" :key="i.key">
              <li v-for="(w, j) in problems(i.key)" :key="j"><span><b>{{ i.name }}:</b> {{ w }}</span></li>
            </template>
            <li v-for="(n, j) in pb.check.value.notes" :key="`n${j}`">{{ n }}</li>
          </ul>
          <div v-for="v in pb.check.value.variables.slice(0, 6)" :key="v.var" class="wp-pack__var">
            <code>${{ v.var }}</code>
            <span class="wp-pack__dim">{{ v.distinct }} value{{ v.distinct === 1 ? '' : 's' }}</span>
            <div v-for="t in v.top" :key="t.value" class="wp-pack__bar">
              <span class="wp-pack__bar-fill" :style="{ width: `${Math.round(t.share * 100)}%` }" />
              <span class="wp-pack__bar-label">{{ t.value }} {{ Math.round(t.share * 100) }}%</span>
            </div>
          </div>
        </Card>
        <Card v-if="pb.check.value?.prompts.length" title="Sample prompts">
          <div v-for="p in pb.check.value.prompts" :key="p.seed" class="wp-pack__prompt" data-test="pack-prompt">
            <p>{{ p.text }}</p>
            <p v-if="p.negative" class="wp-pack__dim">Negative: {{ p.negative }}</p>
          </div>
          <p class="wp-pack__dim">Seeds {{ pb.check.value.prompts.map((p) => p.seed).join(', ') }}</p>
        </Card>
        <Card v-if="pb.phase.value === 'installed' && pb.installed.value" title="Installed">
          <p>
            Added {{ moduleCount }} module{{ moduleCount === 1 ? '' : 's' }}{{ hasTemplate ? ', a template' : '' }}
            <template v-if="pb.target.value"> to <b>{{ pb.target.value.name }}</b></template><template v-else> and a bundle</template>, tagged
            <span class="wp-pack__tag">#{{ pb.installed.value.tag }}</span>.
          </p>
          <div v-if="pb.installed.value.sub_bundles?.length" class="wp-pack__inputs" data-test="pack-subbundles">
            <p class="wp-pack__dim">Sub-bundles inside it:</p>
            <ul>
              <li v-for="b in pb.installed.value.sub_bundles" :key="b.id">
                <button type="button" class="wp-pack__link" @click="openBundle(b.id)">{{ b.name }}</button>
              </li>
            </ul>
          </div>
          <div v-if="pb.installed.value.notes?.length" class="wp-pack__inputs" data-test="pack-wiring">
            <p class="wp-pack__dim">To use it on the canvas:</p>
            <ul>
              <li v-for="(n, j) in pb.installed.value.notes" :key="j">{{ n }}</li>
            </ul>
          </div>
          <div class="wp-pack__row">
            <Button size="sm" icon="pi-box" data-test="pack-open-bundle" @click="openBundle()">Open the bundle</Button>
            <Button v-if="pb.installed.value.template_id" size="sm" icon="pi-file-edit" @click="openTemplate">Open the template</Button>
            <span class="wp-pack__spacer" />
            <Button variant="ghost" size="sm" data-test="pack-undo" @click="undo">Undo</Button>
            <Button variant="ghost" size="sm" @click="pb.reset">New pack</Button>
          </div>
        </Card>
        <Card v-else-if="!pb.working.value" title="Install">
          <p v-if="installable">
            Adds {{ moduleCount }} module{{ moduleCount === 1 ? '' : 's' }}{{ hasTemplate ? ', the template' : '' }}
            <template v-if="pb.target.value"> to <b>{{ pb.target.value.name }}</b></template><template v-else> and a bundle</template>, tagged
            <span class="wp-pack__tag">#{{ (draft?.title ?? 'pack').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ai-pack' }}</span>.
            One undo removes all of it.
            <template v-if="pb.summary.value.failed + pb.summary.value.skipped"> {{ pb.summary.value.failed + pb.summary.value.skipped }} item{{ pb.summary.value.failed + pb.summary.value.skipped === 1 ? '' : 's' }} that didn't build stay out.</template>
          </p>
          <p v-else class="wp-pack__dim" data-test="pack-nothing">Nothing is built yet, so there is nothing to install. Retry the failed items or go back to the plan.</p>
          <div class="wp-pack__row">
            <Button
              variant="primary"
              icon="pi-download"
              :disabled="!installable"
              data-test="pack-install" data-ai-anchor="pack-install" data-ai-label="Install button"
              @click="install"
            >{{ pb.target.value ? 'Add to the bundle' : 'Install pack' }}</Button>
            <Button variant="ghost" data-test="pack-back" @click="pb.backToPlan">Back to plan</Button>
          </div>
        </Card>
      </div>
    </div>
  </div>
  </div>
</template>

<style scoped>
.wp-pack { gap: 16px; }
.wp-pack__steps { list-style: none; margin: 6px 0 0; padding: 0; display: flex; gap: 6px; flex-wrap: wrap; }
.wp-pack__steps li {
  font-size: 12px; padding: 3px 10px; border-radius: 999px;
  border: 1px solid var(--wp-border); color: var(--wp-text-muted); display: inline-flex; gap: 5px; align-items: center;
}
.wp-pack__steps li[data-done] { color: var(--wp-success); border-color: color-mix(in oklab, var(--wp-success) 45%, transparent); }
.wp-pack__steps li[data-on] { color: var(--wp-accent-text); border-color: var(--wp-accent-400); background: color-mix(in oklab, var(--wp-accent-500) 14%, transparent); }
.wp-pack__steps .pi { font-size: 10px; }
.wp-pack__model {
  align-self: flex-start; font-family: var(--wp-font-mono, monospace); font-size: 11px; padding: 1px 7px;
  border-radius: 5px; color: var(--wp-success); border: 1px solid color-mix(in oklab, var(--wp-success) 45%, transparent);
}
.wp-pack__off { color: var(--wp-text-muted); }
.wp-pack__describe { max-width: 760px; }
.wp-pack__grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
/* Page area narrower than 800px (usePageWidth; the chat can take the rest). */
.wp-content[data-lt~="800"] .wp-pack__grid { grid-template-columns: minmax(0, 1fr); }
.wp-pack__col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.wp-pack__hint { margin: 0 0 10px; color: var(--wp-text-muted); font-size: 13px; }
.wp-pack__request { width: 100%; resize: vertical; font-size: 13px; }
.wp-pack__row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
.wp-pack__spacer { flex: 1; }
.wp-pack__dim { font-size: 12px; color: var(--wp-text-dim); margin: 0; }
.wp-pack__row > .wp-pack__dim { flex: 1; }
.wp-pack__status { margin: 10px 0 0; font-size: 12px; color: var(--wp-text-muted); display: flex; gap: 8px; align-items: center; }
.wp-pack__error { margin: 6px 0 0; font-size: 12px; color: var(--wp-danger); }
.wp-pack__asks { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.wp-pack__asks li { white-space: pre-wrap; overflow-wrap: anywhere; }
.wp-pack__asks li:not(:last-child) { color: var(--wp-text-muted); }
.wp-pack__nav { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--wp-text-muted); }
.wp-pack__nav button {
  width: 22px; height: 22px; border: 1px solid var(--wp-border); border-radius: 5px;
  background: var(--wp-bg-1); color: var(--wp-text-muted); cursor: pointer;
}
.wp-pack__nav button:disabled { opacity: 0.4; cursor: default; }
.wp-pack__question p { margin: 0 0 6px; font-size: 13px; }
.wp-pack__question + .wp-pack__question { margin-top: 12px; }
.wp-pack__choices { display: flex; gap: 6px; flex-wrap: wrap; }
.wp-pack__choice {
  padding: 5px 11px; border-radius: 7px; font-size: 13px; cursor: pointer;
  border: 1px solid var(--wp-border); background: var(--wp-bg-2); color: var(--wp-text);
}
.wp-pack__choice[aria-pressed="true"] { border-color: var(--wp-accent-400); color: var(--wp-accent-text); background: color-mix(in oklab, var(--wp-accent-500) 16%, var(--wp-bg-2)); }
.wp-pack__title { margin: 0 0 2px; font-weight: 600; display: flex; gap: 8px; align-items: center; }
.wp-pack__nsfw { font-size: 10px; padding: 1px 6px; border-radius: 4px; color: var(--wp-danger); border: 1px solid currentColor; }
.wp-pack__items { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; }
.wp-pack__item { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--wp-border); min-width: 0; }
.wp-pack__items > li:first-child > .wp-pack__item, .wp-pack__items > .wp-pack__item:first-child { border-top: 0; }
.wp-pack__item[data-removed] { opacity: 0.45; }
.wp-pack__item[data-removed] .wp-pack__item-main { text-decoration: line-through; }
.wp-pack__kind {
  flex: none; width: 84px; text-align: center; font-size: 10px; font-weight: 700; letter-spacing: 0.04em;
  text-transform: uppercase; padding: 2px 0; border-radius: 4px;
  color: var(--wp-kind-wildcard); background: var(--wp-kind-wildcard-bg);
}
.wp-pack__kind[data-kind="fixed_values"] { color: var(--wp-kind-fixed); background: var(--wp-kind-fixed-bg); }
.wp-pack__inputs { display: flex; flex-direction: column; gap: 4px; margin: 4px 0 8px; }
.wp-pack__inputs p { margin: 0; font-size: 12px; }
.wp-pack__inputs ul { margin: 0; padding-left: 18px; font-size: 12.5px; display: flex; flex-direction: column; gap: 3px; }
.wp-pack__inputs code { font-family: var(--wp-font-mono, monospace); font-size: 12px; }
.wp-pack__kind[data-kind="derivation"] { color: var(--wp-kind-derivation); background: var(--wp-kind-derivation-bg); }
.wp-pack__kind[data-kind="combine"] { color: var(--wp-kind-combine); background: var(--wp-kind-combine-bg); }
.wp-pack__kind[data-kind="constraint"] { color: var(--wp-kind-constraint); background: var(--wp-kind-constraint-bg); }
.wp-pack__kind[data-kind="template"] { color: var(--wp-kind-ref); background: var(--wp-kind-ref-bg); }
.wp-pack__item-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.wp-pack__expand { border: 0; background: none; padding: 0; text-align: left; color: inherit; cursor: pointer; font: inherit; }
.wp-pack__item-name { font-size: 13px; }
.wp-pack__item-name code { color: var(--wp-kind-wildcard); font-size: 12px; }
.wp-pack__item-about { font-size: 12px; color: var(--wp-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-pack__item-meta { flex: none; max-width: 40%; font-size: 11px; color: var(--wp-text-dim); text-align: right; overflow-wrap: anywhere; }
.wp-pack__remove {
  flex: none; width: 26px; height: 26px; border: 0; border-radius: 6px; background: none;
  color: var(--wp-text-dim); cursor: pointer;
}
.wp-pack__remove:hover { color: var(--wp-text); background: var(--wp-bg-2); }
.wp-pack__warnings { list-style: none; margin: 6px 0 0; padding: 0; font-size: 12px; color: var(--wp-warn); display: flex; flex-direction: column; gap: 3px; }
.wp-pack__state { flex: none; width: 16px; font-size: 13px; color: var(--wp-success); }
.wp-pack__state[data-status="failed"] { color: var(--wp-danger); }
.wp-pack__state[data-status="waiting"] { color: var(--wp-text-dim); }
.wp-pack__state[data-status="building"], .wp-pack__state[data-status="fixing"] { color: var(--wp-accent-text); }
.wp-pack__built .wp-pack__state .pi-exclamation-triangle { color: var(--wp-warn); }
.wp-pack__built + .wp-pack__built > .wp-pack__item { border-top: 1px solid var(--wp-border); }
.wp-pack__fixed { font-size: 12px; color: var(--wp-warn); }
.wp-pack__detail { padding: 0 0 8px 120px; }
.wp-pack__preview { margin: 0; padding: 6px 8px 6px 22px; font-size: 12px; border-radius: 6px; background: var(--wp-bg-1); display: flex; flex-direction: column; gap: 2px; overflow-wrap: anywhere; }
.wp-pack__ok { margin: 0 0 10px; color: var(--wp-success); font-size: 13px; display: flex; gap: 6px; align-items: center; }
.wp-pack__var { margin-top: 10px; display: grid; grid-template-columns: 110px 1fr; gap: 3px 10px; align-items: center; font-size: 12px; }
.wp-pack__var code { color: var(--wp-kind-wildcard); }
.wp-pack__var .wp-pack__bar { grid-column: 2; }
.wp-pack__var > .wp-pack__dim { grid-column: 2; grid-row: 1; }
.wp-pack__bar { position: relative; height: 18px; border-radius: 4px; background: color-mix(in oklab, var(--wp-accent-500) 10%, transparent); overflow: hidden; }
.wp-pack__bar-fill { position: absolute; inset: 0 auto 0 0; background: color-mix(in oklab, var(--wp-accent-500) 40%, transparent); }
.wp-pack__bar-label { position: relative; padding: 0 6px; line-height: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
.wp-pack__prompt p { margin: 0 0 4px; font-family: var(--wp-font-mono, monospace); font-size: 12px; overflow-wrap: anywhere; }
.wp-pack__prompt + .wp-pack__prompt { margin-top: 10px; }
.wp-pack__shape { margin: 4px 0 0; font-size: 12px; color: var(--wp-accent-text); }
.wp-pack__toggle { margin-top: 8px; border: 0; background: none; padding: 0; color: var(--wp-text-muted); font: inherit; font-size: 12.5px; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
.wp-pack__toggle:hover { color: var(--wp-text); }
.wp-pack__toggle + .wp-pack__request { margin-top: 6px; }
.wp-pack__findings { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; }
.wp-pack__findings li { display: flex; gap: 8px; align-items: baseline; }
.wp-pack__findings li[data-level="fix"] .pi { color: var(--wp-warn); }
.wp-pack__findings li[data-level="tip"] .pi { color: var(--wp-accent-text); }
.wp-pack__built .wp-pack__findings { margin: 6px 0 0; color: var(--wp-text-muted); }
.wp-pack__by { color: var(--wp-text-dim); }
.wp-pack__kind[data-kind="library"] { color: var(--wp-success); background: color-mix(in oklab, var(--wp-success) 14%, transparent); }
.wp-pack__tag { font-size: 12px; padding: 1px 7px; border-radius: 999px; border: 1px dashed var(--wp-accent-400); color: var(--wp-accent-text); }
.wp-pack__target {
  margin: 0; padding: 8px 12px; border-radius: 8px; font-size: 13px; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap;
  border: 1px solid color-mix(in oklab, var(--wp-accent-400) 45%, transparent);
  background: color-mix(in oklab, var(--wp-accent-500) 8%, transparent);
}
.wp-pack__link { border: 0; background: none; padding: 0; color: var(--wp-accent-text); cursor: pointer; font: inherit; text-decoration: underline; }
.wp-pack__label { margin: 12px 0 4px; font-size: 12px; color: var(--wp-text-muted); }
.wp-pack__settings { margin-top: 8px; }
.wp-pack__research { list-style: none; margin: 0 0 6px; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.wp-pack__research .pi { font-size: 11px; color: var(--wp-text-dim); }
.wp-pack__chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.wp-pack__chips + .wp-pack__chips { margin-top: 8px; }
.wp-pack__chip {
  max-width: 100%; padding: 3px 9px; border-radius: 999px; font-size: 12px; cursor: pointer; text-align: left;
  border: 1px solid var(--wp-border); background: var(--wp-bg-2); color: var(--wp-text); overflow-wrap: anywhere;
}
.wp-pack__chip b { font-weight: 600; color: var(--wp-text-muted); }
.wp-pack__chip--guess { border-style: dashed; color: var(--wp-text-muted); }
.wp-pack__edited { font-size: 10px; font-weight: 500; padding: 1px 6px; border-radius: 4px; color: var(--wp-accent-text); border: 1px solid var(--wp-accent-400); }
.wp-pack__icon-btn {
  flex: none; width: 26px; height: 26px; border: 0; border-radius: 6px; background: none;
  color: var(--wp-text-dim); cursor: pointer;
}
.wp-pack__icon-btn:hover { color: var(--wp-text); background: var(--wp-bg-2); }
.wp-pack__fixbox { display: flex; gap: 6px; margin: 4px 0 6px 120px; }
.wp-pack__fixbox input { flex: 1; min-width: 0; }
.wp-pack__mini { margin-left: auto; flex: none; border: 0; background: none; padding: 0 4px; font-size: 11px; color: var(--wp-text-dim); cursor: pointer; }
.wp-pack__mini:hover { color: var(--wp-text); }
.wp-pack__warnings li { display: flex; gap: 6px; align-items: baseline; }
.wp-pack__warnings li > span { min-width: 0; overflow-wrap: anywhere; }
.wp-pack__summary { margin: 10px 0 0; font-size: 12.5px; color: var(--wp-text-muted); }
.wp-pack__state[data-status="retrying"] { color: var(--wp-warn); }
.wp-pack__state[data-status="skipped"] { color: var(--wp-text-dim); }
.wp-pack__built[data-status="skipped"] .wp-pack__item-main { opacity: 0.55; }
</style>
