<script setup lang="ts">
/**
 * Community → Upload wizard.
 *
 * Three-step wizard (Atom → Details → Review) with a final success state.
 * Mock-only — submit echoes back through the store and routes to detail.
 */
import { computed, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import Button from "../../components/ui/Button.vue";
import Input from "../../components/ui/Input.vue";
import Textarea from "../../components/ui/Textarea.vue";
import Select from "../../components/ui/Select.vue";
import Checkbox from "../../components/ui/Checkbox.vue";
import { useToast } from "../../composables/useToast";
import { useCommunityStore } from "../../stores/communityStore";
import { KIND_LABEL } from "../../community/format";
import type { CommunityUploadPayload } from "../../community/types";

const router = useRouter();
const store = useCommunityStore();
const toast = useToast();

const step = ref<1 | 2 | 3 | 4>(1);
const submitting = ref(false);
const newId = ref<string | null>(null);

const form = reactive<CommunityUploadPayload>({
  atom: "single",
  type: "wildcard",
  name: "",
  tagline: "",
  description: "",
  category: "subject",
  license: "MIT",
  engine_min_version: store.engineVersion,
  nsfw: false,
  tags: [],
  readme: "",
  version: "1.0.0",
});
const tagInput = ref("");

const KIND_OPTIONS = (
  ["wildcard", "fixed_values", "combine", "derivation", "constraint", "pipeline"] as const
).map((value) => ({ label: KIND_LABEL[value], value }));

const CATEGORY_OPTIONS = [
  "subject", "outfit", "scene", "lighting", "style", "camera", "weather", "misc",
].map((c) => ({ label: c, value: c }));

const LICENSE_OPTIONS = ["MIT", "GPL-3", "Apache-2", "CC0", "CC-BY", "Custom"].map((value) => ({
  label: value,
  value,
}));

function addTag() {
  const t = tagInput.value.trim().toLowerCase();
  if (t && !form.tags.includes(t)) form.tags.push(t);
  tagInput.value = "";
}

function removeTag(tag: string) {
  const idx = form.tags.indexOf(tag);
  if (idx >= 0) form.tags.splice(idx, 1);
}

const detailsValid = computed(
  () => form.name.trim() && form.tagline.trim() && form.tags.length > 0,
);

async function submit() {
  if (!detailsValid.value) return;
  if (!store.currentUser) {
    toast.push({ severity: "warn", summary: "Sign in to publish.", life: 2500 });
    return;
  }
  submitting.value = true;
  try {
    const result = await store.upload(form);
    newId.value = result.id;
    step.value = 4;
    toast.push({ severity: "success", summary: "Published", detail: result.name, life: 2500 });
  } catch {
    toast.push({ severity: "error", summary: "Publish failed", detail: "Registry unreachable.", life: 3000 });
  } finally {
    submitting.value = false;
  }
}

function viewModule() {
  if (!newId.value) return;
  router.push({ name: "community-detail", params: { id: newId.value } });
}

function back() {
  router.push({ name: "community-discover" });
}

function onTagKey(event: KeyboardEvent) {
  if (event.key === "Enter") {
    event.preventDefault();
    addTag();
  }
}
</script>

<template>
  <div class="wp-comm-page">
    <Button
      variant="ghost"
      icon="arrow-left"
      class="self-start"
      @click="back"
    >Back</Button>

    <header class="wp-comm-page__header">
      <div>
        <h1 class="wp-comm-page__title">Publish to Community</h1>
        <p class="wp-comm-page__subtitle">
          Share a module or pack with the registry. You can edit and version it later.
        </p>
      </div>
    </header>

    <div v-if="!store.currentUser" class="wp-comm-empty">
      <i class="pi pi-github wp-comm-empty__icon" aria-hidden="true" />
      <h3>Sign in to publish</h3>
      <p>We use GitHub OAuth to verify uploaders. Use the button in the topbar.</p>
    </div>

    <template v-else>
      <!-- Stepper -->
      <div class="wp-comm-stepper">
        <div
          v-for="(label, i) in ['Atom', 'Details', 'Review']"
          :key="label"
          class="wp-comm-step"
          :data-active="step === i + 1"
          :data-done="step > i + 1"
        >
          <span class="wp-comm-step__num">
            <i v-if="step > i + 1" class="pi pi-check" aria-hidden="true" />
            <span v-else>{{ i + 1 }}</span>
          </span>
          <span>{{ label }}</span>
        </div>
      </div>

      <!-- Step 1: Atom -->
      <div v-if="step === 1" class="wp-card-body">
        <h3>What are you publishing?</h3>
        <div class="wp-comm-atom-grid">
          <button
            type="button"
            class="wp-comm-atom"
            :data-active="form.atom === 'single'"
            @click="form.atom = 'single'"
          >
            <i class="pi pi-th-large" aria-hidden="true" />
            <strong>Single module</strong>
            <span>One Wildcard, Combine, Derivation, Constraint, or Fixed Values list.</span>
          </button>
          <button
            type="button"
            class="wp-comm-atom"
            :data-active="form.atom === 'bundle'"
            @click="form.atom = 'bundle'"
          >
            <i class="pi pi-box" aria-hidden="true" />
            <strong>Module pack</strong>
            <span>A bundle of related modules — like a full pipeline preset.</span>
          </button>
        </div>

        <div v-if="form.atom === 'single'" class="form-row">
          <label class="form-label">Module kind</label>
          <div class="select-narrow">
            <Select
              v-model="form.type"
              :options="KIND_OPTIONS"
              aria-label="Module kind"
            />
          </div>
        </div>

        <div class="form-actions">
          <Button variant="primary" icon-right="arrow-right" @click="step = 2">Next</Button>
        </div>
      </div>

      <!-- Step 2: Details -->
      <div v-if="step === 2" class="wp-card-body">
        <div class="form-row">
          <label class="form-label">Name *</label>
          <Input v-model="form.name" placeholder="Hair Color Pro" aria-label="Module name" />
        </div>
        <div class="form-row">
          <label class="form-label">Tagline *</label>
          <Input v-model="form.tagline" placeholder="One sentence about what this does." aria-label="Tagline" />
        </div>
        <div class="form-grid">
          <div>
            <label class="form-label">Category</label>
            <Select
              v-model="form.category"
              :options="CATEGORY_OPTIONS"
              aria-label="Category"
            />
          </div>
          <div>
            <label class="form-label">License</label>
            <Select
              v-model="form.license"
              :options="LICENSE_OPTIONS"
              aria-label="License"
            />
          </div>
          <div>
            <label class="form-label">Min engine</label>
            <Input v-model="form.engine_min_version" aria-label="Minimum engine version" />
          </div>
          <div>
            <label class="form-label">Version</label>
            <Input v-model="form.version" placeholder="1.0.0" aria-label="Version" />
          </div>
        </div>
        <div class="form-row">
          <label class="form-label">Tags *</label>
          <div class="tag-row">
            <Input
              v-model="tagInput"
              placeholder="portrait, fashion, vibrant..."
              aria-label="Tag input"
              @keydown="onTagKey"
            />
            <Button variant="outline" @click="addTag">Add</Button>
          </div>
          <div v-if="form.tags.length" class="tag-list">
            <span v-for="t in form.tags" :key="t" class="wp-comm-card__tag">
              {{ t }}
              <button
                type="button"
                class="tag-remove"
                aria-label="Remove tag"
                @click="removeTag(t)"
              ><i class="pi pi-times" aria-hidden="true" /></button>
            </span>
          </div>
        </div>
        <div class="form-row">
          <label class="form-label">README (Markdown)</label>
          <Textarea
            v-model="form.readme"
            :rows="8"
            class="mono"
            placeholder="# What's inside&#10;&#10;Describe the module..."
            aria-label="README"
          />
        </div>
        <div class="form-row">
          <label class="wp-comm-filters__toggle">
            <Checkbox v-model="form.nsfw" /> Mark as 18+ (NSFW)
          </label>
        </div>
        <div class="form-actions form-actions--split">
          <Button variant="secondary" icon="arrow-left" @click="step = 1">Back</Button>
          <Button
            variant="primary"
            icon-right="arrow-right"
            :disabled="!detailsValid"
            @click="step = 3"
          >Review</Button>
        </div>
      </div>

      <!-- Step 3: Review -->
      <div v-if="step === 3" class="wp-card-body">
        <h3>Review before publishing</h3>
        <div class="review-grid">
          <div><span>Kind</span><strong>{{ form.atom === "bundle" ? "Pack" : KIND_LABEL[form.type] }}</strong></div>
          <div><span>Name</span><strong>{{ form.name }}</strong></div>
          <div><span>Tagline</span><strong>{{ form.tagline }}</strong></div>
          <div><span>Category</span><strong>{{ form.category }}</strong></div>
          <div><span>License</span><strong>{{ form.license }}</strong></div>
          <div><span>Engine</span><strong>≥ {{ form.engine_min_version }}</strong></div>
          <div><span>Version</span><strong>{{ form.version }}</strong></div>
          <div><span>NSFW</span><strong>{{ form.nsfw ? "Yes" : "No" }}</strong></div>
          <div class="review-grid__full"><span>Tags</span><strong>{{ form.tags.join(", ") }}</strong></div>
        </div>
        <p style="color: var(--wp-text-muted); font-size: 12px;">
          By publishing, you agree to the registry's content guidelines. You can edit metadata or unpublish at any time from your profile.
        </p>
        <div class="form-actions form-actions--split">
          <Button variant="secondary" icon="arrow-left" @click="step = 2">Back</Button>
          <Button
            variant="primary"
            icon="upload"
            :loading="submitting"
            @click="submit"
          >Publish</Button>
        </div>
      </div>

      <!-- Step 4: Success -->
      <div v-if="step === 4" class="wp-comm-empty">
        <i class="pi pi-check-circle wp-comm-empty__icon" style="color: var(--wp-success);" aria-hidden="true" />
        <h3>Published!</h3>
        <p>Your module is live with id <code>{{ newId }}</code>.</p>
        <div class="form-actions" style="justify-content: center;">
          <Button variant="primary" icon-right="arrow-right" @click="viewModule">View on Community</Button>
          <Button variant="outline" @click="back">Back to Discover</Button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
@import "../../community/community.css";

.self-start { align-self: flex-start; }

.wp-card-body {
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.form-row { display: flex; flex-direction: column; gap: 6px; }
.form-label {
  font-size: 12px;
  color: var(--wp-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
}
.form-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.form-actions--split { justify-content: space-between; }
.tag-row { display: flex; gap: 6px; }
.tag-list { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.tag-remove {
  background: none;
  border: none;
  margin-left: 4px;
  padding: 0;
  cursor: pointer;
  color: inherit;
}
.review-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.review-grid > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--wp-bg-2);
  border-radius: var(--wp-radius-sm);
  padding: 8px 10px;
  font-size: 12px;
  color: var(--wp-text-muted);
}
.review-grid > div strong { color: var(--wp-text); font-size: 13px; }
.review-grid__full { grid-column: 1 / -1; }
.select-narrow { max-width: 240px; }
.mono :deep(.wp-textarea) { font-family: var(--wp-font-mono); font-size: 12px; }
</style>
