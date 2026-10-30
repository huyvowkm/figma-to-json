# Figma to JSON

A Figma plugin that exports selected frames and components as JSON, with optional raster images, SVG icons, and PNG previews. Exporting uses Figma's plugin APIs and requires no AI model, AI API key, or Codex installation.

Use **Download JSON** for standalone exports inside Figma. An optional local helper saves exports directly into a project folder and connects them to Codex through MCP.

I built this after running into rate limits while requesting Figma design data through MCP. I wanted a way to export selected designs as JSON once and keep the data locally. Figma to JSON makes those files available through a local MCP server, reducing repeat requests for designs that have already been exported.

## Features

- Export selected frames, components, component sets, and instances. Multiple selections produce one JSON file per selected item.
- Choose **Visible only** (the default) to omit hidden content, or **No filter** to include hidden content.
- Choose **JSON only** (the default) or **JSON + assets**.
- Optionally add a **PNG preview** beside each JSON file for visual reference. Previews are off by default and independent of asset extraction.
- Read compact layer outlines or individual nodes through MCP instead of loading entire screen files.
- Include referenced styles, consumer-specific variable values, and variable definitions with modes and alias dependencies.
- Use **Download JSON** without running a local helper, or **Local server (MCP)** to save into a folder and make JSON available to Codex.
- Detect dark mode from the selected node's name, variant values, or active variable mode names. When detected, add `-dark` to the JSON filename.
- Avoid overwriting JSON files by adding a numeric suffix when a filename already exists.
- Monitor local bridges in a live terminal table, inspect status as JSON, stop a selected server, and clean confirmed stale registrations.
- Automatically approve the seven local read tools on startup and remove the matching Codex registration when the helper stops.
- Export readable SVG filenames such as `icon-search.svg`. Same-name assets use the latest content; frame JSON and PNG previews keep numbered filenames.
- Get actionable connection and token errors, a 15-second upload timeout, and a list of files saved before a failure.

## Requirements

| Workflow | Requirements |
| --- | --- |
| **Standalone Figma plugin — Download JSON** | Figma desktop. Git and Node.js 22 or later with npm for the clone/build steps below. No Codex or local server. |
| **Optional local helper — Local server (MCP)** | Node.js 22 or later, the built MCP server, and Codex CLI available as `codex` on your terminal's `PATH`. The interactive monitor also needs the root npm dependencies. |

The Codex dependency comes from the current `bin/figma-mcp.mjs` launcher: it calls Codex CLI to register the project's MCP server, configure local read-tool permissions, and remove the registration on shutdown. Its status, monitor, stop, and clean commands also read Codex configuration. This is a dependency of that integration; the Figma export itself uses no AI. Choose **Download JSON** if you only need exported files.

## Clone and build

### Standalone Figma plugin

```sh
git clone git@github.com:huyvowkm/figma-to-json.git
cd figma-to-json
npm ci --prefix exporter
npm run build --prefix exporter
```

You can now import the plugin and use **Download JSON**. The root and `server/` npm projects are unnecessary for this workflow.

### Optional local helper and Codex MCP integration

For **Local server (MCP)** mode, also run these commands from the repository root:

```sh
npm ci --prefix server
npm run build --prefix server
npm ci
```

The server and Figma plugin have separate npm projects. The root npm project contains the Ink + React terminal monitor; its dependencies are only needed for the interactive monitor. The monitor runs as plain JavaScript and does not need a JSX build step. Install Codex CLI before starting the launcher.

## Import the Figma plugin

1. Open a design in the Figma desktop app.
2. Open the Plugins menu and choose **Development → Import plugin from manifest…**.
3. In your cloned repository, select `exporter/manifest.json`. The manifest is inside `exporter`; do not select a manifest from the repository root.
4. Run **Figma to JSON** from the Figma Development plugins menu.

This is a local development plugin imported from its manifest. Each computer that uses the plugin needs its own clone and local manifest import.

## Export without a local server

Use this option for standalone exports. JSON, images, SVG icons, PNG previews, and referenced variable/style data are prepared by the Figma plugin without Codex or an AI service.

1. Open **Settings** in the exporter and choose **Download JSON**.
2. Select one or more frames, components, component sets, or instances on the canvas.
3. In the main view, choose an export mode and content option.
4. Click **Prepare downloads**, then click the download links shown by the plugin.

Figma downloads each selected item as its own JSON file. If you choose **JSON + assets**, asset files download separately. To keep their relative links working, place the JSON files in an `exported/` folder and the downloaded assets in a sibling `assets/` folder.

