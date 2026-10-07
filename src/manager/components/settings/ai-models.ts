/**
 * Local models we point people to in Settings › AI assistant.
 *
 * All are "abliterated" builds (the refusal behaviour removed, the rest of the
 * model unchanged) published by huihui_ai on Ollama, so they write NSFW wildcard
 * content instead of refusing it. Every one lists tool calling. The GPU column is a
 * rough guide for the usual 4-bit download.
 *
 * Revisit when the assistant's eval set runs: a model stays here only if it
 * passes it.
 */
export interface SuggestedModel {
  name: string;
  vram: string;
  goodFor: string;
}

export const SUGGESTED_LOCAL_MODELS: SuggestedModel[] = [
  { name: "huihui_ai/qwen3.5-abliterated:9b", vram: "8 GB", goodFor: "Drafting and tidying lists" },
  { name: "huihui_ai/gemma-4-abliterated:12b", vram: "12 GB", goodFor: "Drafting, organizing" },
  { name: "huihui_ai/gemma-4-abliterated:26b", vram: "16 GB", goodFor: "Rules and small packs (fast, mixture of experts)" },
  { name: "huihui_ai/qwen3.6-abliterated:27b", vram: "24 GB", goodFor: "Whole packs and the chat assistant" },
  { name: "huihui_ai/gemma-4-abliterated:31b", vram: "24 GB", goodFor: "Whole packs and the chat assistant" },
];
