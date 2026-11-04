# Privacy Policy

Effective date: November 4, 2026

Design to JSON exports design content that you select in Figma Design.

## Data the plugin processes

- The selected frames, components, component sets, or instances and their design data.
- Detected image and SVG assets when **JSON + assets** is selected.
- A PNG frame preview when **PNG preview** is selected.
- The selected connection mode, saved in Figma client storage as a preference.
- A random local bridge token used to authorize folder exports.

The plugin does not save exported design content, local folder paths, or bridge tokens in Figma client storage. The selected connection mode is the only plugin preference stored there.

For local saves, the plugin scans `/health`, which returns the port, a random instance ID, display names, and shutdown support. It does not return tokens, absolute paths, or process IDs. The plugin scans on every run, including when Download mode is selected.

After you select a helper, the plugin retrieves its token from `/session` into plugin memory and sends exports to `/export`. The token is not sent through Figma UI messages or stored in Figma client storage. Figma plugin requests use a null origin, so `/session` and `/export` allow wildcard CORS. A webpage running in your browser may therefore read the local session token and use it to write files while the helper is running. The token changes each time the helper starts. Stop the helper when you are done. Export requests are limited to 128 MiB; larger requests are rejected before parsing or writing files.

The helper keeps its random token, local paths, and process details in a user-private temporary state file so the local monitor can identify and stop it. The helper does not print the token and removes the state file when it exits normally. An abnormal termination may leave the permission-restricted temporary file behind. `/shutdown` remains token-protected and does not enable CORS.

## Where exported data goes

- **Download JSON:** The plugin prepares files in memory and provides download links in the plugin. Files are saved when you click the links, using your browser's download settings.
- **Save to project folder:** The plugin sends the selected export to the local bridge running on your computer. The bridge writes JSON to `.figma-cache/exported/` and assets to `.figma-cache/assets/` in the folder you configured.

The plugin does not send export data to the developer or to third-party servers. It does not use analytics or advertising. The local bridge listens on `localhost` and uses a random token for each run.

## Data retention and deletion

Downloaded or folder-exported files remain where your browser or local bridge saved them until you delete them. Stop the local bridge when you are finished. On normal shutdown, its temporary token state is removed. The plugin stores only the connection-mode preference in Figma client storage.

## Contact

For support or privacy questions, use the [GitHub Issues page](https://github.com/huyvowkm/figma-to-json/issues). Do not post private design files or sensitive information in a public issue.
