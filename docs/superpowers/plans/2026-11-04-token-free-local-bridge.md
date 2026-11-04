# Restore active helper selection

**Date:** 2026-11-04
**Spec:** [Keep local helper selection in the plugin panel](../specs/2026-11-04-local-origin-ui-design.md)
**Status:** Implementation in progress

## Cause

The prior change made a discovered-row click navigate to a locally served UI. That path rejected the current development plugin because `exporter/manifest.json` has no Figma-assigned ID. The UI test never clicked a discovered row, so it missed the broken interaction.

## Plan

1. Add regression coverage for startup discovery, clicking a discovered helper, connection without a plugin ID, URL-only manual connection, and the enabled export state.
2. Keep the existing bundled panel. The main plugin code validates the selected localhost URL, retrieves `/session`, keeps the token in memory, and posts exports to `/export`.
3. Keep `/health` free of secrets and paths, preserve private monitor state, origin checks on shutdown, and the 128 MiB body limit. Enable CORS for `/session` and `/export` so Figma's null-origin plugin requests work; document that webpages can read the local session token while a helper is running.
4. Refresh helper discovery on each plugin run, regardless of the saved Download/Local mode.
5. Build, run all tests, review the diff, and leave a Figma Desktop check clearly marked until it is performed.

## Acceptance checks

- A discovered helper appears as a button; clicking it connects in the same panel without a plugin ID or token prompt.
- The export button enables only after the helper returns a valid session.
- The token stays out of UI messages and Figma client storage.
- Manual URL entry and Download mode still work.
- Bridge, monitor, export, and launcher checks pass; README and privacy policy match the implemented CORS behavior.
