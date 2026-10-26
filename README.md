# Figma to JSON

A local Figma exporter for selected frames and components. Save each selection as a separate JSON file, optionally include raster image paints and named SVG icons, and read folder exports through Codex MCP tools.

I built this after running into rate limits while requesting Figma design data through MCP. Those requests return JSON, so I wanted a way to export selected designs once and keep the data locally. Figma to JSON makes those files available through a local MCP server, reducing repeat requests for designs that have already been exported.

## Features

- Export selected frames, components, component sets, and instances. Multiple selections produce one JSON file per selected item.
- Choose **Visible only** (the default) to omit hidden content, or **No filter** to include hidden content.
- Choose **JSON only** (the default) or **JSON + assets**.
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

Follow the build steps above. The launcher registers a local stdio MCP server with Codex for the selected output folder, so Codex CLI must be installed and available as `codex` in your terminal.

### Start the helper in the folder you want to use

Open a terminal in the desired output folder, then run the launcher from your clone. The helper uses the terminal's current directory by default:

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

The launcher creates `exported/` if needed, registers the folder's MCP server with Codex, and starts the local bridge. Leave this terminal running while exporting. Press **Ctrl+C** to stop the bridge.

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
| **JSON + assets** | Also saves raster image paints and SVGs for nodes whose names contain an icon marker such as `icon`, `glyph`, `symbol`, `icn`, or `ic`. |

SVG icon detection is based on node names. Nodes inside a subtree named `keyboard` are excluded from SVG icon extraction. The JSON includes icon classification metadata, such as `name-match`, `excluded-keyboard`, or `not-detected`. This keyboard exclusion applies to SVG icon extraction; raster image paints are collected separately.

The dark-mode filename marker is based on the selected node's name, variant values, or active variable mode names containing “dark.” It does not inspect the rendered colors to guess whether a design looks dark.

## Output structure

```text
figma-exports/
├── exported/
│   ├── checkout-visible-only.json
│   └── settings-no-filter-dark.json
└── assets/                         # created when assets are exported
    ├── image-a1b2c3.png
    └── icon-search-12-34.svg
```

JSON filenames follow `<node-name>-<visible-only|no-filter>[-dark].json`. If an export would reuse a JSON filename, the exporter adds a suffix such as `-2` rather than replacing the existing file. Asset references in JSON are relative paths such as `../assets/image-a1b2c3.png`.

Each JSON file contains export metadata, the source Figma node information, resolved variable data, and the node's Figma JSON. When assets are included, it also lists the saved assets and their relative file paths.

## Codex MCP tools

The local MCP server exposes these read-only tools for JSON files in the selected output folder:

| Tool | Use |
| --- | --- |
| `list_screens` | List exported JSON files available in `exported/`. |
| `get_screen` | Read one exported JSON file by its screen name. |
| `search_nodes` | Search a screen's node names for a text query. |

For example, ask Codex to list the exported screens, read `checkout-visible-only`, or search that screen for a node named “Continue.”

## Troubleshooting

- **The plugin cannot find a folder:** Confirm the helper is still running, choose **Local server (MCP)**, and press **Refresh**. If needed, use **Manual connection** with the URL and token from the helper terminal.
- **`codex` is not found:** Install or configure Codex CLI and ensure `codex` is on your terminal's `PATH`. Browser download mode works without it.
- **The MCP server does not appear in Codex:** Run `codex mcp list` and restart the Codex session after adding the server.
- **The plugin import fails:** Import `exporter/manifest.json` in Figma desktop. If you changed `code.ts`, rebuild the exporter with `npm run build` in `exporter/` first.
- **Assets appear missing after browser downloads:** Create sibling `exported/` and `assets/` folders and place each downloaded file in the matching folder so the JSON's relative asset paths resolve.
- **A hidden selected item is not exported:** Switch from **Visible only** to **No filter**.

## References

- [Figma development plugin guide](https://help.figma.com/hc/en-us/articles/38457121114263-Create-a-Figma-Design-plugin-with-the-Figma-MCP-server-and-agentic-tools) — importing and using a development plugin.
- [Figma plugin manifest documentation](https://developers.figma.com/docs/plugins/manifest/) — manifest fields, including local network access configuration.
- [Codex MCP documentation](https://developers.openai.com/learn/docs-mcp) — managing MCP servers with Codex CLI.
- [figma-to-json](https://github.com/yagudaev/figma-to-json) — an independently maintained Figma JSON exporter; referenced as an example of a clear plugin installation and usage guide, not as a dependency of this project.
