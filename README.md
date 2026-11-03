# Figma to JSON

Export selected Figma frames and components as JSON, with optional assets and PNG previews. Plugin export works with a free Figma Starter account and needs no API token.

## Quick setup

Requires Figma Desktop, Git, and Node.js 22 or later.

1. Clone the repo and build the plugin:

   ```sh
   git clone git@github.com:huyvowkm/figma-to-json.git
   cd figma-to-json
   npm ci --prefix exporter
   npm run build --prefix exporter
   ```

2. In Figma Desktop, import `exporter/manifest.json` from **Plugins → Development → Import plugin from manifest…**.
3. Select a frame, run **Figma to JSON**, then choose **Settings → Download JSON**. Choose **JSON + assets** if needed.

## Optional: use with Codex

Install Codex CLI. From the repository root, build the local server:

```sh
npm ci --prefix server
npm run build --prefix server
```

Start the helper for your project:

```sh
node /path/to/figma-to-json/bin/figma-mcp.mjs --output-dir /path/to/your-project
```

In the plugin, open **Settings → Local server (MCP)**, select your project, and export the frame. Codex reads the export from `.figma-cache/`. Press **Ctrl+C** to stop the helper.

The optional Codex skill is in `.codex/skills/figma-cache/SKILL.md`. To install it for other projects, run from this repository:

```sh
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills/figma-cache"
cp .codex/skills/figma-cache/SKILL.md "${CODEX_HOME:-$HOME/.codex}/skills/figma-cache/SKILL.md"
```