## Optional: save exports to a local folder and use Codex MCP

### Build the server

Follow the optional local helper build steps above. This workflow uses the Codex-specific launcher to register a local stdio MCP server for the selected project folder, so Codex CLI must be installed and available as `codex` in your terminal. The launcher and export bridge do not invoke an AI model; using Codex to interpret the exported designs is a separate step.

### Start the helper in the folder you want to use

Open a terminal in the desired project folder, then run the launcher from your clone. The helper uses the terminal's current directory by default:

```sh
cd ~/Documents/figma-exports
node /path/to/figma-to-json/bin/figma-mcp.mjs
```

Or provide the destination explicitly from any directory:

```sh
node /path/to/figma-to-json/bin/figma-mcp.mjs --output-dir ~/Documents/figma-exports
```

In Windows PowerShell, use the same launcher with Windows paths:

```powershell
Set-Location "$HOME\Documents\figma-exports"
node "C:\path\to\figma-to-json\bin\figma-mcp.mjs"
```

The launcher creates `.figma-cache/` with both `assets/` and `exported/` inside the selected project folder at startup, starts the local bridge, and registers the folder's MCP server with Codex once the bridge is listening. Existing folders and files are preserved. Leave this terminal running while exporting. Press **Ctrl+C** to stop the bridge and remove its matching Codex registration. Closing the terminal tab (when the terminal sends `SIGHUP`), `SIGTERM`, or a bridge exit also triggers cleanup. Running it again for the same project reuses the active bridge instead of starting a duplicate; the duplicate launcher leaves the active registration alone.

The launcher also watches for terminal input disconnects and the loss of its parent shell, covering terminal closure without a shutdown signal. The bridge exits when its launcher connection disappears and performs guarded registration cleanup if the launcher could not. This prevents an orphaned bridge from blocking the next start.

Cleanup preserves registrations changed externally while the helper is running. Force-killing both processes, a power loss, or a failed Codex command can still leave an entry behind; check `codex mcp list` and use `codex mcp remove <server-name>` if needed. Removing a registration preserves all exports. An already-open Codex session may retain loaded tools until restarted. Start the helper again before starting a new Codex session that needs its tools.

The launcher also configures `approval_mode = "approve"` for this server's seven local read tools: `list_screens`, `get_screen`, `get_metadata`, `get_node`, `get_preview`, `get_variables`, and `search_nodes`. These permissions are saved under the server's `tools` entries in Codex's config and removed with its registration on shutdown. Other servers and global approval settings are preserved. Restart an existing Codex session to load the new tool permissions. This requires a Codex CLI version supporting `config/batchWrite` and MCP per-tool approval settings.

The bridge listens on `localhost`, starting at port `3847` and trying through `3867` if a port is already in use. The terminal prints the active URL and a temporary connection token. Keep the token private; the plugin uses it to send exports to the running local bridge.

### Connect the plugin

1. In the exporter, open **Settings** and choose **Local server (MCP)**.
2. Select the active folder shown in the main view. Choose **Refresh** if it does not appear.
3. If discovery does not find the bridge, open **Manual connection** and enter the URL and token printed in the helper terminal.
4. Select Figma nodes, choose the export options, and click **Export selected**.

The launcher configures Codex to read JSON files from this folder. Use `codex mcp list` to check the registered MCP servers. Keep the repository at a stable path after setup because Codex stores the launch command for the local server.

### Monitor and stop servers

Run `npm ci` once in the repository root to install Ink and React. Existing checkouts that previously installed only `server/` and `exporter/` also need this step. The root dependencies are loaded only when opening the interactive monitor; server startup and non-interactive management commands keep their existing behavior.

From the repository root, use these commands. Starting the helper without `--output-dir` uses your current directory as the project folder.

```sh
node bin/figma-mcp.mjs --output-dir /path/to/project
node bin/figma-mcp.mjs status          # Discovered and tracked local bridges
node bin/figma-mcp.mjs status --json   # Machine-readable status, without tokens
node bin/figma-mcp.mjs monitor         # Live terminal monitor
node bin/figma-mcp.mjs stop <name>     # Stop a bridge and wait for cleanup
node bin/figma-mcp.mjs clean           # Remove confirmed stopped entries
```

From another folder, use the absolute path to `bin/figma-mcp.mjs`. If you already have a `run figma-mcp` shortcut pointing to that file and forwarding arguments, it supports the same commands. Monitor commands do not start an export bridge.

