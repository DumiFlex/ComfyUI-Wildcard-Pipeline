<script setup lang="ts">
/**
 * WildcardSubcategoriesCard — the wildcard editor's "Sub-Categories" card.
 *
 * Renders the registry as bordered group boxes: one per `tag_groups` axis (in
 * insertion order) plus a trailing "ungrouped" box for registry tags not
 * claimed by any axis (§4.3, H1). Each box owns its pills (⠿ name (count) ⋯),
 * an inline "+ tag", a fold caret, a rename input and a classify/accepts kind
 * toggle. Pills move between boxes by drag-and-drop or the kebab's
 * "Move to group…".
 *
 * The registry, groups, kinds and the card's open state are v-models owned by
 * the editor (they are part of its draft + dirty snapshot). Menus, folds,
 * drag state and the inline add-tag draft are transient and live here.
 * Rename… and Delete… cascade to other modules, so they are handed back to
 * the editor (`rename-tag` / `delete-tag`), which owns the cascade dialogs.
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import Card from "../ui/Card.vue";
import { useToast } from "../../composables/useToast";
import { validateSubcatName } from "@/manager/validation/names";
import {
  acceptsPromotionRefusal,
  acceptsRenameRefusal,
  axisHueFor,
  axisUncoveredCount as uncoveredIn,
  buildSubcatGroups,
  moveTagToAxis,
  moveTargetsFor,
  nextGroupName,
  OTHER_AXIS,
  removeAxis,
  renameAxis,
  subcatSummaryText,
  tagChipStyle,
  tagUsageCount as usageIn,
  type TagGroupKinds,
  type TagGroups,
  type TaggedOption,
} from "./tag-groups";

const props = defineProps<{
  /** The wildcard's options — read for the per-pill usage counts and the
   *  accepts-axis coverage advisory. */
  options: readonly TaggedOption[];
  /** `$varBinding`, for the accepts-axis tooltip and coverage note. */
  varBinding: string;
}>();

/** Section disclosure. The editor resolves the default once on load. */
const open = defineModel<boolean>("open", { required: true });
/** The sub-category registry (`payload.sub_categories`). */
const subCategories = defineModel<string[]>("subCategories", { required: true });
/** Axis → member tags (`payload.tag_groups`). */
const tagGroups = defineModel<TagGroups>("tagGroups", { required: true });
/** Axis → `accepts` (`payload.tag_group_kinds`); absent means classify. */
const tagGroupKinds = defineModel<TagGroupKinds>("tagGroupKinds", { required: true });

const emit = defineEmits<{
  /** Kebab → Rename… on a pill: open the cascade rename dialog. */
  "rename-tag": [tag: string];
  /** Kebab → Delete… on a pill: run the cascade delete path. */
  "delete-tag": [tag: string];
}>();

const toast = useToast();

const groups = computed(() => buildSubcatGroups(tagGroups.value, subCategories.value));
const summary = computed(() => subcatSummaryText(subCategories.value, tagGroups.value));

function chipStyle(tag: string): Record<string, string> {
  return tagChipStyle(tagGroups.value, tag);
}

/** Hue for a whole group box — the coloured group header + left accent so
 *  each axis reads as a distinct colour cluster (#8). */
function axisHue(axis: string): string {
  return axisHueFor(tagGroups.value, axis);
}

function tagUsageCount(tag: string): number {
  return usageIn(props.options, tag);
}

function axisUncoveredCount(axis: string): number {
  return uncoveredIn(props.options, tagGroups.value, axis);
}

/** Which group box currently has its inline "+ tag" input open, plus
 *  its draft text + live validation error. `OTHER_AXIS` is the synthetic
 *  ungrouped box (tags added there go to the registry but no axis). */
const addTagAxis = ref<string | null>(null);
const addTagDraft = ref("");
const addTagError = ref("");
/** Which pill's kebab menu is open, as `<axis>::<tag>` (axis namespaces
 *  the key so the same tag in two boxes doesn't collide). */
const openKebab = ref<string | null>(null);
/** The "Move to group…" submenu target — `<axis>::<tag>` of the pill
 *  whose move picker is expanded. */
const moveMenuFor = ref<string | null>(null);
/** When a menu opens too close to the viewport bottom we flip it to open
 *  upward so it isn't clipped off the end of the page (bugs #1/#4). */
