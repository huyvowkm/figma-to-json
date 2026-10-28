# Figma to JSON

A local Figma exporter for selected frames and components. Save each selection as a separate JSON file, optionally include raster image paints and SVG icons, and read folder exports through Codex MCP tools.

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

## Requirements

- Git and a currently supported Node.js LTS release with npm.
- Figma desktop to import and run the development plugin.
- Codex CLI for **Local server (MCP)** mode. **Download JSON** mode does not require Codex or the local helper.

## Clone and build

```sh
git clone git@github.com:huyvowkm/figma-to-json.git
cd figma-to-json

cd server
npm ci
npm run build

cd ../exporter
npm ci
npm run build

cd ..
```

The server and Figma plugin have separate npm projects, so install dependencies in each directory. There is no root-level `npm install` step.

## Import the Figma plugin

1. Open a design in the Figma desktop app.
2. Open the Plugins menu and choose **Development → Import plugin from manifest…**.
3. In your cloned repository, select `exporter/manifest.json`. The manifest is inside `exporter`; do not select a manifest from the repository root.
4. Run **Figma to JSON** from the Figma Development plugins menu.

This is a local development plugin imported from its manifest. Each computer that uses the plugin needs its own clone and local manifest import.

## Export without a local server

Use this option if you only need files downloaded from Figma.

1. Open **Settings** in the exporter and choose **Download JSON**.
2. Select one or more frames, components, component sets, or instances on the canvas.
3. In the main view, choose an export mode and content option.
4. Click **Prepare downloads**, then click the download links shown by the plugin.

Figma downloads each selected item as its own JSON file. If you choose **JSON + assets**, asset files download separately. To keep their relative links working, place the JSON files in an `exported/` folder and the downloaded assets in a sibling `assets/` folder.

## Save exports to a local folder and use Codex MCP

### Build the server

Follow the build steps above. The launcher registers a local stdio MCP server with Codex for the selected project folder, so Codex CLI must be installed and available as `codex` in your terminal.

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

The launcher creates `.figma-cache/` with both `assets/` and `exported/` inside the selected project folder at startup, registers the folder's MCP server with Codex, and starts the local bridge. Existing folders and files are preserved. Leave this terminal running while exporting. Press **Ctrl+C** to stop the bridge. Running it again for the same project reuses the active bridge instead of starting a duplicate.

The bridge listens on `localhost`, starting at port `3847` and trying through `3867` if a port is already in use. The terminal prints the active URL and a temporary connection token. Keep the token private; the plugin uses it to send exports to the running local bridge.

### Connect the plugin

1. In the exporter, open **Settings** and choose **Local server (MCP)**.
2. Select the active folder shown in the main view. Choose **Refresh** if it does not appear.
3. If discovery does not find the bridge, open **Manual connection** and enter the URL and token printed in the helper terminal.
4. Select Figma nodes, choose the export options, and click **Export selected**.

The launcher configures Codex to read JSON files from this folder. Use `codex mcp list` to check the registered MCP servers. Keep the repository at a stable path after setup because Codex stores the launch command for the local server.

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

SVG filenames include a fingerprint of the SVG content. Changed content, including different theme colors, gets a new filename; unchanged content can reuse the existing file. The bridge rejects conflicting asset contents instead of overwriting files referenced by earlier JSON exports. Existing overwritten assets from older versions cannot be recovered automatically; re-export those designs with the updated plugin.

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
        └── icon-search-12-34-a1b2c3d4e5f60708.svg
```

JSON filenames follow `<node-name>-<visible-only|no-filter>[-dark].json`. If an export would reuse a JSON filename, the exporter adds a suffix such as `-2` rather than replacing the existing file. Asset references in JSON are relative paths such as `../assets/image-a1b2c3.png`.

Each JSON file contains export metadata, the source Figma node information, resolved variable data, and the node's Figma JSON. When assets are included, it also lists the saved assets and their relative file paths.

`variables` records bindings and their resolved values for each consumer node, including styled text ranges. `variableDefinitions` records referenced variables, mode values, collection modes, and transitive alias dependencies. `styles` records referenced text, paint, effect, and grid styles with consumer node IDs. Missing or inaccessible variables/styles have an `error` field; these are partial results, not proof that the design has no tokens. This exports data referenced by the filtered selection, not an entire team library. Alias dependencies can include values from other modes.

## Codex MCP tools

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
- **`codex` is not found:** Install or configure Codex CLI and ensure `codex` is on your terminal's `PATH`. Browser download mode works without it.
- **The MCP server does not appear in Codex:** Run `codex mcp list` and restart the Codex session after adding the server.
- **The plugin import fails:** Import `exporter/manifest.json` in Figma desktop. If you changed `code.ts`, rebuild the exporter with `npm run build` in `exporter/` first.
- **Assets appear missing after browser downloads:** Create sibling `exported/` and `assets/` folders and place each downloaded file in the matching folder so the JSON's relative asset paths resolve.
- **A hidden selected item is not exported:** Switch from **Visible only** to **No filter**.
- **“This node may not have any visible layers”:** Check the layer named in the render warning for hidden content, empty geometry, or clipping. JSON and other assets remain available when an optional SVG/PNG fails. **No filter** includes hidden JSON nodes; it does not force Figma to render hidden content. To request only JSON, choose **JSON only** and set **Frame preview** to **None**.

## References

- [Figma development plugin guide](https://help.figma.com/hc/en-us/articles/38457121114263-Create-a-Figma-Design-plugin-with-the-Figma-MCP-server-and-agentic-tools) — importing and using a development plugin.
- [Figma plugin manifest documentation](https://developers.figma.com/docs/plugins/manifest/) — manifest fields, including local network access configuration.
- [Codex MCP documentation](https://developers.openai.com/learn/docs-mcp) — managing MCP servers with Codex CLI.
- [figma-to-json](https://github.com/yagudaev/figma-to-json) — an independently maintained Figma JSON exporter; referenced as an example of a clear plugin installation and usage guide, not as a dependency of this project.
