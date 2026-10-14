/**
 * Models we point people to in Settings › AI assistant, one list per kind of
 * provider: local servers (Ollama, LM Studio, llama.cpp, any other local
 * OpenAI-compatible server), Claude, OpenAI and OpenRouter. Settings shows only
 * the list for the provider that is selected.
 *
 * Most picks come from benchmarks (Artificial Analysis tau2, UGI) and community
 * reports (r/LocalLLaMA, r/SillyTavernAI), gathered 2026-10-14 in
 * `/pr-drafts/ai-model-research-2026-10.md`. Only entries with `tested: true`
 * were tried with Wildcard Pipeline; the card says so in its header.
 *
 * Local models fall in two groups:
 * - `building`: instruct models with refusals removed ("heretic" builds keep
 *   the most of the original). They follow instructions, JSON and tool calls,
 *   which the organize, chat and pack-builder steps lean on.
 * - `writing`: fine-tunes trained on creative writing, NSFW included. No tool
 *   calls, so they are for drafting options only.
 *
 * Models without an official Ollama page are pulled straight from Hugging Face
 * (`ollama pull hf.co/<repo>:<quant>`). The GPU column is a rough guide for a
 * 4-bit download with a 16k context.
 */
export type SuggestUse = "writing" | "building";

export interface SuggestedModel {
  /** What goes in the Model field (for Ollama, what `ollama pull` takes). */
  name: string;
  goodFor: string;
  use: SuggestUse;
  /** Local models: rough GPU memory needed. */
  vram?: string;
  /** Cloud models: USD per million tokens, input / output. */
  price?: string;
  /** The model's Ollama page, when there is one. */
  ollamaUrl?: string;
  /** The model's page on the provider (OpenRouter), where its current price is. */
  pageUrl?: string;
  /** The model's Hugging Face repo (the weights LM Studio and llama.cpp users start from). */
  hfUrl?: string;
  /** Tried with Wildcard Pipeline, not only read about. */
  tested?: true;
}

/** A local model: always has a GPU size and a Hugging Face repo. */
export interface SuggestedLocalModel extends SuggestedModel {
  vram: string;
  hfUrl: string;
}

export type SuggestGroupKey = "local" | "anthropic" | "openai" | "openrouter";

export interface SuggestionGroup {
  title: string;
  note: string;
  models: SuggestedModel[];
}

export interface Suggestions {
  key: SuggestGroupKey;
  /** One or two plain sentences under the card title. */
  intro: string;
  groups: SuggestionGroup[];
}

const HF = "https://huggingface.co/";

export const SUGGESTED_LOCAL_MODELS: SuggestedLocalModel[] = [
  { name: "hf.co/SC117/Qwen3.6-35B-A3B-uncensored-heretic-Native-MTP-Preserved-APEX-GGUF:APEX-I-Mini",
    vram: "16 GB", use: "building", tested: true,
    goodFor: "One model for chat, packs and writing. Fast mixture of experts: about 50 tok/s on a 16 GB RTX 5060 Ti with 32 GB RAM. Files: APEX-I-Mini (14.27 GB) or APEX-I-Compact (17.02 GB); in Ollama the tag after the colon must match the file",
    hfUrl: `${HF}SC117/Qwen3.6-35B-A3B-uncensored-heretic-Native-MTP-Preserved-APEX-GGUF` },
  { name: "hf.co/filvyb/Qwen3.5-9B-heretic-v2-GGUF:Q4_K_M", vram: "8 GB", use: "building",
    goodFor: "One uncensored model on 8 to 12 GB, or beside ComfyUI",
    hfUrl: `${HF}filvyb/Qwen3.5-9B-heretic-v2-GGUF` },
  { name: "hf.co/0bserverx/Qwen3.8-27B-Heretic-Abliterated-Uncensored-GGUF", vram: "16-24 GB", use: "building",
    goodFor: "The smartest instruction follower. IQ3_M (12.58 GB) fits 16 GB, Q4_K_M (16.55 GB) is for 24 GB. On a 16 GB card it sits on the edge; the 35B-A3B is steadier",
    hfUrl: `${HF}0bserverx/Qwen3.8-27B-Heretic-Abliterated-Uncensored-GGUF` },
  { name: "HammerAI/cydonia-v4.3:24b-q4_K_M", vram: "16 GB", use: "writing",
    goodFor: "Explicit writing that follows instructions (Mistral Small 24B). No tools, so drafting only",
    ollamaUrl: "https://ollama.com/HammerAI/cydonia-v4.3", hfUrl: `${HF}TheDrummer/Cydonia-24B-v4.3` },
  { name: "HammerAI/gemma-4-31b-heretic", vram: "24 GB", use: "writing",
    goodFor: "The most knowledgeable uncensored writer (Gemma 4 31B)",
    ollamaUrl: "https://ollama.com/HammerAI/gemma-4-31b-heretic",
    hfUrl: `${HF}llmfan46/gemma-4-31B-it-uncensored-heretic-GGUF` },
];

