# Local bridge pairing for Design to JSON

## Status

Proposed design. The user selected one-time pairing on 2026-11-04. No product code has been changed for this design yet.

## Goal

Keep automatic discovery and active-folder selection while preventing any webpage that can reach the local bridge from obtaining the export token. The first connection to each running bridge requires a user-entered pairing token. After pairing, exports use a token saved in Figma client storage. A helper restart rotates its instance ID and token, so that helper must be paired again.

Figma documents that a bundled plugin UI runs in a null-origin iframe and that plugin network requests need servers to allow wildcard CORS. Therefore, wildcard CORS remains. The security change removes secrets and absolute filesystem paths from the cross-origin discovery response instead of relying on an origin allowlist. References: [Creating a UI](https://developers.figma.com/docs/plugins/creating-ui/), [Making network requests](https://developers.figma.com/docs/plugins/making-network-requests/), and [OAuth with plugins](https://developers.figma.com/docs/plugins/oauth-with-plugins/).

## User flow

1. Start the local helper as today. It continues to print its random pairing token in the helper terminal.
2. The plugin automatically lists active folders using non-secret health metadata.
3. Selecting an unpaired folder opens an inline pairing prompt for that folder's token. A valid token pairs the current helper instance; an invalid token is rejected without saving it.
4. The plugin stores the token in `figma.clientStorage`, associated with the helper port and instance ID. The selected folder then works with the existing export button. Selecting a paired folder on later runs requires no token entry.
5. After the helper restarts, its new instance ID invalidates the stored pairing and the user pairs that instance again. Users can forget a pairing from the plugin.

Download mode and the existing explicit custom-server URL/token form remain unchanged.

## Bridge protocol and private state

- `GET /health` returns only the port, random instance ID, project display name, export-folder display name, and whether shutdown is supported. It returns no token, absolute path, or process ID. The UI uses display names instead of showing a full local path.
- Add `POST /pair`, which accepts the token in `X-Figma-Mcp-Token` and returns success only when it matches the current bridge. It never returns a token. `POST /export` and `POST /shutdown` keep requiring the token header.
- Keep wildcard CORS for Figma's null-origin plugin requests. Discovery data is non-secret; pairing and export operations require the out-of-band token.
- Keep the token, absolute project/export paths, and process metadata only in the permission-restricted local bridge-state file. The monitor uses that private state and its existing registrations to identify and stop new helpers. For older helpers that are already running, retain the current health-field fallback until those processes exit.
- Limit each export request body to 128 MiB. Oversized requests receive HTTP 413 and are not parsed or written.

## Error handling and privacy

- A missing or incorrect pairing token shows a short retry message and leaves the folder unpaired.
- A stale pairing after helper restart asks for the new terminal token; exports are never retried automatically.
- HTTP 413 explains that the export exceeded the helper's request limit and leaves existing files intact.
- Update the README and privacy policy to explain first-use pairing, plugin-scoped token storage, re-pairing after helper restart, and the remaining fact that wildcard CORS exposes non-secret bridge display metadata to origins able to reach localhost.

## Verification

- Bridge checks confirm health omits tokens and absolute paths, valid pairing succeeds, invalid pairing fails, and unpaired export/shutdown requests remain forbidden.
- A request over 128 MiB returns 413 without creating JSON or assets.
- Plugin checks confirm credentials are stored and retrieved through `figma.clientStorage`, are associated with the active instance, are not sent to the UI as discovery data, and stale instances require pairing again.
- Existing download, custom-server, export, monitor, shutdown, and cleanup checks continue to pass.
- Final manual verification in Figma Desktop checks first pairing, repeated use without re-entry, helper restart/re-pair, and the original active-folder selection flow.

## Review risks

One-time pairing stops a webpage from learning the bridge token through `/health`; it does not protect against same-user local processes that can inspect the helper terminal or private local state. Figma's review eligibility question about overlap with MCP or paid Figma features remains separate and should be sent to Figma Support before submission.