const kebabDropUp = ref(false);
/** Drag-and-drop state: which pill tag is being dragged + which group box
 *  it's currently hovering, for the drop highlight (bug #2). */
const draggedTag = ref<string | null>(null);
const dragOverAxis = ref<string | null>(null);

/**
 * Axes the user has folded shut, by axis name.
 *
 * A wildcard with five axes and thirty tags fills the whole panel, and while
 * you are working on one axis the other four are just distance between you and
 * the options table. Per-axis rather than one global toggle so folding is a
 * way to focus, not an all-or-nothing switch.
 *
 * Session state, deliberately not persisted: it describes what you are doing
 * right now, and a fold remembered from last week would hide tags from
 * someone who has never seen them.
 */
const collapsedAxes = ref<Set<string>>(new Set());

function toggleAxisCollapsed(axis: string): void {
  const next = new Set(collapsedAxes.value);
  if (next.has(axis)) next.delete(axis);
  else next.add(axis);
  collapsedAxes.value = next;
}

function kebabKey(axis: string, tag: string): string {
  return `${axis}::${tag}`;
}

/** True when the trigger that fired `ev` sits within `menuPx` of the
 *  viewport bottom — i.e. a downward menu would be clipped, so flip up. */
function shouldDropUp(ev: MouseEvent | undefined, menuPx: number): boolean {
  const el = ev?.currentTarget as HTMLElement | null;
  const r = el?.getBoundingClientRect();
  return !!r && window.innerHeight - r.bottom < menuPx;
}

function toggleKebab(axis: string, tag: string, ev?: MouseEvent): void {
  const key = kebabKey(axis, tag);
  const opening = openKebab.value !== key;
  openKebab.value = opening ? key : null;
  moveMenuFor.value = null;
  if (opening) kebabDropUp.value = shouldDropUp(ev, 200);
}

function closeMenus(): void {
  openKebab.value = null;
  moveMenuFor.value = null;
}

/** Outside-click: any pointer landing outside an open menu / its trigger
 *  dismisses this card's menus and the inline add-tag input (bug #3). The
 *  exclusion list is the editor's own, so a click on another of its menus
 *  (an option's tag picker, the options filter) leaves these alone exactly as
 *  it leaves those. */
function onDocPointerDown(e: MouseEvent): void {
  const t = e.target as HTMLElement | null;
  if (
    t?.closest(
      ".subcat-pill, .subcat-menu, .subcat-addtag, .subcat-addtag__open, .opt-tags,"
      + " .opt-tags__picker, .wc-optfilter__tagbtn",
    )
  ) {
    return;
  }
  closeMenus();
  cancelAddTag();
}

function onDocKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    closeMenus();
    cancelAddTag();
  }
}

onMounted(() => {
  document.addEventListener("click", onDocPointerDown);
  document.addEventListener("keydown", onDocKeydown);
});

onUnmounted(() => {
  document.removeEventListener("click", onDocPointerDown);
  document.removeEventListener("keydown", onDocKeydown);
});

/* ── Inline "+ tag" per group ──────────────────────────────────────── */

function openAddTag(axis: string): void {
  addTagAxis.value = axis;
  addTagDraft.value = "";
  addTagError.value = "";
}

function cancelAddTag(): void {
  addTagAxis.value = null;
  addTagDraft.value = "";
  addTagError.value = "";
}

/** Validate + commit a new tag into the registry and (when not the
 *  ungrouped box) the target axis. Validation mirrors the shared parser's
 *  `validateSubcatName` (whitespace / reserved / disallowed-char rules)
 *  so the SPA rejects exactly what the engine + TS validator reject. */
function commitAddTag(axis: string): void {
  const raw = addTagDraft.value.trim();
  if (!raw) { cancelAddTag(); return; }
  const err = validateSubcatName(raw);
  if (err) { addTagError.value = err; return; }
  if (subCategories.value.includes(raw)) {
    addTagError.value = `"${raw}" already exists`;
    return;
  }
  subCategories.value = [...subCategories.value, raw];
  if (axis !== OTHER_AXIS) {
    const members = tagGroups.value[axis] ?? [];
    tagGroups.value = { ...tagGroups.value, [axis]: [...members, raw] };
  }
  // Keep the input open + cleared so several tags can be added in a row.
  addTagDraft.value = "";
  addTagError.value = "";
}

