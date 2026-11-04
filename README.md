# Figma to JSON

Export selected Figma frames and components as JSON, with optional assets and PNG previews. Works with a free Figma Starter account; no API token is needed.

## Quick setup

Requires Figma Desktop, Git, and Node.js 22 or later.

```sh
git clone https://github.com/huyvowkm/figma-to-json.git
cd figma-to-json
npm ci --prefix exporter
npm run build --prefix exporter
```

In Figma Desktop, import `exporter/manifest.json` from **Plugins → Development → Import plugin from manifest…**. Select a frame and run **Figma to JSON**.

## Export settings

- **Export filter:** **Visible only** omits hidden content; **No filter** includes it.
- **Content:** Choose **JSON only** or **JSON + assets** to include detected images and SVG icons.
- **Frame preview:** Choose **None** or **PNG preview** to save a PNG alongside each JSON file.

## Choose where to save exports

- **Download JSON:** In **Settings**, choose **Download JSON**. Select frames or components, set the export options, click **Prepare downloads**, then click each generated link. No local server is needed.
- **Save to project folder:** Run `node bin/bridge.mjs /path/to/project /path/to/project/.figma-cache` from this repository and keep it running. In **Settings**, choose **Save to project folder**, select the active folder, then click **Export selected**. JSON is saved in `.figma-cache/exported/`; assets are saved in `.figma-cache/assets/`.
