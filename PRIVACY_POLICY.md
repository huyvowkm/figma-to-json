# Privacy Policy

Effective date: November 4, 2026

Design to JSON exports design content that you select in Figma Design.

## Data the plugin processes

- The selected frames, components, component sets, or instances and their design data.
- Detected image and SVG assets when **JSON + assets** is selected.
- A PNG frame preview when **PNG preview** is selected.
- The selected connection mode, saved in Figma client storage as a preference.
- A random local bridge token used to authorize folder exports.

The plugin does not save exported design content, local folder paths, or bridge tokens in Figma client storage. For local saves, the helper returns its token to the plugin through its localhost health response so the plugin can connect automatically. The token remains in plugin memory during the session. The helper also keeps it in a user-private temporary file so its local monitor can stop the helper, then removes the file when it exits normally.

The helper allows cross-origin browser requests. A webpage that the browser permits to reach `localhost` may read the token and use it to write files in the configured export cache or stop the helper. The token changes when the helper restarts.

## Where exported data goes

- **Download JSON:** The plugin prepares files in memory and provides download links in the plugin. Files are saved when you click the links, using your browser's download settings.
- **Save to project folder:** The plugin sends the selected export to the local bridge running on your computer. The bridge writes JSON to `.figma-cache/exported/` and assets to `.figma-cache/assets/` in the folder you configured.

The plugin does not send export data to the developer or to third-party servers. It does not use analytics or advertising. The local bridge listens on `localhost` and uses a random token for each run.

## Data retention and deletion

Downloaded or folder-exported files remain where your browser or local bridge saved them until you delete them. Stop the local bridge when you are finished. The plugin stores only the destination preference in Figma client storage.

## Contact

For support or privacy questions, use the [GitHub Issues page](https://github.com/huyvowkm/figma-to-json/issues). Do not post private design files or sensitive information in a public issue.
