# Design to JSON

Export selected frames and components from Figma Design as JSON, with optional assets and PNG previews. Works with a free Figma Starter account; no API token is needed.

## Quick setup

Requires Figma Desktop, Git, and Node.js 22 or later.

```sh
git clone https://github.com/huyvowkm/figma-to-json.git
cd figma-to-json
npm ci --prefix exporter
npm run build --prefix exporter
```

In Figma Desktop:

- Go to **Plugins → Development → Import plugin from manifest…**.
- Select `exporter/manifest.json`.
- Select a frame and run **Design to JSON**.

## Export settings

- **Export filter**
  - **Visible only** omits hidden content.
  - **No filter** includes hidden content.
- **Content**
  - **JSON only** exports just the JSON.
  - **JSON + assets** also includes detected images and SVG icons.
- **Frame preview**
  - **None** skips the PNG preview.
  - **PNG preview** saves a PNG alongside each JSON file.

## Choose where to save exports

- **Download JSON**
  - In **Settings**, choose **Download JSON**.
  - Select frames or components, set the export options, and click **Prepare downloads**.
  - Click each generated link. No local server is needed.
- **Save to project folder**
  - From this repository, start the local bridge and leave it running:

    ```sh
    node bin/bridge.mjs /path/to/project /path/to/project/.figma-cache
    ```

  - In **Settings**, choose **Save to project folder** and select the active folder.
  - Select frames or components, set the export options, and click **Export selected**.
  - Files are saved here:
    - JSON: `.figma-cache/exported/`
    - Assets: `.figma-cache/assets/`

See the [Privacy Policy](PRIVACY_POLICY.md) for data handling details.