The monitor refreshes every two seconds. Selection stays on the same server across refreshes, and long lists scroll with the selection.

| Key | Action |
| --- | --- |
| **↑ / ↓** | Select a server. |
| **S** | Stop the selected verified running bridge immediately. |
| **R** | Refresh now. |
| **c** | Clean the selected confirmed stopped row. |
| **Shift+C** | Clean all confirmed stale rows. |
| **Q**, **Esc**, **Ctrl+C** | Exit the monitor, keeping bridges running. |

Actions run directly on the keypress. Stop, refresh and quit accept uppercase or lowercase; cleanup distinguishes **c** from **Shift+C**. Cleanup preserves running, unresponsive and untracked entries.

The monitor uses Ink + React components for layout and keyboard input. When the terminal is wide enough for the current data, the main table includes full server name, folder, state, port, config, PID, tools, exports, and last export as columns. Otherwise, it uses a compact server list with a bordered **Selected server** details table underneath. Long selected values wrap when height allows; overflow is marked with an ellipsis. The layout updates when you resize the terminal and keeps the selected server. Ink restores the cursor, screen, and terminal input mode when you exit. It requires an interactive terminal; `status` still works in scripts.

Background refreshes leave the status line quiet and preserve the latest action result. Stop/clean feedback appears when you press the action key; pressing **R** shows manual refresh progress. Selecting an unavailable action shows its explanation only after you try it.

States distinguish a healthy `running` bridge, a confirmed `stopped` bridge, an `unresponsive` tracked instance, and an `untracked` registration without enough process information. A registered Codex reader and a running export bridge are separate: these commands report bridge health and configuration, not which tools an already-open Codex session has loaded.

New launcher runs store private per-server records in `$CODEX_HOME/figma-mcp/servers/` (default `~/.codex/figma-mcp/servers/`). Records contain project paths, instance identity, start time, port and PIDs; they do not contain connection tokens. Stopped records remain available for status until `clean` removes them. `FIGMA_MCP_STATE_DIR` overrides the records directory. The monitor discovers bridges on ports 3847–3867 and uses recorded ports for custom-port launches. `FIGMA_MCP_PORT` can also specify a port to discover.

Stop uses the bridge's authenticated localhost shutdown endpoint and checks its project and instance identity; it does not kill a process by PID. Older bridges without this endpoint must be stopped in their original terminal and restarted with the updated launcher. Clean only removes matching tracked registrations with a closed port and absent bridge/launcher processes. It preserves running, unresponsive, untracked, or externally changed registrations and all design exports. Other MCP servers are excluded.

## Export options

### Export mode

| Option | Result |
| --- | --- |
| **Visible only** (default) | Exports selected items that are visible, and omits hidden descendants from their JSON and extracted assets. |
| **No filter** | Includes hidden selected items and hidden descendants. The selection must still contain an exportable Figma node. |

### Export content

| Option | Result |
| --- | --- |
| **JSON only** (default) | Writes the Figma JSON and metadata. It skips image and SVG extraction. |
| **JSON + assets** | Also saves raster image paints and detected SVG icons or nodes explicitly marked for SVG export in Figma. |

SVG extraction checks the following signals:

- An explicit **SVG** entry in a node's Figma export settings. This also supports larger assets that automatic detection would skip.
- Icon markers such as `icon`, `icons`, `glyph`, `symbol`, `icn`, or `ic` in the name, with vector geometry and dimensions no larger than 128 px.
- Small vector nodes or groups of vector shapes, including icons named `Search`, `Close`, or `Vector`. Automatic geometry detection uses dimensions from 8 to 64 px with an aspect ratio no greater than 4:1. Ordinary individual rectangles, ellipses, and lines are not automatically treated as icons.

Automatic detection skips text and raster content, large artwork, and control names such as `Icon Button`. It descends into those containers to find their glyphs. When a group is exported as one icon, its children are not exported again. Detection is heuristic: a small decorative vector can look like an icon, and unusual icons may be missed. Add an explicit SVG export setting when automatic detection misses an intended asset.

Keyboard-named subtrees are always excluded from SVG extraction, even when selecting an icon inside a keyboard directly or using **No filter**. The exclusion also takes priority over explicit SVG settings. Raster image paints are collected separately.

JSON nodes include `isIcon` and `iconClassification`: `name-match`, `vector-shape`, `svg-export-setting`, `excluded-keyboard`, or `not-detected`. Nodes actually exported as SVG also include `svgAsset`, a relative path to their file. With **JSON only**, classification is still included but SVG files and links are not created.

