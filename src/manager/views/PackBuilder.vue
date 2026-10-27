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
import WpNumber from "@/components/shared/WpNumber.vue";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import Button from "../components/ui/Button.vue";
import Card from "../components/ui/Card.vue";
import Select from "../components/ui/Select.vue";
import AiImagePicker from "../components/ai/AiImagePicker.vue";
import AiSearchFound from "../components/ai/AiSearchFound.vue";
import AiWorking from "../components/ai/AiWorking.vue";
import ChatCompletions from "../components/ai/ChatCompletions.vue";
import ChatInputMarks from "../components/ai/ChatInputMarks.vue";
import PackFindings from "../components/pack/PackFindings.vue";
import PackPlanList from "../components/pack/PackPlanList.vue";
import PackQuestions from "../components/pack/PackQuestions.vue";
import PackRecommended from "../components/pack/PackRecommended.vue";
import PackSettings from "../components/pack/PackSettings.vue";
import { registerPageNote } from "../composables/useOpenEditor";
import { useAiChat } from "../composables/useAiChat";
import { mentionsImages, usePackBuilder, type ItemStatus } from "../composables/usePackBuilder";
import WpCheck from "../../components/shared/WpCheck.vue";
import { useAiConfig } from "../composables/useAiConfig";
import { useToast } from "../composables/useToast";
import { useModuleStore } from "../stores/moduleStore";
import { useBundleStore } from "../stores/bundleStore";
import { useTemplateStore } from "../stores/templateStore";
import { stillThere as problemStill } from "../utils/pack-problems";
import type { AiPackItem, AiPackRun } from "../api/types";
import LoadingMark from "@/components/shared/LoadingMark.vue";

const pb = usePackBuilder();

// Tell the AI chat which pack is being built, so it can help with the plan.
registerPageNote(() => {
  const plan = pb.plan.value;
  if (!plan) return "Pack builder, nothing planned yet";
  const items = plan.items.map((it) => `${it.name} (${it.kind}${it.var ? ` $${it.var}` : ""})`).join(", ");
  const check = pb.check.value;
  const problems = check ? Object.values(check.problems).flat().slice(0, 5) : [];
  const draft = pb.draft.value ?? plan;
  return [
    `Pack builder, step ${pb.phase.value}, pack "${plan.title}": ${items}`,
    draft.anchor ? `Anchor $${draft.anchor}` : "",
    draft.inputs.length ? `Inputs from a WP Context Injector: ${draft.inputs.map((i) => `$${i.var}`).join(", ")}` : "",
    draft.canvas?.length ? `Set on the user's canvas: ${draft.canvas.map((c) => `$${c.name} (${c.source})`).join(", ")}` : "",
    draft.warnings.length ? `Planner notes: ${draft.warnings.slice(0, 6).join("; ")}` : "",
    pb.target.value ? `Extending the bundle ${pb.target.value.name}` : "",
    check ? `Test run: ${check.runs} seeds; ${problems.length ? `problems: ${problems.join("; ")}` : "no problems"}` : "",
  ].filter(Boolean).join(". ");
});
const { convo } = pb;
const chat = useAiChat();

/** Ask the chat what a warning means here and what to do about it. */
/** A rule the planner wrote with a name the plan doesn't have: one narrow
 *  change call adds it back with the names that exist (the note lists them). */
const LEFT_OUT = "Left out a rule:";
function fixLeftOut(note: string): void {
  void pb.changeItem("", `${note.slice(LEFT_OUT.length).trim()} Add this rule again with names `
    + "the plan has (one rule per value if it means several), or add nothing if the pack doesn't "
    + "need it.");
}

function explain(warning: string, item?: AiPackItem): void {
  const about = item ? ` about ${item.kind.replace("_", " ")} "${item.name}"` : "";
  // The plan isn't in the library yet: without saying so, a small model
  // searched the library for the names in the note and explained an
  // unrelated bundle (Dumi 2026-10-21).
  chat.ask(`Explain this pack builder note${about} and what I can do about it: "${warning}". `
    + "It is about the pack plan on this page, which is not in my library yet, so answer from "
    + "the plan (read the page if you need it), not from my library.");
}
const { config, ready } = useAiConfig();
const router = useRouter();
const toast = useToast();
const moduleStore = useModuleStore();
const bundleStore = useBundleStore();
const templateStore = useTemplateStore();
const open = ref(new Set<string>());
const showSettings = ref(false);
/** On the Settings step (after Describe, before the first plan). */
const settingUp = ref(false);

function startOver(): void {
  pb.reset();
  settingUp.value = false;
}

function toSettings(): void {
  if (!convo.instruction.value.trim()) return;
  settingUp.value = true;
  void pb.loadRecommended();
}

function onSettingsKey(ev: KeyboardEvent): void {
  if (settingUp.value && !result.value && ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
    ev.preventDefault();
    void pb.askPlan();
  }
}
onMounted(() => window.addEventListener("keydown", onSettingsKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onSettingsKey));
const editBox = ref<HTMLTextAreaElement | null>(null);
const requestBox = ref<HTMLTextAreaElement | null>(null);
const sampleBox = ref<HTMLTextAreaElement | null>(null);
/** A short note under the edit box after a click put text in it. */
const flash = ref("");
let flashTimer: ReturnType<typeof setTimeout> | null = null;