/* ── "+ Group" + group rename / ungroup ─────────────────────────────── */

/** Create a new empty axis with an auto-incrementing default name. */
function addGroup(): void {
  const candidate = nextGroupName(tagGroups.value);
  tagGroups.value = { ...tagGroups.value, [candidate]: [] };
  // Open its add-tag input straight away so the new box is usable.
  openAddTag(candidate);
}

/** Rename an axis in place. Preserves insertion order + members.
 *
 *  Axis names are not part of the `@{}` ref grammar, but an `accepts` axis IS
 *  addressable as `$var.NAME`, so a rename can strand a template read. The
 *  kind is carried across here; a stranded read is reported by the
 *  `unknown_tag_axis` conflict rule rather than blocked, matching how every
 *  other cross-module reference is handled.
 *
 *  Returns whether the rename was applied. A refused rename leaves the group
 *  exactly as it was and tells the user why, so the caller can put the old
 *  name back in the input. */
function renameGroup(oldAxis: string, nextAxis: string): boolean {
  const trimmed = nextAxis.trim();
  if (!trimmed || trimmed === oldAxis) return false;
  if (tagGroups.value[trimmed] !== undefined) {
    toast.push({
      severity: "warn",
      summary: `A group named "${trimmed}" already exists`,
      detail: `"${oldAxis}" keeps its name.`,
      life: 6000,
    });
    return false;
  }
  // An accepts group is read as `$var.NAME`. Renaming it to something that
  // grammar cannot parse used to demote it to classify without a word, which
  // quietly broke every `$var.AXIS` read of it. Refuse instead, the same way
  // `toggleGroupKind` refuses to promote such a name.
  const refusal = tagGroupKinds.value[oldAxis] === "accepts"
    ? acceptsRenameRefusal(oldAxis, trimmed)
    : null;
  if (refusal) {
    toast.push({ severity: "warn", ...refusal, life: 6000 });
    return false;
  }
  const next = renameAxis(tagGroups.value, tagGroupKinds.value, oldAxis, trimmed);
  tagGroups.value = next.groups;
  if (next.kinds !== tagGroupKinds.value) tagGroupKinds.value = next.kinds;
  return true;
}

/** The group-name input's change handler. The input is bound one-way to the
 *  group's name, so when a rename is refused nothing re-renders it — reset it
 *  by hand or it keeps showing a name that was never stored. */
function onGroupNameChange(oldAxis: string, e: Event): void {
  const input = e.target as HTMLInputElement;
  if (!renameGroup(oldAxis, input.value)) input.value = oldAxis;
}

/** Disband an axis — its tags fall back into the ungrouped box (they
 *  stay in the registry, just lose their grouping). */
function ungroupAxis(axis: string): void {
  if (tagGroups.value[axis] === undefined) return;
  const next = removeAxis(tagGroups.value, tagGroupKinds.value, axis);
  tagGroups.value = next.groups;
  if (next.kinds !== tagGroupKinds.value) tagGroupKinds.value = next.kinds;
}

/** Flip a group between descriptive (`classify`, the default) and `accepts`.
 *
 *  Refuses a name the accessor grammar cannot parse, here in the editor where
 *  the user can still fix it cheaply, rather than at save time where the
 *  message arrives after the work is done. Nothing is stored on refusal and
 *  the button renders from `tagGroupKinds`, so the control cannot end up
 *  showing a state we declined to keep. */
function toggleGroupKind(axis: string): void {
  const next = { ...tagGroupKinds.value };
  if (next[axis] === "accepts") {
    delete next[axis];
    tagGroupKinds.value = next;
    return;
  }
  const refusal = acceptsPromotionRefusal(axis);
  if (refusal) {
    toast.push({ severity: "warn", ...refusal, life: 6000 });
    return;
  }
  next[axis] = "accepts";
  tagGroupKinds.value = next;
}

/** Destinations the "Move to group…" submenu offers for a pill. */
function moveTargets(fromAxis: string): Array<{ axis: string; label: string }> {
  return moveTargetsFor(tagGroups.value, fromAxis);
}

/** Move a tag from its current axis into `targetAxis` (OTHER_AXIS =
 *  ungroup it). A tag lives in at most one axis (§2.2). */
function moveTagToGroup(tag: string, targetAxis: string): void {
  tagGroups.value = moveTagToAxis(tagGroups.value, tag, targetAxis);
  closeMenus();
}

