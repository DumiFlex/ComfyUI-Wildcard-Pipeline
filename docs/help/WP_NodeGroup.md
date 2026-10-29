# WP Node Group

Gathers nodes so one WP Toggles switch mutes or bypasses them all. Frontend only: it never runs and is left out of the prompt.

## Inputs and outputs

| Name | Type | Notes |
|---|---|---|
| node dots | any | Wire any node's output in. There is always one free dot at the end; each wired one shows its node's title. |
| `nodes` (out) | `WP_NODES` | Wire into a WP Toggles control dot. Groups can go into groups. |

## Controls

- **Run / Mute / Bypass**: set every node in the group at once.
- **Mode chip** on each row: click to go Runs → Muted → Bypassed.
- Muting or bypassing the group node itself does the same to its nodes; setting it back lets them run.