/** Show where a click's text went: scroll to the edit box, focus it with
 *  the caret at the end, and light it up for a moment. */
async function pointAtEdit(note: string): Promise<void> {
  await nextTick();
  const el = editBox.value;
  if (el) {
    el.scrollIntoView?.({ block: "center", behavior: "smooth" });
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }
  flash.value = note;
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flash.value = ""; }, 6000);
}

function reopen(i: number): void {
  if (pb.reopenDecision(i)) void pointAtEdit("Added to Change the plan: finish the sentence, then Update plan. Click the decision again to keep it.");
}

function correct(text: string): void {
  pb.changeAssumption(text);
  void pointAtEdit("Added to Change the plan: say what it should be, then Update plan.");
}

function short(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

/** How full the model's window was on the last plan request. Every
 *  refine resends the conversation, so it grows round by round. */
const meter = computed(() => {
  const c = result.value?.context;
  if (!c || !c.window) return null;
  const ratio = Math.min(1, c.used / c.window);
  return {
    pct: Math.max(2, Math.round(ratio * 100)),
    level: ratio >= 0.85 ? "full" : ratio >= 0.6 ? "high" : "ok",
    label: `${c.estimated ? "~" : ""}${short(c.used)} of ${c.about ? "about " : ""}${short(c.window)} tokens`,
    why: `The last plan request and its answer took about ${c.used.toLocaleString()} of the ${c.window.toLocaleString()} tokens the model holds.`
      + " Each update sends the whole conversation again; near the top, Start over with what you decided in the request.",
  };
});

const imagesMentioned = computed(() => mentionsImages(convo.instruction.value));

const changedCount = computed(() => Object.keys(pb.changes.value).length);
const changedLine = computed(() => {
  const all = Object.values(pb.changes.value);
  const fresh = all.filter((c) => c.kind === "new").length;
  const edited = all.length - fresh;
  return [fresh ? `${fresh} new` : "", edited ? `${edited} changed` : ""].filter(Boolean).join(", ");
});
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
/** Matches the server's install check: a new item other than the template
 *  must have built (an extended bundle's own items don't count). */
const installable = computed(() => builtItems.value.some(
  (i) => i.kind !== "template" && !i.existing && pb.states.value[i.key]?.result,
));
/** Extending a bundle where only the template built. */
const onlyTemplate = computed(() => !!pb.target.value && hasTemplate.value && !installable.value);
const steps = computed(() => [
  { label: "Describe", done: !!result.value || settingUp.value, on: !result.value && !settingUp.value },
  { label: "Settings", done: !!result.value, on: !result.value && settingUp.value },
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

/** Whether the problem a rebuild was asked to fix is still in the check:
 *  "fixed:" then would claim a fix that didn't happen. */
function stillThere(key: string): boolean {
  return problemStill(pb.states.value[key]?.fixed ?? [], problems(key));
}

/** Why a problem a Fix was sent for is still there. */
function stillWhy(key: string): string {
  return pb.states.value[key]?.result?.wired
    ? "The code writes this item from the plan, so a rebuild gives the same: change the plan, or dismiss it."
    : "The rebuild didn't clear it: rebuild with a note of your own, edit it after install, or dismiss it.";
}

const RANK: Record<AiPackItem["kind"], number> = {
  fixed_values: 0, library: 1, wildcard: 1, derivation: 2, combine: 3, constraint: 1, template: 5,
};
/** Where an item sits in the list: run order once the check has run (what
 *  install keeps); before that, by kind, with a constraint just ahead of
 *  its target wildcard, where it runs. */
function order(i: AiPackItem): number {
  const ran = pb.check.value?.order;
  if (ran?.length) {
    const at = ran.indexOf(i.key);
    return at >= 0 ? at : ran.length + RANK[i.kind] * 1000 + items.value.indexOf(i);
  }
  if (i.kind === "constraint") {
    const target = items.value.find((x) => x.var === i.target && x.kind !== "constraint");
    if (target) return order(target) - 0.5;
  }
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

/** A graph plan's relations the check could verify on its runs. */
const rulesChecked = computed(() => (pb.check.value?.relations ?? []).filter((r) => r.checked));

function quality(key: string): string[] {
  return (pb.check.value?.quality ?? [])
    .filter((q) => q.key === key && !pb.dismissedNotes.value.has(`${key}:${q.text}`))
    .map((q) => q.text);
}

const STYLE_LABEL = { tags: "Danbooru-style tags", sentences: "natural phrases" } as const;
const shape = computed(() => {
  const p = draft.value;
  if (!p) return [];
  return [
    `Written as ${STYLE_LABEL[p.style] ?? "tags"}`,
    p.model ? `For ${p.model}` : "",
    p.anchor ? `Everything follows $${p.anchor}` : "",
  ].filter(Boolean);
});
const showSample = ref(!!pb.sample.value);

// How the pack runs is read from the request (or asked); this lets the
// user correct it by hand.
const RUN_OPTIONS = [
  { value: "single", label: "Single images", title: "Every run is its own random prompt." },
  { value: "story", label: "Story over a Loop", title: "A WP Context Loop plays the frames in order: a story beat per frame from $iteration, the cast held." },
  { value: "sweep", label: "Sweep sheet", title: "A few short wildcards as Loop sweep axes; everything else held." },
];
const run = computed<AiPackRun>(() => draft.value?.run ?? { mode: "single", frames: 0 });
function setRunMode(mode: AiPackRun["mode"]): void {
  pb.editPlan({ run: { mode, frames: mode === "story" ? run.value.frames || 4 : 0 } });
}
function setRunFrames(v: number | null): void {
  const n = Math.round(Number(v));
  // The server keeps it within 2–12.
  pb.editPlan({ run: { mode: "story", frames: Number.isFinite(n) && n > 0 ? Math.max(2, Math.min(12, n)) : 4 } });
}

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

    <!-- ── Settings (between describe and plan; kept for next time) ─── -->
    <div v-else-if="!result && settingUp" class="wp-pack__describe">
      <Card title="Pack settings" data-test="pack-settings-step">
        <p class="wp-pack__hint">
          <i class="pi pi-sliders-h wp-pack__hint-icon" aria-hidden="true" />
          How the pack is built. Your choices are kept for the next pack, so next time this is one
          click. You can still change them later under <b>Change the plan</b>; the next update
          follows them.
        </p>
        <PackRecommended
          v-if="pb.recommended.value"
          :changes="pb.recommendedChanges.value"
          :disabled="convo.loading.value"
          @use="pb.takeRecommended"
        />
        <PackSettings v-model="pb.settings.value" detailed :disabled="convo.loading.value" />
        <div class="wp-pack__row">
          <Button variant="ghost" size="sm" icon="pi-arrow-left" :disabled="convo.loading.value" data-test="pack-back" @click="settingUp = false">Back</Button>
          <span class="wp-pack__spacer" />
          <span class="wp-pack__dim">Ctrl+Enter plans it.</span>
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
        <AiWorking v-if="convo.loading.value" class="wp-pack__status" label="Planning" data-test="pack-working" />
        <p v-if="convo.error.value" class="wp-pack__error" role="alert">{{ convo.error.value }}</p>
      </Card>
    </div>

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
          ref="requestBox"
          v-model="convo.instruction.value"
          class="wp-textarea wp-pack__request"
          rows="5"
          :placeholder="pb.target.value ? 'Add weather that fits the season, and keep elves away from guns.' : `A fantasy character pack: race, class, an outfit and a weapon that fit the class. Elves never use guns. Give each character a title like 'Elven Archmage'.`"
          aria-label="Describe the pack"
          data-test="pack-request" data-ai-anchor="pack-request" data-ai-label="Describe the pack"
          :disabled="convo.loading.value"
          @keydown="onKey($event, toSettings)"
        ></textarea>
        <ChatInputMarks :target="requestBox" :text="convo.instruction.value" />
        <ChatCompletions :target="requestBox" />
        <button
          type="button"
          class="wp-pack__toggle"
          :aria-expanded="showSample"
          data-test="pack-sample-toggle"
          @click="showSample = !showSample"
        ><i :class="['pi', showSample ? 'pi-chevron-down' : 'pi-chevron-right']" aria-hidden="true" /> Start from a prompt you like</button>
        <template v-if="showSample">
          <textarea
            ref="sampleBox"
            v-model="pb.sample.value"
            class="wp-textarea wp-pack__request"
            rows="3"
            placeholder="1girl, long red hair, green eyes, sundress, sitting on a pier, sunset, masterpiece, best quality"
            aria-label="A prompt you like"
            data-test="pack-sample"
            :disabled="convo.loading.value"
          ></textarea>
          <ChatInputMarks :target="sampleBox" :text="pb.sample.value" />
          <ChatCompletions :target="sampleBox" />
          <p class="wp-pack__dim">The plan splits it into slots, reuses your wildcards where they fit and builds the rest, so the pack makes more prompts like it.</p>
        </template>
        <p class="wp-pack__label">Reference images</p>
        <AiImagePicker
          :images="pb.images"
          :disabled="convo.loading.value"
          hint="The planner reads subject, outfit, setting, palette, lighting and style from them and plans slots that make more pictures like these."
        />
        <div class="wp-pack__row">
          <span class="wp-pack__dim">Ctrl+Enter goes on. Nothing is saved until you install.</span>
          <Button
            variant="primary"
            icon="pi-arrow-right"
            :disabled="!convo.instruction.value.trim()"
            data-test="pack-next" data-ai-anchor="pack-next" data-ai-label="Next: pack settings button"
            @click="toSettings"
          >Next: pack settings</Button>
        </div>
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
              Plan {{ convo.index.value + 1 }} of {{ convo.count.value }}<span v-if="convo.branchedFrom.value" class="wp-pack__dim" title="Made by changing an earlier plan; the plans after that one are kept" data-test="pack-branch"> · from plan {{ convo.branchedFrom.value }}</span>
              <button type="button" aria-label="Later plan" :disabled="convo.index.value >= convo.count.value - 1 || busy" @click="convo.go(1)"><i class="pi pi-chevron-right" aria-hidden="true" /></button>
            </span>
            <span class="wp-pack__spacer" />
            <span v-if="meter" class="wp-pack__meter" :data-level="meter.level" :title="meter.why" data-test="pack-meter">
              <span class="wp-pack__meter-bar"><span :style="{ width: `${meter.pct}%` }" /></span>
              {{ meter.label }}
            </span>
            <Button size="sm" icon="pi-refresh" :disabled="busy" title="Drop this plan and start from your request again" data-test="pack-reset" @click="startOver">Start over</Button>
          </div>
        </Card>
        <section v-if="pb.research.value.length" class="wp-pack__ask-web" aria-label="Web search request" data-test="pack-research">
          <header class="wp-pack__ask-web-head">
            <i class="pi pi-globe" aria-hidden="true" />
            <span>The assistant wants to search the web first</span>
          </header>
          <p class="wp-pack__ask-web-why">What it finds can change the questions and the plan, so answers, plan updates and Build wait for your answer here.</p>
          <ul class="wp-pack__research">
            <li v-for="q in pb.research.value" :key="q"><i class="pi pi-search" aria-hidden="true" /> {{ q }}</li>
          </ul>
          <p class="wp-pack__dim">Only the search words leave your machine; the results are read as reference, never as instructions.<template v-if="pb.answeredCount.value"> Your answers so far go along.</template></p>
          <div class="wp-pack__row">
            <span class="wp-pack__spacer" />
            <Button size="sm" variant="ghost" :disabled="busy" data-test="pack-research-skip" @click="pb.skipResearch">Skip the search</Button>
            <Button size="sm" variant="primary" icon="pi-search" :loading="pb.searching.value" :disabled="busy" data-test="pack-research-allow" @click="pb.allowResearch">Search the web</Button>
          </div>
        </section>
        <AiSearchFound
          :state="pb.web"
          :busy="busy"
          who="the planner"
          then="update the plan"
          @use="pb.useFound"
          @none="pb.skipFound"
        />
        <Card v-if="pb.questions.value.length" :title="`Questions from the assistant · ${pb.questions.value.length}`">
          <PackQuestions />
        </Card>
        <Card v-if="pb.decisions.value.length || draft?.assumptions.length || draft?.from_images?.length" title="Decided and assumed" data-test="pack-decisions">
          <div v-if="pb.decisions.value.length" class="wp-pack__chips">
            <span class="wp-pack__dim">You decided:</span>
            <button
              v-for="(d, i) in pb.decisions.value"
              :key="d.question"
              type="button"
              class="wp-pack__chip"
              :title="pb.reopened.value.has(d.question) ? 'Being answered again in Change the plan. Click to keep it as it was.' : `${d.question} Click to change it.`"
              :disabled="busy"
              :data-reopened="pb.reopened.value.has(d.question) ? 'true' : undefined"
              data-test="pack-decision"
              @click="reopen(i)"
            ><i v-if="pb.reopened.value.has(d.question)" class="pi pi-pencil" aria-hidden="true" /><b>{{ d.question.length > 40 ? d.question.slice(0, 38) + '…' : d.question }}</b> {{ d.answer }}</button>
          </div>
          <div v-if="draft?.from_images?.length" class="wp-pack__chips" data-test="pack-from-images">
            <span class="wp-pack__dim"><i class="pi pi-image" aria-hidden="true" /> From your images:</span>
            <button
              v-for="a in draft.from_images"
              :key="a"
              type="button"
              class="wp-pack__chip wp-pack__chip--image"
              title="What the assistant read from your reference images. Click to correct it."
              :disabled="busy"
              data-test="pack-from-image"
              @click="correct(a)"
            ><i class="pi pi-image" aria-hidden="true" /> {{ a }}</button>
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
              @click="correct(a)"
            >{{ a }}</button>
          </div>
        </Card>
        <Card title="Plan review">
          <PackFindings />
        </Card>
        <Card title="Change the plan">
          <textarea
            ref="editBox"
            v-model="convo.instruction.value"
            :class="['wp-textarea', 'wp-pack__request', { 'wp-pack__request--flash': flash }]"
            rows="2"
            placeholder="Add a $time_of_day wildcard with day, dusk and night…"
            aria-label="Change the plan"
            data-test="pack-edit"
            :disabled="convo.loading.value"
            @keydown="onKey($event, pb.refinePlan)"
          ></textarea>
          <ChatInputMarks :target="editBox" :text="convo.instruction.value" />
          <ChatCompletions :target="editBox" />
          <p v-if="flash" class="wp-pack__flash-note" role="status" data-test="pack-edit-note"><i class="pi pi-arrow-up" aria-hidden="true" /> {{ flash }}</p>
          <button
            type="button"
            class="wp-pack__toggle"
            :aria-expanded="showSettings"
            data-test="pack-settings-toggle"
            @click="showSettings = !showSettings"
          ><i :class="['pi', showSettings ? 'pi-chevron-down' : 'pi-chevron-right']" aria-hidden="true" /> Settings and images <span class="wp-pack__dim">· {{ settingsLine }}{{ pb.images.images.value.length ? ` · ${pb.images.images.value.length} image${pb.images.images.value.length === 1 ? '' : 's'}` : '' }}</span></button>
          <template v-if="showSettings">
            <p class="wp-pack__dim wp-pack__settings" data-test="pack-settings-note"><template v-if="draft?.graph">Settings land on the plan as you change them (the code caps counts, sets the style and rating, folds sections; no AI call); <b>Update plan</b> asks the AI to rework the rest for them.</template><template v-else>Changes here apply from the next update: <b>Update plan</b> reworks the plan to follow them.</template> A removed image isn't sent again, but what the planner already took from it stays unless you ask it to drop it.</p>
            <PackSettings v-model="pb.settings.value" class="wp-pack__settings" :disabled="convo.loading.value" />
            <AiImagePicker :images="pb.images" :disabled="convo.loading.value" compact class="wp-pack__settings" />
            <p v-if="pb.changing.value === 'images'" class="wp-pack__dim wp-pack__settings" data-test="pack-reading-images"><LoadingMark decorative /> Reading the new images into the plan…</p>
          </template>
          <label v-if="pb.images.images.value.length" class="wp-pack__resend" data-test="pack-resend-images">
            <WpCheck :model-value="pb.resendImages.value || imagesMentioned" :disabled="imagesMentioned || convo.loading.value" @update:model-value="(v: boolean) => (pb.resendImages.value = v)" />
            <span>Show the images again with this update<span class="wp-pack__dim"> · {{ imagesMentioned ? 'your text mentions them, so they go along' : 'about 1,000 tokens each; otherwise they go only when you add or remove one' }}</span></span>
          </label>
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
          <p v-if="convo.error.value" class="wp-pack__error" role="alert">{{ convo.error.value }}</p>
          <p v-if="pb.error.value" class="wp-pack__error" role="alert">{{ pb.error.value }}</p>
        </Card>
      </div>

      <Card class="wp-pack__plan" :title="`Plan · ${keptCount} items`">
        <p class="wp-pack__title">{{ draft?.title }}
          <span v-if="draft?.rating === 'nsfw'" class="wp-pack__nsfw">NSFW</span>
          <span v-if="pb.edited.value" class="wp-pack__edited" data-test="pack-edited">edited by you</span>
        </p>
        <p v-if="draft?.summary" class="wp-pack__summary">{{ draft.summary }}</p>
        <div v-if="draft?.design" class="wp-pack__design" data-test="pack-design"><span class="wp-pack__design-label">How it fits together</span><p>{{ draft.design }}</p></div>
        <details v-if="pb.planThinking.value" class="wp-pack__thought" data-test="pack-thinking">
          <summary>Thinking</summary>
          <p>{{ pb.planThinking.value }}</p>
        </details>
        <p v-if="shape.length" class="wp-pack__shape" data-test="pack-shape">
          <span v-for="part in shape" :key="part" class="wp-pack__shape-chip">{{ part }}</span>
        </p>
        <div v-if="draft" class="wp-pack__run" data-test="pack-run">
          <span class="wp-pack__dim wp-pack__run-label">Runs as</span>
          <Select
            size="sm"
            :model-value="run.mode"
            :options="RUN_OPTIONS"
            :filterable="false"
            :disabled="convo.loading.value"
            aria-label="How the pack runs"
            data-test="pack-run-mode"
            @update:model-value="(v) => setRunMode(v as AiPackRun['mode'])"
          />
          <template v-if="run.mode === 'story'">
            <WpNumber commit="input"
              size="sm"
              class="wp-pack__run-frames"
              :model-value="run.frames"
              :min="2"
              :max="12"
              :disabled="convo.loading.value"
              aria-label="Story frames"
              data-test="pack-run-frames"
              @update:model-value="setRunFrames"
            />
            <span class="wp-pack__dim">frames</span>
          </template>
        </div>
        <AiWorking v-if="convo.loading.value || pb.searching.value" class="wp-pack__plan-working" :label="pb.searching.value ? 'Searching the web' : 'Updating the plan'" :size="34" data-test="pack-working" />
        <p v-if="pb.awaitingSearch.value" class="wp-pack__waiting" data-test="pack-waiting-search"><i class="pi pi-globe" aria-hidden="true" /> Waiting for your answer on the web search; this plan may change.</p>
        <p v-if="changedCount || pb.dropped.value.length" class="wp-pack__changed" data-test="pack-changed">
          <i class="pi pi-history" aria-hidden="true" />
          <span>This round: <template v-if="changedCount">{{ changedLine }}</template><template v-if="pb.dropped.value.length"><template v-if="changedCount">; </template>removed {{ pb.dropped.value.join(", ") }}</template>.</span>
        </p>
        <p v-if="draft?.applied?.length" class="wp-pack__changed" data-test="pack-applied">
          <i class="pi pi-cog" aria-hidden="true" />
          <span>Wired by the code: {{ draft.applied.join("; ") }}.</span>
        </p>
        <PackPlanList />
        <div v-if="draft?.inputs?.length" class="wp-pack__inputs" data-test="pack-inputs">
          <p class="wp-pack__dim">Set from outside (a WP Context Injector row each):</p>
          <ul>
            <li v-for="inp in draft.inputs" :key="inp.var">
              <code>${{ inp.var }}</code> {{ inp.about }}<span v-if="inp.example" class="wp-pack__dim"> · tested as "{{ inp.example }}"</span>
            </li>
          </ul>
        </div>
        <ul v-if="draft?.warnings.length" class="wp-pack__warnings" data-test="pack-plan-notes">
          <li v-for="(w, j) in draft.warnings" :key="j">
            <i class="pi pi-info-circle" aria-hidden="true" /> <span>{{ w }}</span>
            <button
              v-if="w.startsWith(LEFT_OUT)"
              type="button"
              class="wp-pack__mini"
              :disabled="busy || !!pb.changing.value"
              title="Ask the planner to write this rule again with names the plan has"
              data-test="pack-left-out-fix"
              @click="fixLeftOut(w)"
            >Fix with AI</button>
            <button type="button" class="wp-pack__mini" :disabled="chat.loading.value" title="Ask the assistant what this means" data-test="pack-explain" @click="explain(w)">Explain</button>
          </li>
        </ul>
        <div class="wp-pack__row">
          <span class="wp-pack__spacer" />
          <Button
            variant="primary"
            icon="pi-cog"
            :disabled="!keptCount || busy || pb.awaitingSearch.value"
            :title="pb.awaitingSearch.value ? 'Answer the web search first' : undefined"
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
                <LoadingMark v-if="spinning(i.key)" decorative />
                <i v-else-if="status(i.key) === 'failed'" class="pi pi-times-circle" aria-hidden="true" />
                <i v-else-if="status(i.key) === 'skipped'" class="pi pi-forward" aria-hidden="true" />
                <i v-else-if="status(i.key) === 'waiting'" class="pi pi-circle" aria-hidden="true" />
                <i v-else-if="problems(i.key).length" class="pi pi-exclamation-triangle" aria-hidden="true" />
                <i v-else class="pi pi-check" aria-hidden="true" />
              </span>
              <span class="wp-pack__kind" :data-kind="i.kind">{{ kindLabel(i) }}</span>
              <button type="button" class="wp-pack__item-main wp-pack__expand" :aria-expanded="open.has(i.key)" @click="toggle(i.key)">
                <span class="wp-pack__item-name">{{ i.name }}</span>
                <span
                  v-if="pb.states.value[i.key].fixed?.length && status(i.key) !== 'fixing' && !pb.working.value"
                  class="wp-pack__fixed"
                  :data-still="stillThere(i.key) ? 'true' : undefined"
                  :title="stillThere(i.key) ? stillWhy(i.key) : undefined"
                  data-test="pack-fixed"
                >
                  {{ stillThere(i.key) ? "still: " : "fixed: " }}{{ pb.states.value[i.key].fixed?.[0] }}
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
            <p v-if="pb.states.value[i.key].fixed?.length && status(i.key) !== 'fixing' && !pb.working.value && stillThere(i.key)" class="wp-pack__dim wp-pack__still" data-test="pack-still-why">{{ stillWhy(i.key) }}</p>
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
                <template v-if="!pb.working.value">
                  <button v-if="pb.states.value[i.key].result?.wired" type="button" class="wp-pack__mini" title="The code writes this item from the plan, so a rebuild gives the same: change the plan" data-test="pack-problem-plan" @click="pb.backToPlan">Change the plan</button>
                  <button v-else-if="i.kind !== 'library'" type="button" class="wp-pack__mini" title="Build this item again with the warning as the note" data-test="pack-problem-fix" @click="pb.rebuild(i.key, w)">Fix with AI</button>
                  <button type="button" class="wp-pack__mini" :disabled="chat.loading.value" title="Ask the assistant what this means" data-test="pack-problem-explain" @click="explain(w, i)">Explain</button>
                  <button type="button" class="wp-pack__mini" data-test="pack-problem-dismiss" @click="pb.dismissNote(i.key, w)">Dismiss</button>
                </template>
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
              <details v-if="pb.states.value[i.key].result?.thinking" class="wp-pack__thought" data-test="pack-item-thinking">
                <summary>Thinking</summary>
                <p>{{ pb.states.value[i.key].result?.thinking }}</p>
              </details>
            </div>
          </li>
        </ul>
        <p v-if="pb.working.value" class="wp-pack__status" role="status" data-test="pack-stage">
          <AiWorking :label="pb.stage.value" />
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
            <li v-for="(n, j) in pb.check.value.notes" :key="`n${j}`">
              <span>{{ n }}</span>
              <button type="button" class="wp-pack__mini" :disabled="chat.loading.value" data-test="pack-note-explain" @click="explain(n)">Explain</button>
            </li>
          </ul>
          <div v-if="pb.fixAllCount.value && !pb.working.value && pb.phase.value === 'build'" class="wp-pack__row" data-test="pack-problems-actions">
            <span class="wp-pack__dim">Rebuilds {{ pb.fixAllCount.value === 1 ? 'the item' : `the ${pb.fixAllCount.value} items` }} with a problem, each with its problems as the note, then tests again.</span>
            <span class="wp-pack__spacer" />
            <Button size="sm" icon="pi-wrench" data-test="pack-problems-fix-all" @click="pb.fixAll">Fix all with AI</Button>
          </div>
          <p v-if="rulesChecked.length" class="wp-pack__dim" data-test="pack-rules">
            Rules checked on the runs: {{ rulesChecked.filter((r) => r.holds).length }} of {{ rulesChecked.length }} held<template v-if="rulesChecked.some((r) => !r.holds)">; the broken ones are listed above</template>.
          </p>
          <div v-for="v in pb.check.value.variables.slice(0, 6)" :key="v.var" class="wp-pack__var">
            <code>${{ v.var }}</code>
            <span class="wp-pack__dim">{{ v.distinct }} value{{ v.distinct === 1 ? '' : 's' }}</span>
            <div v-for="t in v.top" :key="t.value" class="wp-pack__bar">
              <span class="wp-pack__bar-fill" :style="{ width: `${Math.round(t.share * 100)}%` }" />
              <span class="wp-pack__bar-label"><template v-if="t.value">{{ t.value }}</template><i v-else>(none)</i> {{ Math.round(t.share * 100) }}%</span>
            </div>
            <span v-if="v.distinct > v.top.length" class="wp-pack__dim wp-pack__more" data-test="pack-var-more">+{{ v.distinct - v.top.length }} more</span>
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
          <p v-else-if="onlyTemplate" class="wp-pack__dim" data-test="pack-nothing">Only the template built, so there is nothing new to add to the bundle yet. Retry a failed item, or go back to the plan to add something new.</p>
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
.wp-pack__title { margin: 0 0 2px; font-size: 15px; font-weight: 600; display: flex; gap: 8px; align-items: center; }
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
.wp-pack__run { display: flex; align-items: center; gap: 8px; margin: 12px 0 10px; font-size: 12.5px; }
.wp-pack__run-frames { width: 72px; }
.wp-pack__run-label { white-space: nowrap; }
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
.wp-pack__fixed { font-size: 12px; color: var(--wp-success); }
.wp-pack__fixed[data-still="true"] { color: var(--wp-warn); }
.wp-pack__still { margin: 2px 0 0 28px; }
.wp-pack__var > .wp-pack__dim.wp-pack__more { grid-column: 2; grid-row: auto; }
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
.wp-pack__shape { margin: 10px 0 0; display: flex; flex-wrap: wrap; gap: 6px; }
.wp-pack__shape-chip { font-size: 12px; padding: 2px 9px; border-radius: 999px; color: var(--wp-accent-text); background: color-mix(in oklab, var(--wp-accent-500) 10%, transparent); border: 1px solid color-mix(in oklab, var(--wp-accent-500) 30%, transparent); }
.wp-pack__summary { margin: 4px 0 0; font-size: 13px; line-height: 1.55; color: var(--wp-text-muted); }
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
.wp-pack__chips + .wp-pack__chips { margin-top: 10px; }
.wp-pack__chips > .wp-pack__dim { flex-basis: 100%; }
.wp-pack__plan-working {
  margin: 4px 0 10px; padding: 10px 12px; border-radius: 10px;
  border: 1px solid var(--wp-accent-400); background: var(--wp-accent-glow);
}
.wp-pack__plan-working ~ :deep(.wp-pack-list) { opacity: 0.55; transition: opacity 0.2s; }
.wp-pack__chip {
  max-width: 100%; padding: 4px 10px; border-radius: 10px; line-height: 1.45; font-size: 12px; cursor: pointer; text-align: left;
  border: 1px solid var(--wp-border); background: var(--wp-bg-2); color: var(--wp-text); overflow-wrap: anywhere;
}
.wp-pack__chip b { font-weight: 600; color: var(--wp-text-muted); }
.wp-pack__chip--guess { border-style: dashed; color: var(--wp-text-muted); }
.wp-pack__chip--image { border-color: color-mix(in srgb, #33d6c6 45%, var(--wp-border)); }
.wp-pack__chip .pi { font-size: 11px; margin-right: 4px; }
.wp-pack__chip--image .pi, .wp-pack__dim .pi-image { color: #33d6c6; }
.wp-pack__chip[data-reopened="true"] { border-color: var(--wp-accent-400); color: var(--wp-text-muted); text-decoration: line-through; text-decoration-color: var(--wp-accent-400); }
.wp-pack__chip[data-reopened="true"] .pi { color: var(--wp-accent-text); text-decoration: none; }
/* The web search ask: answered before anything else moves on. */
.wp-pack__ask-web {
  display: flex; flex-direction: column; gap: 8px; padding: 14px 16px; border-radius: 10px;
  border: 1px solid var(--wp-accent-400); background: linear-gradient(135deg, var(--wp-accent-glow), transparent 70%);
  box-shadow: 0 0 0 3px var(--wp-accent-glow);
  animation: wp-pack-ask-in 0.5s ease-out, wp-pack-ask-pulse 2.4s ease-in-out 0.5s 3;
}
.wp-pack__ask-web-head { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; color: var(--wp-text); }
.wp-pack__ask-web-head .pi { color: var(--wp-accent-text); font-size: 16px; }
.wp-pack__ask-web-why { margin: 0; font-size: 12px; color: var(--wp-text-muted); }
@keyframes wp-pack-ask-in { from { opacity: 0; transform: translateY(-6px); } }
@keyframes wp-pack-ask-pulse { 50% { box-shadow: 0 0 0 6px var(--wp-accent-glow); } }
.wp-pack__waiting, .wp-pack__changed { margin: 6px 0; display: flex; gap: 6px; align-items: baseline; font-size: 12px; color: var(--wp-text-muted); }
.wp-pack__waiting { color: var(--wp-accent-text); }
.wp-pack__request--flash { animation: wp-pack-flash 1.6s ease-out; border-color: var(--wp-accent-400); }
@keyframes wp-pack-flash { 0%, 30% { box-shadow: 0 0 0 4px var(--wp-accent-glow); } 100% { box-shadow: 0 0 0 0 transparent; } }
.wp-pack__resend { display: flex; gap: 8px; align-items: flex-start; margin-top: 8px; font-size: 12px; cursor: pointer; }
.wp-pack__flash-note { margin: 4px 0 0; font-size: 12px; color: var(--wp-accent-text); display: flex; gap: 6px; align-items: baseline; }
.wp-pack__meter { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--wp-text-dim); margin-right: 8px; }
.wp-pack__meter-bar { width: 56px; height: 4px; border-radius: 2px; background: var(--wp-bg-2); overflow: hidden; }
.wp-pack__meter-bar span { display: block; height: 100%; background: var(--wp-accent); }
.wp-pack__meter[data-level="high"] .wp-pack__meter-bar span { background: var(--wp-warn); }
.wp-pack__meter[data-level="full"] .wp-pack__meter-bar span { background: var(--wp-danger); }
@media (prefers-reduced-motion: reduce) {
  .wp-pack__ask-web, .wp-pack__request--flash { animation: none; }
}
.wp-pack__edited { font-size: 10px; font-weight: 500; padding: 1px 6px; border-radius: 4px; color: var(--wp-accent-text); border: 1px solid var(--wp-accent-400); }
.wp-pack__icon-btn {
  flex: none; width: 26px; height: 26px; border: 0; border-radius: 6px; background: none;
  color: var(--wp-text-dim); cursor: pointer;
}
.wp-pack__icon-btn:hover { color: var(--wp-text); background: var(--wp-bg-2); }
.wp-pack__fixbox { display: flex; gap: 6px; margin: 4px 0 6px 120px; }
.wp-pack__fixbox input { flex: 1; min-width: 0; }
.wp-pack__mini { margin-left: auto; flex: none; border: 0; background: none; padding: 0 4px; font-size: 11px; color: var(--wp-text-dim); cursor: pointer; }
.wp-pack__mini + .wp-pack__mini { margin-left: 0; }
.wp-pack__mini:hover { color: var(--wp-text); }
.wp-pack__warnings li { display: flex; gap: 6px; align-items: baseline; }
.wp-pack__warnings li > span { min-width: 0; overflow-wrap: anywhere; }
.wp-pack__summary { margin: 10px 0 0; font-size: 12.5px; color: var(--wp-text-muted); }
.wp-pack__design { margin: 12px 0 0; padding: 10px 12px; border-radius: 8px; background: var(--wp-bg-1, var(--wp-bg-2)); border: 1px solid var(--wp-border); }
.wp-pack__design p { margin: 4px 0 0; font-size: 13px; line-height: 1.6; color: var(--wp-text); }
.wp-pack__design-label { display: block; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--wp-text-dim); }
.wp-pack__thought { margin: 6px 0 0; font-size: 12px; color: var(--wp-text-muted); }
.wp-pack__thought summary { cursor: pointer; font-style: italic; }
.wp-pack__thought p { white-space: pre-wrap; margin: 4px 0 0; padding-left: 8px; border-left: 2px solid var(--wp-border); max-height: 320px; overflow-y: auto; }
.wp-pack__state[data-status="retrying"] { color: var(--wp-warn); }
.wp-pack__state[data-status="skipped"] { color: var(--wp-text-dim); }
.wp-pack__built[data-status="skipped"] .wp-pack__item-main { opacity: 0.55; }
</style>
