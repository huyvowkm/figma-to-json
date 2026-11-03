# Figma to JSON

Export selected Figma frames and components as JSON, with optional assets and PNG previews. Works with a free Figma Starter account; no API token is needed.

## Quick setup

Requires Figma Desktop, Git, and Node.js 22 or later.

```sh
git clone git@github.com:huyvowkm/figma-to-json.git
cd figma-to-json
npm ci --prefix exporter
npm run build --prefix exporter
```

In Figma Desktop, import `exporter/manifest.json` from **Plugins → Development → Import plugin from manifest…**. Select a frame and run **Figma to JSON**.

## Export

- **Download JSON:** Choose **Settings → Download JSON**. Files download through your browser; no local server is needed.
- **Save to a project folder:** Start the local bridge from this repository:

  ```sh
  node bin/bridge.mjs /path/to/project /path/to/project/.figma-cache
  ```

  In the plugin, choose **Settings → Local server (MCP)**, select the active folder, and export. Keep the bridge running. JSON goes in `.figma-cache/exported/`; assets go in `.figma-cache/assets/`.

## Optional: read exports with Codex

Codex is not needed to export. To let Codex read the local cache, build and start its MCP server instead of `bin/bridge.mjs`:

```sh
npm ci --prefix server
npm run build --prefix server
node bin/figma-mcp.mjs --output-dir /path/to/project
```

The Codex skill is in `.codex/skills/figma-cache/SKILL.md`.
