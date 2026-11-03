---
name: figma-cache
description: Inspect a project's local Figma export cache to understand a screen, implement UI from exported designs, or compare an implementation with the design. Use for local .figma-cache exports, not live Figma file retrieval.
---

# Figma cache workflow

Use the current project's local Figma exports as the source of design facts.

## Choose the source

- Use only `.figma-cache/exported/` in the current project. Do not search other projects' caches.
- Do not call remote Figma tools to fill gaps in a local export. If a frame, asset, or design detail is missing or stale, name the frame that needs to be exported again.
- If the cache directory is missing or has no JSON exports, tell the user and ask them to export the needed frame into this project's cache.
- Reuse assets referenced by the export. Resolve their relative paths from the JSON file and check that they exist before relying on them.

## Inspect an export

1. List the JSON files in `.figma-cache/exported/` directly and choose the export that matches the requested screen. Export filenames may include `visible-only`, `no-filter`, `dark`, or a numeric suffix.
2. For large designs, prefer the local cache MCP tools when they are available:
   - `get_metadata` for a bounded layer outline.
   - `get_node` for a node using its exact exported Figma ID.
   - `get_preview` for the saved PNG reference, if the export includes one.
   - `get_variables` for the export's variable bindings, definitions, and referenced styles.
3. Read or search the JSON file directly when the local cache MCP tools are unavailable or when a specific field needs inspection. Keep reads focused; do not load a large export wholesale if a targeted lookup is enough.
4. Do not use the cache server's `list_screens`, `search_nodes`, or `get_screen` tools. The existing cache workflow uses the project files directly for inventory, search, and raw export data.
5. Preserve exact screen names and node IDs in your notes. Distinguish missing data from values that are present and empty. Older exports may not include styles, variable definitions, or PNG previews.

The local cache server may be registered only for the project selected when its launcher was started. If the current session has no local cache tools, use the current project's export files directly; do not assume a remote Figma tool is the cache server.

## Implement or review UI

- Inspect the repository's existing architecture, widgets, and design conventions before changing code.
- Before editing UI code, summarize the source frame and its dimensions, padding, spacing, colors, typography, corner radii, and referenced asset paths. Mark any values that are inferred because the export does not contain them.
- Implement or change UI only when the user asks for implementation. Match the exported design while reusing suitable project widgets and architecture.
- Do not change business logic unless the user explicitly requests it.
- When reviewing an implementation, compare it against the export and report concrete mismatches with the relevant screen or node IDs.

## Report gaps clearly

State which export and node IDs support the answer. If data is unavailable, say exactly what is missing and which frame should be re-exported. Never invent visual values or present an inference as an exported fact.
