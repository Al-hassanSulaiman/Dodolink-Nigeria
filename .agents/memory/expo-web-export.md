---
name: Expo web export in workspace
description: How to run memory-hungry expo export --platform web locally without it being killed
---

Rule: run long builds (e.g. `expo export --platform web`) through the validation runner (`setValidationCommand` + `startValidationRun`), not as backgrounded bash processes.

**Why:** Background processes spawned from the shell (even with `setsid`/`nohup`) get reaped by the environment a couple of minutes after the tool call ends — the export died repeatedly with no error and no exit code. The validation runner has managed lifecycle and survives.

**How to apply:** Also free memory first: the web export needs ~2.5 GB+. Kill tsserver (`pkill -f typescript/lib/tsserver`, it respawns) and restart the expo dev workflow to reclaim RAM, and cap heap with `NODE_OPTIONS=--max-old-space-size=2560`. The deployment's build step exports web via `scripts/build.js` (`exportWebBuild`) — if it OOMs there, add the same NODE_OPTIONS.