defineExpose({ renameGroup, ungroupAxis });

/* ── Pill kebab actions (Rename / Move / Delete) ────────────────────── */

/** Kebab → Rename… — closes the menu and asks the editor to open the
 *  cascade rename dialog (expression-aware via Chunk E). */
function onKebabRename(tag: string): void {
  closeMenus();
  emit("rename-tag", tag);
}

/** Kebab → Delete… — closes the menu and asks the editor to run the
 *  cascade delete path (silent when no refs, confirm dialog when refs > 0). */
function onKebabDelete(tag: string): void {
  closeMenus();
  emit("delete-tag", tag);
}

/** Kebab → Move to group… — open the inline move submenu for this pill. */
function onKebabMove(axis: string, tag: string): void {
  moveMenuFor.value = kebabKey(axis, tag);
}

/* ── Drag-and-drop pills between group boxes (bug #2) ───────────────── */

function onPillDragStart(tag: string, e: DragEvent): void {
  draggedTag.value = tag;
  closeMenus();
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", tag);
  }
}

function onPillDragEnd(): void {
  draggedTag.value = null;
  dragOverAxis.value = null;
}

function onGroupDragOver(axis: string): void {
  if (draggedTag.value !== null) dragOverAxis.value = axis;
}

function onGroupDragLeave(axis: string): void {
  if (dragOverAxis.value === axis) dragOverAxis.value = null;
}

/** Drop a dragged pill into `axis` (OTHER_AXIS box = ungroup). Reuses the
 *  same move routine the kebab "Move to group…" submenu calls. */
function onGroupDrop(axis: string): void {
  const tag = draggedTag.value;
  draggedTag.value = null;
  dragOverAxis.value = null;
  if (tag !== null) moveTagToGroup(tag, axis);
}
</script>

