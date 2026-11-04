# Keep local helper selection in the plugin panel

## Status

The earlier local-origin UI design was superseded after it blocked helper selection when the development manifest had no plugin ID. Restore the existing single-panel flow: scan active helpers, select one in the list, and connect without navigating the UI or asking for a token.

## Behavior

- Scan the supported localhost ports whenever the plugin opens, even if Download mode was last selected.
- Keep the bundled plugin UI open. Selecting a discovered helper connects it in place and enables export after the helper responds.
- Manual fallback accepts only an `http://localhost` URL on ports 3847–3867. The helper token is never entered by the user.
- The plugin main code retrieves the token from `/session` and keeps it in memory. It sends exports to `/export`; the token is not sent through Figma UI messages or saved in client storage.
- Preserve Download mode, the active-folder list, helper monitoring, and the 128 MiB export limit.

## Bridge and security

- `/health` returns the port, instance ID, project and export-folder display names, and shutdown support. It omits tokens, paths, and process IDs.
- Figma's plugin requests use a null origin. `/session` and `/export` therefore allow wildcard CORS; `/export` still requires the random bridge token and validates the local host.
- Wildcard CORS on `/session` means any webpage that can reach localhost may read the token and use it to write exports while the helper runs. The token remains in plugin memory and rotates when the helper restarts.
- `/shutdown` remains token-protected, rejects mismatched browser origins, and sends no CORS headers. The monitor uses permission-restricted private state.
- The bridge limits export request bodies to 128 MiB and serves no arbitrary project files.

## Verification

- Test startup scanning, discovered-row selection, token-free connection messages, and successful connection without `figma.pluginId`.
- Test the URL-only manual path, download mode, bridge session/export CORS, request-size enforcement, and private monitor state.
- Run the plugin build, all test scripts, and a real Figma Desktop selection/export check when available.
