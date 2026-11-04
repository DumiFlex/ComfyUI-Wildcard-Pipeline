# WP Node Group

Gathers nodes so one WP Toggles switch mutes or bypasses them all. Frontend only: it never runs and is left out of the prompt.

<!-- fields:start -->
## On the node

- **node dots (in)**: Wire any node's output in. A new free dot appears as you wire; a freed one goes. Each shows its node's title.
- **nodes (out)**: Wire it into a WP Toggles control dot: that toggle then mutes or bypasses every node here.
- **Whole group**: With nothing wired into its dots (a WP Mode Relay doesn't count), the node gathers every node of the canvas group it sits in, the smallest one when groups nest, and the bar names that group. Nodes a wired-in relay watches stay out. Wire any node in and it goes back to only the wired ones.
- **Run / Mute / Bypass**: Set every node in the group at once.
- **Mode chip**: Each row's chip shows its node's mode. Click it to go Runs → Muted → Bypassed.
<!-- fields:end -->