/** The local groups, in the order Settings and the docs show them. */
export const SUGGESTED_MODEL_GROUPS: { use: SuggestUse; title: string; note: string }[] = [
  { use: "building", title: "For the chat and packs",
    note: "Uncensored and good at following instructions and tool calls. Any of these can be your only model." },
  { use: "writing", title: "For writing options",
    note: "Fine-tuned on explicit creative writing. They can't call tools, so keep them for drafting." },
];

const noExplicit = (who: string): string =>
  `${who}'s usage policy doesn't allow sexually explicit writing, so use it for organizing, rules and SFW packs. For explicit options, use a local model or an unmoderated OpenRouter model.`;

export const SUGGESTED_MODELS: Record<SuggestGroupKey, SuggestionGroup[]> = {
  local: SUGGESTED_MODEL_GROUPS.map((g) => ({
    title: g.title, note: g.note, models: SUGGESTED_LOCAL_MODELS.filter((m) => m.use === g.use),
  })),
  anthropic: [{
    title: "Claude models", note: noExplicit("Claude"),
    models: [
      { name: "claude-sonnet-5-5", price: "$2 / $10", use: "building", goodFor: "The default: chat, packs and rules" },
      { name: "claude-haiku-5-5", price: "$0.10 / $0.50", use: "building", goodFor: "The cheapest: organizing, tagging and bulk work" },
      { name: "claude-opus-5-5", price: "$4 / $20", use: "building", goodFor: "Premium; only worth it for very large packs" },
    ],
  }],
  openai: [{
    title: "OpenAI models", note: noExplicit("OpenAI"),
    models: [
      { name: "gpt-6-luna", price: "$0.10 / $0.50", use: "building",
        goodFor: "Plenty for this work. GPT-6.1 Sol costs more and isn't needed here" },
    ],
  }],
  openrouter: [{
    title: "Unmoderated picks",
    note: "These support tools and structured output. Roleplay fine-tunes on OpenRouter (Cydonia and others) have no tool support, so they only work for drafting.",
    models: [
      { name: "qwen/qwen3.6-35b-a3b", pageUrl: "https://openrouter.ai/qwen/qwen3.6-35b-a3b", use: "building", goodFor: "Strong all-rounder that also sees images" },
      { name: "z-ai/glm-5.3-flash", pageUrl: "https://openrouter.ai/z-ai/glm-5.3-flash", use: "building", goodFor: "Very cheap input, long context" },
      { name: "deepseek/deepseek-v3.2", pageUrl: "https://openrouter.ai/deepseek/deepseek-v3.2", use: "building", goodFor: "Reasoning is off by default, so answers come quickly" },
      { name: "deepseek/deepseek-v4-flash", pageUrl: "https://openrouter.ai/deepseek/deepseek-v4-flash", use: "building", goodFor: "The cheapest output; it can't turn thinking off" },
    ],
  }],
};

const INTROS: Record<SuggestGroupKey, string> = {
  local: "Uncensored models you run yourself. Download one from Hugging Face.",
  anthropic: "Prices are USD per million tokens, input / output.",
  openai: "Prices are USD per million tokens, input / output.",
  openrouter: "OpenRouter reaches many more models. Most need credits; free :free models are rate-limited. anthropic/* and openai/* models are moderated there. Prices change often, so check them on each model's page.",
};

const LOCAL_INTROS: Partial<Record<string, string>> = {
  ollama: "Uncensored models you run yourself. Pull one with ollama pull and the name shown.",
  lmstudio: "Uncensored models you run yourself. Search the Hugging Face repo in LM Studio, or download a GGUF file from the link.",
  llamacpp: "Uncensored models you run yourself. Download a GGUF file from the Hugging Face link and start llama-server with it.",
};

/** The card header note, the same for every provider. */
export const SUGGESTIONS_SOURCE_NOTE =
  "Picked from benchmarks and community reports (October 2026). Only the ones marked Tested were tried with Wildcard Pipeline.";

/**
 * What Settings suggests for a provider. Local servers share one list; a
 * cloud provider without its own list gets nothing (the card hides).
 */
export function suggestionsFor(provider: string, local: boolean): Suggestions | null {
  if (provider === "anthropic" || provider === "openai" || provider === "openrouter") {
    return { key: provider, intro: INTROS[provider], groups: SUGGESTED_MODELS[provider] };
  }
  if (!local) return null;
  return { key: "local", intro: LOCAL_INTROS[provider] ?? INTROS.local, groups: SUGGESTED_MODELS.local };
}

/** The Hugging Face repo id (`owner/name`) of a model, for LM Studio and llama.cpp users. */
export function hfRepo(m: SuggestedModel): string {
  return m.hfUrl ? m.hfUrl.replace(HF, "") : m.name;
}
