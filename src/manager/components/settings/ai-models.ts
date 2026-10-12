/**
 * Local models we point people to in Settings › AI assistant, in two groups.
 *
 * - `writing`: fine-tunes trained on creative writing, NSFW included (TheDrummer's
 *   Rocinante, Cydonia, Artemis). Not refusing isn't enough: a model also has
 *   to know the vocabulary, and these were trained on it. Use them for drafting
 *   options. Rocinante (Mistral Nemo) drifts on long prompts, so keep it to
 *   drafting, not the chat or the pack builder.
 * - `building`: instruct models with refusals removed, "heretic" builds first
 *   (they keep the most of the original model) and huihui_ai "abliterated"
 *   builds where no heretic one fits. Their strength is following
 *   instructions, JSON and tool calls, which the organize, chat and
 *   pack-builder steps lean on. At 24 GB, Qwen3.6 27B heretic is enough on its
 *   own; below 16 GB, Gemma 4 12B heretic is the best single model.
 *
 * Models without an official Ollama page are pulled straight from Hugging Face
 * (`ollama pull hf.co/<repo>:<quant>`). The GPU column is a rough guide for the
 * 4-bit (Q4_K_M) download with a 16k context. Researched 2026-10-12; none of
 * them is proven on Danbooru tags.
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
    goodFor: "Explicit option lists on a mid-range GPU (Mistral Nemo 12B); drafting only",
    hfUrl: `${DRUMMER_HF}Rocinante-X-12B-v1-GGUF` },
  { name: "HammerAI/cydonia-v4.3:24b-q4_K_M", vram: "16 GB", use: "writing",
    goodFor: "Richer explicit writing that still follows instructions well (Mistral Small 24B)",
    ollamaUrl: "https://ollama.com/HammerAI/cydonia-v4.3", hfUrl: `${DRUMMER_HF}Cydonia-24B-v4.3` },
  { name: "hf.co/bartowski/TheDrummer_Artemis-31B-v1.2-GGUF:Q4_K_M", vram: "24 GB", use: "writing",
    goodFor: "The strongest writer here, and tool calls still work (Gemma 4 31B)",
    hfUrl: `${DRUMMER_HF}Artemis-31B-v1.2` },
  { name: "huihui_ai/qwen3.5-abliterated:9b", vram: "8 GB", use: "building",
    goodFor: "Tidying and tagging lists on a small GPU",
    ollamaUrl: `${HUIHUI_OLLAMA}qwen3.5-abliterated`, hfUrl: `${HUIHUI_HF}Huihui-Qwen3.5-9B-abliterated` },
  { name: "hf.co/igorls/gemma-4-12B-it-heretic-GGUF:Q4_K_M", vram: "10 GB", use: "building",
    goodFor: "The best single model under 16 GB: writes well and builds packs",
    hfUrl: "https://huggingface.co/igorls/gemma-4-12B-it-heretic-GGUF" },
  { name: "huihui_ai/gemma-4-abliterated:26b", vram: "18 GB", use: "building",
    goodFor: "Rules and small packs (fast, mixture of experts)",
    ollamaUrl: `${HUIHUI_OLLAMA}gemma-4-abliterated`, hfUrl: `${HUIHUI_HF}Huihui-gemma-4-26B-A4B-it-abliterated` },
  { name: "HammerAI/gemma-4-31b-heretic", vram: "24 GB", use: "building",
    goodFor: "One model for everything, leaning to writing (Gemma 4 31B)",
    ollamaUrl: "https://ollama.com/HammerAI/gemma-4-31b-heretic",
    hfUrl: "https://huggingface.co/llmfan46/gemma-4-31B-it-uncensored-heretic-GGUF" },
  { name: "hf.co/llmfan46/Qwen3.6-27B-uncensored-heretic-v2-Native-MTP-Preserved-GGUF:Q4_K_M",
    vram: "24 GB", use: "building",
    goodFor: "One model for everything: whole packs and the chat (Qwen3.6 27B)",
    hfUrl: "https://huggingface.co/llmfan46/Qwen3.6-27B-uncensored-heretic-v2-Native-MTP-Preserved-GGUF" },
];

export const SUGGESTED_MODEL_GROUPS: { use: SuggestedModel["use"]; title: string; note: string }[] = [
  { use: "writing", title: "Best for writing",
    note: "Fine-tuned on creative writing, NSFW included, so they know the words and use them. Pick one of these for drafting and rewriting options." },
  { use: "building", title: "Best for organizing and building packs",
    note: "Uncensored (they won't refuse) and strong at following instructions and returning structured answers. The 24 GB ones also write well enough to be your only model." },
];