<template>
  <Card title="Sub-Categories">
    <template #actions>
      <span class="wp-card__hint">Group tags into axes — used to filter the pool</span>
      <!-- A fully tagged wildcard shows every axis and every pill at once,
           which pushed the options table — the thing being edited — off
           screen. `+` expands, `×` collapses; the count keeps the section
           informative while shut. -->
      <button
        type="button"
        class="subcat-collapse"
        :class="{ 'subcat-collapse--nudge': !open }"
        :aria-expanded="open"
        :aria-label="open ? 'Collapse sub-categories' : 'Expand sub-categories'"
        :title="open ? 'Collapse sub-categories' : 'Expand sub-categories'"
        data-test="subcat-collapse"
        @click="open = !open"
      >
        <i :class="open ? 'pi pi-times' : 'pi pi-plus'" aria-hidden="true" />
      </button>
    </template>
    <div v-if="!open" class="subcat-collapsed" data-test="subcat-collapsed">
      {{ summary }}
    </div>
    <!-- Group boxes: one per tag_groups axis + a trailing ungrouped
         box. Each box owns its pills (⠿ name (count) ⋯) + an inline
         "+ tag". Adding is contextual per group — no global add bar. -->
    <div v-else class="subcat-groups" @click="closeMenus">
      <section
        v-for="group in groups"
        :key="group.axis"
        class="subcat-group"
        :class="{ 'subcat-group--drop': dragOverAxis === group.axis && draggedTag !== null }"
        :style="{ '--group-hue': axisHue(group.axis) }"
        data-test="subcat-group"
        @dragover.prevent="onGroupDragOver(group.axis)"
        @dragleave="onGroupDragLeave(group.axis)"
        @drop.prevent="onGroupDrop(group.axis)"
      >
        <header class="subcat-group__head">
          <!-- The caret is its own button rather than the whole header:
               the header also holds a rename input, and making the row
               itself the toggle would fold the group every time you
               clicked into the name to edit it. -->
          <button
            type="button"
            class="subcat-group__fold"
            :aria-expanded="!collapsedAxes.has(group.axis)"
            :aria-label="collapsedAxes.has(group.axis)
              ? `Expand ${group.isOther ? 'ungrouped' : group.axis}`
              : `Collapse ${group.isOther ? 'ungrouped' : group.axis}`"
            :data-test="`subcat-fold-${group.axis}`"
            @click.stop="toggleAxisCollapsed(group.axis)"
          ><i
            :class="collapsedAxes.has(group.axis) ? 'pi pi-chevron-right' : 'pi pi-chevron-down'"
            aria-hidden="true"
          /></button>
          <input
            v-if="!group.isOther"
            class="subcat-group__name"
            :value="group.axis"
            :aria-label="`Rename group ${group.axis}`"
            :data-test="`subcat-group-name-${group.axis}`"
            @change="(e) => onGroupNameChange(group.axis, e)"
            @keydown.enter.prevent="(e) => (e.target as HTMLInputElement).blur()"
          />
          <span v-else class="subcat-group__name subcat-group__name--other">ungrouped</span>
          <!-- What this group MEANS to the engine. classify (the default)
               is today's behaviour: tags describe the option and fold with
               AND. accepts makes them alternatives the option offers — an
               OR-set, readable as $var.NAME.

               Shaped as a capsule because that is the grammar of the pills
               it governs — it is a property of the axis, not a utility
               action like the ungroup button. Always labelled and always
               visible: every group states its kind, so the capability is
               discoverable by anyone who opens the editor rather than only
               by someone who happens to hover the right spot.
               Ungrouped tags have no kind, so that box gets no control. -->
          <button
            v-if="!group.isOther"
            type="button"
            class="subcat-group__kind"
            :class="{ 'subcat-group__kind--accepts': tagGroupKinds[group.axis] === 'accepts' }"
            :aria-pressed="tagGroupKinds[group.axis] === 'accepts'"
            :aria-label="`Group ${group.axis} is ${tagGroupKinds[group.axis] === 'accepts' ? 'an accepts axis' : 'descriptive'}`"
            :data-test="`group-kind-${group.axis}`"
            :title="tagGroupKinds[group.axis] === 'accepts'
              ? `Accepts axis — an option's tags here are alternatives it offers, and $${varBinding}.${group.axis} reads the one that was rolled. Click to make it descriptive.`
              : 'Descriptive — these tags say what an option IS, several true at once. Click to make them alternatives it accepts.'"
            @click.stop="toggleGroupKind(group.axis)"
          >{{ tagGroupKinds[group.axis] === 'accepts' ? 'accepts' : 'classify' }}</button>
          <!-- A folded axis still reports how many tags are inside, so
               folding never hides the fact that there is something there. -->
          <span
            v-if="collapsedAxes.has(group.axis)"
            class="subcat-group__count"
            :data-test="`subcat-count-${group.axis}`"
          >{{ group.tags.length }}</span>
          <button
            v-if="!group.isOther"
            type="button"
            class="subcat-group__ungroup"
            :aria-label="`Disband group ${group.axis}`"
            :data-test="`subcat-ungroup-${group.axis}`"
            title="Disband group (tags stay, lose their axis)"
            @click.stop="ungroupAxis(group.axis)"
          ><i class="pi pi-link" aria-hidden="true" /></button>
        </header>

        <div v-if="!collapsedAxes.has(group.axis)" class="subcat-group__pills">
          <span
            v-for="tag in group.tags"
            :key="tag"
            class="subcat-pill"
            :class="{ 'subcat-pill--dragging': draggedTag === tag }"
            :style="chipStyle(tag)"
            draggable="true"
            @dragstart="onPillDragStart(tag, $event)"
            @dragend="onPillDragEnd"
          >
            <span class="subcat-pill__grip" aria-hidden="true">⠿</span>
            <span class="subcat-pill__name">{{ tag }}</span>
            <span class="subcat-pill__count" :title="`${tagUsageCount(tag)} option(s) use this tag`">{{ tagUsageCount(tag) }}</span>
            <button
              type="button"
              class="subcat-pill__kebab"
              :aria-label="`Actions for ${tag}`"
              :aria-expanded="openKebab === kebabKey(group.axis, tag)"
              :data-test="`subcat-kebab-${tag}`"
              @click.stop="toggleKebab(group.axis, tag, $event)"
            >⋯</button>

            <!-- Kebab menu: Rename / Move to group… / Delete. Rename
                 + Delete route through the existing cascade dialogs. -->
            <div
              v-if="openKebab === kebabKey(group.axis, tag)"
              class="subcat-menu"
              :class="{ 'subcat-menu--up': kebabDropUp }"
              role="menu"
              @click.stop
            >
              <button
                type="button"
                class="subcat-menu__item"
                role="menuitem"
                data-test="subcat-rename"
                @click="onKebabRename(tag)"
              ><i class="pi pi-pencil" aria-hidden="true" /> Rename…</button>
              <button
                type="button"
                class="subcat-menu__item"
                role="menuitem"
                data-test="subcat-move"
                :aria-expanded="moveMenuFor === kebabKey(group.axis, tag)"
                @click="onKebabMove(group.axis, tag)"
              ><i class="pi pi-arrow-right-arrow-left" aria-hidden="true" /> Move to group…</button>
              <div
                v-if="moveMenuFor === kebabKey(group.axis, tag)"
                class="subcat-menu__sub"
                role="menu"
              >
                <button
                  v-for="dest in moveTargets(group.axis)"
                  :key="dest.axis"
                  type="button"
                  class="subcat-menu__item subcat-menu__item--sub"
                  role="menuitem"
                  :data-test="`subcat-move-to-${dest.axis}`"
                  @click="moveTagToGroup(tag, dest.axis)"
                >{{ dest.label }}</button>
              </div>
              <button
                type="button"
                class="subcat-menu__item subcat-menu__item--danger"
                role="menuitem"
                data-test="subcat-delete"
                @click="onKebabDelete(tag)"
              ><i class="pi pi-trash" aria-hidden="true" /> Delete…</button>
            </div>
          </span>

          <!-- Inline "+ tag" for this group. Collapsed to a button;
               expands to a validated input. -->
          <span v-if="addTagAxis === group.axis" class="subcat-addtag">
            <input
              v-model="addTagDraft"
              class="subcat-addtag__input"
              :class="{ 'subcat-addtag__input--invalid': addTagError }"
              :data-test="`group-addtag-input-${group.axis}`"
              placeholder="new tag"
              spellcheck="false"
              autocapitalize="off"
              autocomplete="off"
              @keydown.enter.prevent="commitAddTag(group.axis)"
              @keydown.esc.prevent="cancelAddTag"
              @blur="cancelAddTag"
            />
          </span>
          <button
            v-else
            type="button"
            class="subcat-addtag__open"
            :data-test="`group-addtag-${group.axis}`"
            @click.stop="openAddTag(group.axis)"
          ><i class="pi pi-plus" aria-hidden="true" /> tag</button>
        </div>

        <p
          v-if="addTagAxis === group.axis && addTagError"
          class="subcat-addtag__error"
          :data-test="`group-addtag-error-${group.axis}`"
        >{{ addTagError }}</p>

        <!-- Accepts-axis coverage advisory (non-blocking). An accepts axis
             only yields a value for options that carry one of its tags; an
             option with none makes $var.AXIS render empty when it's picked.
             Shown only for accepts groups with a gap, so a fully-covered
             axis stays silent. -->
        <p
          v-if="!group.isOther
            && tagGroupKinds[group.axis] === 'accepts'
            && !collapsedAxes.has(group.axis)
            && axisUncoveredCount(group.axis) > 0"
          class="subcat-group__axis-note"
          :data-test="`axis-coverage-${group.axis}`"
        >
          <i class="pi pi-info-circle" aria-hidden="true" />
          <span>{{ axisUncoveredCount(group.axis) }}
            option{{ axisUncoveredCount(group.axis) === 1 ? "" : "s" }}
            {{ axisUncoveredCount(group.axis) === 1 ? "carries" : "carry" }} no
            <b>{{ group.axis }}</b> tag — <code>${{ varBinding }}.{{ group.axis }}</code>
            is empty when {{ axisUncoveredCount(group.axis) === 1 ? "it's" : "they're" }} picked.</span>
        </p>
      </section>

      <button
        type="button"
        class="subcat-add-group"
        data-test="subcat-add-group"
        @click.stop="addGroup"
      ><i class="pi pi-plus" aria-hidden="true" /> Group</button>
    </div>
  </Card>
