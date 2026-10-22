import type { AiThinking } from "../api/types";

/** The Thinking choices, for Settings › AI and the chat header. */
export const THINKING_OPTIONS: Array<{ value: AiThinking; label: string; short: string }> = [
  { value: "auto", label: "As the model does", short: "Auto" },
  { value: "off", label: "Off: answer straight away", short: "Off" },
  { value: "low", label: "Low: think a little", short: "Low" },
  { value: "medium", label: "Medium", short: "Medium" },
  { value: "high", label: "High: think the most", short: "High" },
];

export function isThinking(v: unknown): v is AiThinking {
  return THINKING_OPTIONS.some((o) => o.value === v);
}