SVG filenames use the layer name, such as `icon-cellular-connection.svg`, without node IDs or content fingerprints. An existing `icon` prefix is not repeated. In local-server mode, SVG and image files with the same filename are overwritten with the latest exported content. Frame JSON files and their PNG previews keep numbered filenames and are never replaced. Earlier JSON files referencing a shared asset will therefore use that asset's latest content. If selected frames contain different icons with the same name, the last selected frame's version wins. Node IDs remain in JSON metadata. Download mode offers one asset per filename for the current selection; the browser controls whether existing downloads are renamed or replaced.

If Figma cannot render an SVG or PNG preview (for example, a node with no visible layers), that optional file is skipped. JSON and successfully rendered assets are still exported. The plugin shows warnings with the format, layer name, node ID, and error; the full list is also saved in the JSON `warnings` array. A failed icon has `svgExportError` instead of an `svgAsset` link. This does not change layer visibility or force hidden content to render. Errors exporting the required JSON still stop the operation and identify the affected selected node.

With **Visible only**, SVG candidates whose `absoluteRenderBounds` is explicitly `null` are omitted before rendering. This includes icons fully clipped outside a parent frame, even when their layer visibility flag is enabled. These are recorded in `skippedRenders` and marked `svgExportSkipped: "not-rendered"` on their JSON nodes; the UI shows an informational count instead of a render warning. Their structural JSON is retained. Partially rendered icons are still exported. **No filter** attempts these assets as requested; Figma can still reject their render and return a warning.

The dark-mode filename marker is based on the selected node's name, variant values, or active variable mode names containing “dark.” It does not inspect the rendered colors to guess whether a design looks dark.

### Frame preview

Choose **PNG preview** in the **Frame preview** menu to save a rendered reference beside each JSON. It works in both connection modes and with either content option. **None** is the default. Previews render at up to 1x, reduced when necessary to keep the longest frame dimension at 4096 px. They reflect Figma's rendered appearance; choosing **No filter** does not make hidden descendants appear in the PNG.

JSON files record `preview.file` relative to their own folder. On repeat exports, the JSON and PNG receive the same numeric suffix, such as `checkout-visible-only-2.json` and `checkout-visible-only-2.png`. In download mode, place both files in the same `exported/` folder and preserve their names. Browser download history can rename files independently; use an empty destination or rename the pair together if that happens.

## Output structure

```text
figma-project/
└── .figma-cache/
    ├── exported/
    │   ├── checkout-visible-only.json
    │   ├── checkout-visible-only.png  # only with PNG preview enabled
    │   └── settings-no-filter-dark.json
    └── assets/                     # created at startup; populated with JSON + assets
        ├── image-a1b2c3.png
        └── icon-search.svg
```

JSON filenames follow `<node-name>-<visible-only|no-filter>[-dark].json`. If an export would reuse a JSON filename, the exporter adds a suffix such as `-2` rather than replacing the existing file. Asset references in JSON are relative paths such as `../assets/image-a1b2c3.png`.

Each JSON file contains export metadata, the source Figma node information, resolved variable data, and the node's Figma JSON. When assets are included, it also lists the saved assets and their relative file paths.

`variables` records bindings and their resolved values for each consumer node, including styled text ranges. `variableDefinitions` records referenced variables, mode values, collection modes, and transitive alias dependencies. `styles` records referenced text, paint, effect, and grid styles with consumer node IDs. Missing or inaccessible variables/styles have an `error` field; these are partial results, not proof that the design has no tokens. This exports data referenced by the filtered selection, not an entire team library. Alias dependencies can include values from other modes.

## Optional Codex MCP tools

The local MCP server exposes these read-only tools for JSON files in `.figma-cache/exported/` inside the selected project folder:

| Tool | Use |
| --- | --- |
| `list_screens` | List exported JSON files available in `.figma-cache/exported/`. |
| `get_screen` | Read one exported JSON file by its screen name. |
| `get_metadata` | Read a compact layer outline. Takes `screen`, optional `nodeId`, `depth` (default 2, maximum 10), and `maxNodes` (default 200, maximum 1000). |
| `get_node` | Read one node's properties by `screen` and exact Figma `nodeId`. Descendants are omitted by default; use `depth` and `maxNodes` to include a bounded subtree. |
| `get_preview` | Return the saved PNG as an MCP image. Requires a PNG preview export. |
| `get_variables` | Read bindings, variable definitions and styles. Optional `nodeId` restricts bindings/styles to that exact consumer; definitions remain available for the full screen. |
| `search_nodes` | Search node names and text, returning at most 20 matches without descendants. |