</template>

<style scoped>
/* ── Sub-category group boxes (H1) ───────────────────────────────── */
.subcat-groups {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-4);
}
/* Sub-Categories disclosure — `+` / `×` in the card header. */
.subcat-collapse {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-left: var(--wp-space-3);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  background: transparent;
  color: var(--wp-text-muted);
  cursor: pointer;
  font-size: 11px;
}
.subcat-collapse:hover { color: var(--wp-text); border-color: var(--wp-accent); }
/* Accented while collapsed so a first-time user reads it as "there is more
   here, press me" rather than as a dim decoration. Deliberately a static tint,
   not an animation — this sits on screen for the whole editing session. */
.subcat-collapse--nudge {
  color: var(--wp-accent-text, var(--wp-accent));
  border-color: color-mix(in oklab, var(--wp-accent) 55%, transparent);
  background: color-mix(in oklab, var(--wp-accent) 14%, transparent);
}
.subcat-collapsed {
  font-size: var(--wp-text-sm);
  color: var(--wp-text-muted);
}
.subcat-group {
  border: 1px solid var(--wp-border);
  /* Coloured left accent keyed to the axis hue so each group reads as a
   * distinct cluster at a glance (#8). Ungrouped (--group-hue = text-dim)
   * stays neutral. */
  border-left: 3px solid color-mix(in srgb, var(--group-hue, var(--wp-border)) 60%, var(--wp-border));
  border-radius: var(--wp-radius);
  background: var(--wp-bg-2);
  padding: var(--wp-space-4);
  transition: border-color 0.12s, background 0.12s;
}
/* Highlight a group box while a dragged pill hovers over it (bug #2). */
.subcat-group--drop {
  border-color: var(--wp-accent-500);
  background: color-mix(in srgb, var(--wp-accent-500) 8%, var(--wp-bg-2));
}
.subcat-group__fold {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  padding: 0;
  background: none;
  border: none;
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text-dim);
  cursor: pointer;
}
.subcat-group__fold:hover { color: var(--wp-text); background: var(--wp-bg-3); }
.subcat-group__fold .pi { font-size: 9px; }
.subcat-group__count {
  font-family: var(--wp-font-mono);
  font-size: 10px; /* audit-exempt: micro count badge */
  color: var(--wp-text-dim);
  opacity: 0.7;
}
.subcat-group__head {
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
  margin-bottom: var(--wp-space-3);
}
.subcat-group__name {
  font-size: var(--wp-text-xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: color-mix(in srgb, var(--group-hue, var(--wp-text-dim)) 80%, var(--wp-text));
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--wp-radius-sm);
  padding: 3px 6px;
  min-width: 0;
  max-width: 220px;
}
.subcat-group__name:hover,
.subcat-group__name:focus-visible {
  border-color: var(--wp-border);
  background: var(--wp-bg-1);
  color: var(--wp-text);
  outline: none;
}
/* A capsule, not an icon button: the pills this control governs are
   hue-tinted capsules, so borrowing their grammar makes it read as a property
   of the axis. The earlier icon button borrowed `__ungroup`'s flat grey
   square, which is the vocabulary of a utility ACTION, and the hover landed as
   a hard block unrelated to anything around it. */
