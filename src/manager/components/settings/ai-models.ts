/**
 * Local models we point people to in Settings › AI assistant, in two groups.
 *
 * - `writing`: fine-tunes trained on creative writing, NSFW included (TheDrummer's
 *   Rocinante, Cydonia, Artemis). Not refusing isn't enough: a model also has
 *   to know the vocabulary, and these were trained on it. Use them for drafting
 *   options.
 * - `building`: "abliterated" builds by huihui_ai (refusals removed, the rest of
 *   the model unchanged). They won't refuse but write explicit content more
 *   blandly; their strength is following instructions, JSON and tool calls, which
 *   the organize, chat and pack-builder steps lean on.
 *
 * Models without an official Ollama page are pulled straight from Hugging Face
 * (`ollama pull hf.co/<repo>:<quant>`). The GPU column is a rough guide for the
 * 4-bit (Q4_K_M) download.
 *
 * Revisit when the assistant's eval set runs: a model stays here only if it
 * passes it.
 */
export interface SuggestedModel {
  /** What `ollama pull` takes. */
  name: string;
  vram: string;
  goodFor: string;
  use: "writing" | "building";
  /** The model's Ollama page, when there is one. */
  ollamaUrl?: string;
  /** The model's Hugging Face repo (the weights LM Studio and llama.cpp users start from). */
  hfUrl: string;
}

const HUIHUI_OLLAMA = "https://ollama.com/huihui_ai/";
const HUIHUI_HF = "https://huggingface.co/huihui-ai/";
const DRUMMER_HF = "https://huggingface.co/TheDrummer/";

export const SUGGESTED_LOCAL_MODELS: SuggestedModel[] = [
  { name: "hf.co/TheDrummer/Rocinante-X-12B-v1-GGUF:Q4_K_M", vram: "10 GB", use: "writing",
    goodFor: "Explicit option lists on a mid-range GPU (Mistral Nemo 12B)",
    hfUrl: `${DRUMMER_HF}Rocinante-X-12B-v1-GGUF` },
  { name: "HammerAI/cydonia-v4.3:24b-q4_K_M", vram: "16 GB", use: "writing",
    goodFor: "Richer explicit writing that still follows instructions well (Mistral Small 24B)",
    ollamaUrl: "https://ollama.com/HammerAI/cydonia-v4.3", hfUrl: `${DRUMMER_HF}Cydonia-24B-v4.3` },
  { name: "hf.co/TheDrummer/Artemis-31B-v1.1-GGUF:Q4_K_M", vram: "24 GB", use: "writing",
    goodFor: "The strongest writer here (Gemma 4 31B)",
    hfUrl: `${DRUMMER_HF}Artemis-31B-v1.1-GGUF` },
  { name: "huihui_ai/qwen3.5-abliterated:9b", vram: "8 GB", use: "building",
    goodFor: "Tidying and tagging lists on a small GPU",
    ollamaUrl: `${HUIHUI_OLLAMA}qwen3.5-abliterated`, hfUrl: `${HUIHUI_HF}Huihui-Qwen3.5-9B-abliterated` },
  { name: "huihui_ai/gemma-4-abliterated:26b", vram: "20 GB", use: "building",
    goodFor: "Rules and small packs (fast, mixture of experts)",
    ollamaUrl: `${HUIHUI_OLLAMA}gemma-4-abliterated`, hfUrl: `${HUIHUI_HF}Huihui-gemma-4-26B-A4B-it-abliterated` },
  { name: "huihui_ai/qwen3.6-abliterated:27b", vram: "24 GB", use: "building",
    goodFor: "Whole packs and the chat assistant",
    ollamaUrl: `${HUIHUI_OLLAMA}qwen3.6-abliterated`, hfUrl: `${HUIHUI_HF}Huihui-Qwen3.6-27B-abliterated` },
];

export const SUGGESTED_MODEL_GROUPS: { use: SuggestedModel["use"]; title: string; note: string }[] = [
  { use: "writing", title: "Best for writing",
    note: "Fine-tuned on creative writing, NSFW included, so they know the words and use them. Pick one of these for Draft with AI." },
  { use: "building", title: "Best for organizing and building packs",
    note: "Uncensored (they won't refuse) and strong at following instructions and returning structured answers, but they write explicit content more blandly." },
];
