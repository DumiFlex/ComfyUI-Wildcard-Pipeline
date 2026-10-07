/**
 * Local models we point people to in Settings › AI assistant.
 *
 * All are "abliterated" builds (the refusal behaviour removed, the rest of the
 * model unchanged) published by huihui_ai on Ollama (huihui-ai on Hugging Face), so
 * they write NSFW wildcard content instead of refusing it. Every one lists tool
 * calling. The GPU column is a rough guide for the usual 4-bit download.
 *
 * Revisit when the assistant's eval set runs: a model stays here only if it
 * passes it.
 */
export interface SuggestedModel {
  name: string;
  vram: string;
  goodFor: string;
  /** The model's Ollama page. */
  ollamaUrl: string;
  /** The model's Hugging Face repo (the weights LM Studio and llama.cpp users start from). */
  hfUrl: string;
}

const OLLAMA = "https://ollama.com/huihui_ai/";
const HF = "https://huggingface.co/huihui-ai/";

export const SUGGESTED_LOCAL_MODELS: SuggestedModel[] = [
  { name: "huihui_ai/qwen3.5-abliterated:9b", vram: "8 GB", goodFor: "Drafting and tidying lists",
    ollamaUrl: `${OLLAMA}qwen3.5-abliterated`, hfUrl: `${HF}Huihui-Qwen3.5-9B-abliterated` },
  { name: "huihui_ai/gemma-4-abliterated:12b", vram: "12 GB", goodFor: "Drafting, organizing",
    ollamaUrl: `${OLLAMA}gemma-4-abliterated`, hfUrl: `${HF}Huihui-gemma-4-12B-it-abliterated` },
  { name: "huihui_ai/gemma-4-abliterated:26b", vram: "20 GB", goodFor: "Rules and small packs (fast, mixture of experts)",
    ollamaUrl: `${OLLAMA}gemma-4-abliterated`, hfUrl: `${HF}Huihui-gemma-4-26B-A4B-it-abliterated` },
  { name: "huihui_ai/qwen3.6-abliterated:27b", vram: "24 GB", goodFor: "Whole packs and the chat assistant",
    ollamaUrl: `${OLLAMA}qwen3.6-abliterated`, hfUrl: `${HF}Huihui-Qwen3.6-27B-abliterated` },
  { name: "huihui_ai/gemma-4-abliterated:31b", vram: "24 GB", goodFor: "Whole packs and the chat assistant",
    ollamaUrl: `${OLLAMA}gemma-4-abliterated`, hfUrl: `${HF}Huihui-gemma-4-31B-it-abliterated` },
];