.subcat-group__kind {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 var(--wp-space-4);
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--wp-text-dim);
  font-size: var(--wp-text-xs);
  font-weight: var(--wp-weight-semibold);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
  transition:
    color 120ms ease,
    background-color 120ms ease,
    border-color 120ms ease;
}
/* Always visible, including the default. An earlier version faded the
   classify state in on hover to keep the header quiet; that optimised for ink
   over discovery, and a control you only see by accident is one most people
   never learn exists — fatal for a capability nobody is looking for yet. The
   dim weight keeps it from competing with the axis name. */
.subcat-group__kind:hover {
  color: var(--wp-text-muted);
  border-color: var(--wp-border-strong);
}
/* Promoted: always visible, in the group's own hue and the pills' exact fill
   recipe, so the axis reads as one thing. Hover deepens the tint that is
   already there rather than introducing a second colour. */
.subcat-group__kind--accepts {
  opacity: 1;
  color: color-mix(in srgb, var(--group-hue, var(--wp-accent-400)) 78%, var(--wp-text));
  border-color: color-mix(in srgb, var(--group-hue, var(--wp-accent-400)) 55%, var(--wp-border));
  background: color-mix(in srgb, var(--group-hue, var(--wp-accent-400)) 17%, var(--wp-bg-1));
}
.subcat-group__kind--accepts:hover {
  background: color-mix(in srgb, var(--group-hue, var(--wp-accent-400)) 28%, var(--wp-bg-1));
}
@media (prefers-reduced-motion: reduce) {
  .subcat-group__kind { transition: none; }
}

