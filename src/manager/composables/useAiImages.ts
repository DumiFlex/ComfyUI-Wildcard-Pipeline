/**
 * useAiImages — reference images for an AI request outside the chat (the
 * pack builder's plan step, the Draft with AI panels).
 *
 * Same handling as the chat's attachments: each image is shrunk and
 * re-encoded in the browser (`utils/chat-image.ts`), at most `MAX_IMAGES`,
 * and nothing is attached when the server says the chosen model can't see
 * images (`GET /wp/api/ai/vision`). Each caller gets its own list.
 */
import { computed, ref } from "vue";
import { api } from "../api/client";
import { MAX_IMAGES, prepareImage, type ChatImage } from "../utils/chat-image";

/** What the server said about the chosen model, shared by every list. */
const vision = ref<boolean | null>(null);
const visionModel = ref("");
let checked: Promise<void> | null = null;

/** Ask the server once whether the chosen model sees images. `force`
 *  asks again (after the model changed). */
export function checkVision(force = false): Promise<void> {
  if (!checked || force) {
    checked = Promise.resolve().then(() => api.ai.vision()).then(
      (got) => { vision.value = got.vision; visionModel.value = got.model; },
      () => { vision.value = null; },
    );
  }
  return checked;
}

export function useAiImages(max = MAX_IMAGES) {
  const images = ref<ChatImage[]>([]);
  const error = ref("");
  const busy = ref(false);
  /** The model can't see images: hide or disable the image controls. */
  const blind = computed(() => vision.value === false);
  const full = computed(() => images.value.length >= max);

  /** Shrink and add image files (dropped, pasted or picked). Sets `error`
   *  to what went wrong, or "". */
  async function add(files: Iterable<File>): Promise<void> {
    error.value = "";
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    if (!list.length) {
      error.value = "Only images can be added";
      return;
    }
    if (blind.value) {
      error.value = `${visionModel.value || "This model"} can't see images. Pick a vision model `
        + "(Gemma 3, Qwen2.5-VL, Llama 3.2 Vision, …) in Settings › AI assistant.";
      return;
    }
    const room = max - images.value.length;
    if (room <= 0) {
      error.value = `At most ${max} images`;
      return;
    }
    busy.value = true;
    const problems: string[] = [];
    const added: ChatImage[] = [];
    try {
      for (const f of list.slice(0, room)) {
        try {
          added.push(await prepareImage(f, f.name || "image"));
        } catch (err) {
          problems.push(err instanceof Error ? err.message : String(err));
        }
      }
    } finally {
      busy.value = false;
    }
    images.value = [...images.value, ...added];
    if (list.length > room) problems.push(`At most ${max} images`);
    error.value = problems.join(". ");
  }

  function remove(i: number): void {
    images.value = images.value.filter((_, j) => j !== i);
    error.value = "";
  }

  function clear(): void {
    images.value = [];
    error.value = "";
  }

  /** The data URLs to send, or undefined when there are none. */
  function urls(): string[] | undefined {
    return images.value.length ? images.value.map((i) => i.url) : undefined;
  }

  return { images, error, busy, blind, full, vision, visionModel, add, remove, clear, urls, max };
}

export type AiImages = ReturnType<typeof useAiImages>;

/** Test seam. */
export function _resetAiImagesForTests(): void {
  vision.value = null;
  visionModel.value = "";
  checked = null;
}
