# WP Mode Relay

Watches the nodes wired into it and, when what they do changes, mutes, bypasses or runs the nodes of the WP Node Group its output goes into. Frontend only: it never runs and is left out of the prompt.

## Inputs and outputs

| Name | Type | Notes |
|---|---|---|
| watch dots | any | The nodes to watch. There is always one free dot at the end. |
| `drives` (out) | `WP_NODES` | Wire into a WP Node Group. |

## What it sends

The watched nodes count as **all muted**, **all bypassed** or **any runs** (a mix of muted and bypassed sends nothing). Each case maps to **Run**, **Mute**, **Bypass** or nothing. It acts at once when the watched nodes change and when you change one of these choices, never when a workflow loads.