For example, ask Codex to list the exported screens, read `checkout-visible-only`, or search that screen for a node named “Continue.”

For large designs, ask for `get_metadata` first, then `get_node` for the relevant ID and `get_preview` for visual reference. Tree responses include `childCount`, `nodeCount`, `truncated`, and `childrenTruncated` so omitted descendants are explicit. Metadata text snippets are limited to 160 characters. Node IDs must match the exported IDs exactly, for example `12:34`.

Older JSON exports remain readable. If they lack styles, variable definitions, or a preview, re-export to add that data. `get_variables` reports `definitionsAvailable` and `stylesAvailable` to distinguish missing fields in older exports from empty arrays in newer exports. Restart your Codex session after rebuilding the MCP server to load the new tools.

## Troubleshooting

- **The plugin cannot find a folder:** Confirm the helper is still running, choose **Local server (MCP)**, and press **Refresh**. If needed, use **Manual connection** with the URL and token from the helper terminal.
- **Cannot reach the local server:** The helper may have stopped or the connection may be blocked. Start it in the target folder, press **Refresh**, and select the server again. The error includes the destination URL. An HTTP 403 indicates a rejected connection token; refresh the selection or update the manual token after restarting the helper.
- **The server does not respond:** Export requests stop waiting after 15 seconds. Check the helper terminal and destination folder before retrying: a slow request may still finish saving files. Requests are not automatically retried, and any files confirmed before the failure remain listed in the plugin.
- **`codex` is not found:** Install or configure Codex CLI and ensure `codex` is on your terminal's `PATH`. Browser download mode works without it.
- **The MCP server does not appear in Codex:** Run `codex mcp list` and restart the Codex session after adding the server.
- **The monitor cannot load Ink or React:** Run `npm ci` in the repository root, including when upgrading an older checkout. Use Node.js 22 or later.
- **The monitor needs an interactive or larger terminal:** Open it in a terminal with at least 44 columns and 18 rows. For scripts, use `node bin/figma-mcp.mjs status --json`.
- **The plugin import fails:** Import `exporter/manifest.json` in Figma desktop. If you changed `code.ts`, rebuild the exporter with `npm run build` in `exporter/` first.
- **Assets appear missing after browser downloads:** Create sibling `exported/` and `assets/` folders and place each downloaded file in the matching folder so the JSON's relative asset paths resolve.
- **A hidden selected item is not exported:** Switch from **Visible only** to **No filter**.
- **“This node may not have any visible layers”:** Check the layer named in the render warning for hidden content, empty geometry, or clipping. JSON and other assets remain available when an optional SVG/PNG fails. **No filter** includes hidden JSON nodes; it does not force Figma to render hidden content. To request only JSON, choose **JSON only** and set **Frame preview** to **None**.

## Development checks

After installing dependencies in all three npm projects, run from the repository root:

```sh
npm run build --prefix exporter
npm run build --prefix server
node test/exporter-context-test.mjs
node test/exporter-svg-test.mjs
node test/exporter-connection-test.mjs
node test/server-context-test.mjs
node test/bridge-test.mjs
node test/bridge-port-retry-test.mjs
node test/launcher-cleanup-test.mjs --real-codex --with-bridge
npm run test:ui
npm run test:monitor
```

Bridge and monitor checks open localhost sockets. Launcher and monitor integration checks use temporary, isolated Codex configuration; they require the Codex CLI. On macOS and Linux, terminal interaction checks also require Python 3. Exporter checks simulate the Figma runtime; verify rendering and downloads in Figma desktop separately.

## References

- [Figma development plugin guide](https://help.figma.com/hc/en-us/articles/38457121114263-Create-a-Figma-Design-plugin-with-the-Figma-MCP-server-and-agentic-tools) — importing and using a development plugin.
- [Figma plugin manifest documentation](https://developers.figma.com/docs/plugins/manifest/) — manifest fields, including local network access configuration.
- [Codex MCP documentation](https://developers.openai.com/learn/docs-mcp) — managing MCP servers with Codex CLI.
- [figma-to-json](https://github.com/yagudaev/figma-to-json) — an independently maintained Figma JSON exporter; referenced as an example of a clear plugin installation and usage guide, not as a dependency of this project.
