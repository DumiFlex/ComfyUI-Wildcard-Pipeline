import type { AiThinking, AiThinkingInfo } from "../api/types";

/** The Thinking choices, for Settings › AI and the chat header. Each model
 * takes only some of them (`AiThinkingInfo.shown`). */
export const THINKING_OPTIONS: Array<{ value: AiThinking; label: string; short: string }> = [
  { value: "auto", label: "As the model does", short: "Auto" },
  { value: "off", label: "Off: answer straight away", short: "Off" },
  { value: "on", label: "On", short: "On" },
  { value: "low", label: "Low: think a little", short: "Low" },
  { value: "medium", label: "Medium", short: "Medium" },
  { value: "high", label: "High", short: "High" },
  { value: "xhigh", label: "Extra high", short: "Extra high" },
  { value: "max", label: "Max: think the most", short: "Max" },
];

/** Without word from the server: the five every provider understands. */
const DEFAULT_SHOWN: AiThinking[] = ["auto", "off", "low", "medium", "high"];

export function isThinking(v: unknown): v is AiThinking {
  return THINKING_OPTIONS.some((o) => o.value === v);
}

function labelOf(v: string, short: boolean): string {
  const o = THINKING_OPTIONS.find((x) => x.value === v);
  return o ? (short ? o.short : o.label) : v;
}

/** The choices to offer for this model. The saved setting stays listed when
 * the model doesn't take it (another model's choice), saying what it sends. */
export function thinkingChoices(
  info: AiThinkingInfo | null, current: AiThinking, short = false,
): Array<{ value: AiThinking; label: string }> {
  const shown = info?.shown?.length ? info.shown : DEFAULT_SHOWN;
  const list = THINKING_OPTIONS.filter((o) => shown.includes(o.value))
    .map((o) => ({ value: o.value, label: short ? o.short : o.label }));
  if (!shown.includes(current)) {
    list.push({ value: current, label: `${labelOf(current, short)} (${sendsLabel(info, current)})` });
  }
  return list;
}

/** What a choice turns into for this model, in words. */
export function sendsLabel(info: AiThinkingInfo | null, choice: AiThinking): string {
  const sent = info?.sends?.[choice];
  if (!sent || sent === choice) return "as picked";
  if (sent === "auto") return "model's default";
  return `means ${labelOf(sent, true)}`;
}
