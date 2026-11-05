/**
 * Models we point people to in Settings › AI assistant, one list per kind of
 * provider: local servers (Ollama, LM Studio, llama.cpp, any other local
 * OpenAI-compatible server), Claude, OpenAI and OpenRouter. Settings shows only
 * the list for the provider that is selected.
 *
 * Local models are named by model only. Which build to download (uploader,
 * quant, uncensored or not) is the user's choice, so there are no repos or
 * links. The GPU column is a rough guide for a 3 to 4-bit file with a 16k
 * context. They fall in two groups:
 * - `building`: the models we tested with Wildcard Pipeline (`tested: true`).
 * - `writing`: untested fine-tunes for drafting options; `goodFor` says why
 *   each was suggested. No tool calls, so drafting only.
 *
 * The writing and cloud picks come from benchmarks (Artificial Analysis tau2,
 * UGI) and community reports, gathered 2026-10-14 in
 * `/pr-drafts/ai-model-research-2026-10.md`.
 */
export type SuggestUse = "writing" | "building";

export interface SuggestedModel {
  /** Cloud models: what goes in the Model field. Local models: the base model's name. */
  name: string;
  goodFor: string;
  use: SuggestUse;
  /** Local models: rough GPU memory needed. */
  vram?: string;
  /** Cloud models: USD per million tokens, input / output. */
  price?: string;
  /** The model's page on the provider (OpenRouter), where its current price is. */
  pageUrl?: string;
  /** Tried with Wildcard Pipeline, not only read about. */
  tested?: true;
}

/** A local model: always has a GPU size. */
export interface SuggestedLocalModel extends SuggestedModel {
  vram: string;
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

export const SUGGESTED_LOCAL_MODELS: SuggestedLocalModel[] = [
  { name: "Qwen3.6 35B A3B", vram: "16 GB", use: "building", tested: true,
    goodFor: "The one we use most, for chat, packs and writing. Mixture of experts, so it stays fast with part of it in system RAM: about 50 tok/s on a 16 GB card with 32 GB RAM" },
  { name: "Qwen3.8 27B", vram: "16-24 GB", use: "building", tested: true,
    goodFor: "The best at following instructions. A 3-bit file fits a 16 GB card, 24 GB is comfortable. Slower than the 35B A3B" },
  { name: "Qwen3.5 9B", vram: "8 GB", use: "building", tested: true,
    goodFor: "Fits 8 to 12 GB, or beside ComfyUI. Fine for single items, tags and negatives; it misses parts of bigger asks with several items" },
  { name: "Cydonia 24B", vram: "16 GB", use: "writing",
    goodFor: "Suggested because community reports rate it highly for explicit creative writing that still follows instructions (a Mistral Small 24B fine-tune)" },
  { name: "Gemma 4 31B", vram: "24 GB", use: "writing",
    goodFor: "Suggested because the UGI benchmark puts its uncensored builds first for world knowledge among writers" },
];

/** The local groups, in the order Settings and the docs show them. */
export const SUGGESTED_MODEL_GROUPS: { use: SuggestUse; title: string; note: string }[] = [
  { use: "building", title: "For the chat and packs",
    note: "Tested with Wildcard Pipeline. Any of these can be your only model." },
  { use: "writing", title: "For writing options",
    note: "Not tested here. They can't call tools, so keep them for drafting." },
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
  local: "Models you run yourself. Any build of them works: you pick the uploader, the quant and whether it is uncensored (heretic, abliterated).",
  anthropic: "Prices are USD per million tokens, input / output.",
  openai: "Prices are USD per million tokens, input / output.",
  openrouter: "OpenRouter reaches many more models. Most need credits; free :free models are rate-limited. anthropic/* and openai/* models are moderated there. Prices change often, so check them on each model's page.",
};

/** The card header note, the same for every provider. */
export const SUGGESTIONS_SOURCE_NOTE =
  "Only the ones marked Tested were tried with Wildcard Pipeline. The rest come from benchmarks and community reports (October 2026).";

/**
 * What Settings suggests for a provider. Local servers share one list; a
 * cloud provider without its own list gets nothing (the card hides).
 */
export function suggestionsFor(provider: string, local: boolean): Suggestions | null {
  if (provider === "anthropic" || provider === "openai" || provider === "openrouter") {
    return { key: provider, intro: INTROS[provider], groups: SUGGESTED_MODELS[provider] };
  }
  if (!local) return null;
  return { key: "local", intro: INTROS.local, groups: SUGGESTED_MODELS.local };
}
