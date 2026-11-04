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

For local saves, the plugin discovers helpers through `/health`, which returns the port, a random instance ID, display names, and shutdown support. It does not return tokens, absolute paths, or process IDs. This metadata endpoint allows cross-origin reads so the bundled plugin UI can discover local helpers.

After you select a helper, it serves the plugin UI from `http://localhost`. That same-origin UI retrieves the token from `/session` into page memory and sends exports to `/export`. The token is not sent through Figma messages. `/session`, `/export`, and `/shutdown` do not enable CORS and reject mismatched local host, origin, or browser fetch-site headers. The helper accepts export requests up to 128 MiB; larger requests are rejected before parsing or writing files.

The helper keeps its random token, local paths, and process details in a user-private temporary state file so the local monitor can identify and stop it. The helper does not print the token and removes the state file when it exits normally. An abnormal termination may leave the permission-restricted temporary file behind.

## Where exported data goes

- **Download JSON:** The plugin prepares files in memory and provides download links in the plugin. Files are saved when you click the links, using your browser's download settings.
- **Save to project folder:** The plugin sends the selected export to the local bridge running on your computer. The bridge writes JSON to `.figma-cache/exported/` and assets to `.figma-cache/assets/` in the folder you configured.

The plugin does not send export data to the developer or to third-party servers. It does not use analytics or advertising. The local bridge listens on `localhost` and uses a random token for each run. Local folder saving requires a Figma-assigned plugin ID so the locally served UI can use Figma's restricted message routing.

## Data retention and deletion

Downloaded or folder-exported files remain where your browser or local bridge saved them until you delete them. Stop the local bridge when you are finished. On normal shutdown, its temporary token state is removed. The plugin stores only the connection-mode preference in Figma client storage.

## Contact

For support or privacy questions, use the [GitHub Issues page](https://github.com/huyvowkm/figma-to-json/issues). Do not post private design files or sensitive information in a public issue.