.subcat-group__name--other {
  font-style: italic;
  padding-left: 0;
  cursor: default;
}
.subcat-group__ungroup {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--wp-text-dim);
  border-radius: var(--wp-radius-sm);
}
.subcat-group__ungroup:hover {
  color: var(--wp-text);
  background: var(--wp-bg-3);
}
.subcat-group__axis-note {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 9px 2px 2px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--wp-warn, #f59e0b);
}
.subcat-group__axis-note .pi { font-size: 12px; margin-top: 1px; flex-shrink: 0; }
.subcat-group__axis-note code {
  font-family: var(--wp-font-mono, monospace);
  color: color-mix(in srgb, var(--wp-warn, #f59e0b) 80%, var(--wp-text));
}
.subcat-group__axis-note b { color: var(--wp-text); font-weight: 600; }

.subcat-group__pills {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--wp-space-3);
}

/* Pill: ⠿ name (count) ⋯ — tinted by its axis hue (--chip-hue). */
.subcat-pill {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px 3px 8px;
  border: 1px solid color-mix(in srgb, var(--chip-hue) 55%, var(--wp-border));
  border-radius: 999px;
  background: color-mix(in srgb, var(--chip-hue) 17%, var(--wp-bg-1));
  font-size: var(--wp-text-sm);
  line-height: 1;
}
.subcat-pill[draggable="true"] {
  cursor: grab;
}
.subcat-pill--dragging {
  opacity: 0.45;
}
.subcat-pill__grip {
  color: var(--wp-text-dim);
  cursor: grab;
  font-size: 11px;
}
.subcat-pill__name {
  color: var(--wp-text);
  font-weight: 500;
}
.subcat-pill__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 17px;
  padding: 0 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--chip-hue) 22%, var(--wp-bg-3));
  color: var(--wp-text-muted);
  font-size: var(--wp-text-xs);
  font-variant-numeric: tabular-nums;
}
.subcat-pill__kebab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--wp-text-dim);
  border-radius: 999px;
  font-size: 14px;
  line-height: 1;
}
.subcat-pill__kebab:hover {
  color: var(--wp-text);
  background: var(--wp-bg-3);
}

/* Kebab dropdown menu. */
.subcat-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 30;
  min-width: 180px;
  display: flex;
  flex-direction: column;
  padding: var(--wp-space-2);
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  box-shadow: var(--wp-shadow-lg);
}
/* Flip the kebab menu above its trigger near the page bottom (bug #1). */
.subcat-menu--up {
  top: auto;
  bottom: calc(100% + 4px);
}
.subcat-menu__item {
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
  padding: 6px 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--wp-text);
  font-size: var(--wp-text-sm);
  text-align: left;
  border-radius: var(--wp-radius-sm);
}
.subcat-menu__item:hover {
  background: var(--wp-bg-3);
}
.subcat-menu__item .pi {
  font-size: 12px;
  color: var(--wp-text-dim);
}
.subcat-menu__item--sub {
  padding-left: var(--wp-space-5);
}
.subcat-menu__item--danger {
  color: var(--wp-danger-text, var(--wp-danger));
}
.subcat-menu__item--danger .pi {
  color: inherit;
}
.subcat-menu__sub {
  display: flex;
  flex-direction: column;
  margin: 2px 0 2px var(--wp-space-3);
  padding-left: var(--wp-space-2);
  border-left: 1px solid var(--wp-border);
}

/* Inline "+ tag" (per group) + "+ Group". */
.subcat-addtag__open,
.subcat-add-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border: 1px dashed var(--wp-border-strong);
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
  color: var(--wp-text-dim);
  font-size: var(--wp-text-sm);
}
.subcat-addtag__open:hover,
.subcat-add-group:hover {
  color: var(--wp-text);
  border-color: var(--wp-accent-500);
}
.subcat-add-group {
  margin-top: var(--wp-space-3);
  align-self: flex-start;
}
.subcat-addtag__input {
  padding: 3px 10px;
  width: 130px;
  border: 1px solid var(--wp-accent-500);
  border-radius: 999px;
  background: var(--wp-bg-1);
  color: var(--wp-text);
  font-size: var(--wp-text-sm);
  outline: none;
}
.subcat-addtag__input--invalid {
  border-color: var(--wp-danger);
}
.subcat-addtag__error {
  margin: var(--wp-space-2) 0 0;
  color: var(--wp-danger-text, var(--wp-danger));
  font-size: var(--wp-text-xs);
}
</style>
