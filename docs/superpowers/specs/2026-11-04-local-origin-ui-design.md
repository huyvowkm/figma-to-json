# Token-free local bridge connection for Design to JSON

## Status

Proposed design. The user approved this direction on 2026-11-04. Product code has not changed for this design.

## Goal and constraints

- On every run in local-save mode, discover active local helpers and list them in the plugin.
- If discovery misses a helper, let the user add its local URL. Never ask for a token.
- Keep the existing download mode and active-folder selection flow.
- Keep all exported design data and the plugin UI local; do not add a developer-hosted UI or third-party data service.

## Design

The bundled plugin UI remains the discovery screen. Figma runs bundled plugin UIs in a null-origin iframe, so it cannot provide a dependable origin identity; Figma's network guide also requires wildcard CORS for these requests. The bundled screen uses that access only for token-free health metadata. Figma documents navigation to a custom UI URL and requires a plugin ID and specific target origin for sensitive messages from non-null-origin UIs. The manifest already allows the local bridge ports. See [Creating a UI](https://developers.figma.com/docs/plugins/creating-ui/), [Making network requests](https://developers.figma.com/docs/plugins/making-network-requests/), and [Plugin manifest network access](https://developers.figma.com/docs/plugins/manifest/).

When the user selects a discovered helper, or adds its URL, the plugin main code validates that it is `http://localhost` on a manifest-approved port and reloads the same UI from that helper's `/plugin-ui` route. The helper serves `exporter/ui.html`, so the interface is same-origin with the local API. The local-origin UI retrieves the token from `/session` and posts exports to `/export`; the token stays in that page's memory. No token is returned by discovery or written to Figma client storage.

Use Figma's documented non-null-origin message protections: the plugin main code targets messages to the local UI origin, and the local UI posts to Figma's documented origin with the Figma-assigned plugin ID. The manifest must contain that assigned ID before this message channel is enabled. If the ID is missing, keep the user on the bundled discovery UI and show a clear setup error instead of falling back to a token-bearing health response. The helper's UI response restricts frame ancestors to Figma. Confirm these settings in Figma Desktop, since the project has not yet tested localhost iframe navigation there.

## Bridge endpoints

- `GET /health` returns only the port, instance ID, project display name, export-folder display name, and shutdown support. It omits the token, absolute paths, and process IDs. It is the only endpoint with wildcard CORS.
- `GET /session` returns the current token only to same-origin local UI requests. It sends no CORS headers and rejects mismatched `Host`, `Origin`, or browser `Sec-Fetch-Site` values when those headers are present. The monitor, which is a local Node process, continues to use the permission-restricted state file for the shutdown token and full paths.
- `/export` and `/shutdown` retain token authorization and send no CORS headers. They reject mismatched local host/origin/fetch-site headers while allowing local non-browser monitor requests with no browser headers.
- Each export request is limited to 128 MiB; oversized requests receive HTTP 413 before parsing or writing.
- The helper serves the existing `exporter/ui.html` locally and sets a `Content-Security-Policy` `frame-ancestors` directive for Figma. It does not serve arbitrary files from the project or cache directory.

## UI and error behavior

- Starting the helper and refreshing the plugin continues to populate the active-folder list automatically. The list shows project and export-folder names, not full paths.
- Replace the current manual URL/token form with URL-only local-server entry. It accepts only `http://localhost` URLs on ports 3847–3867, matching the manifest. The selected local UI obtains the token same-origin.
- If the local UI cannot load or the helper is unreachable, show a message to start the helper or refresh. Never fall back to exposing the token in the bundled UI.
- If an export exceeds the limit, show a clear size error and preserve existing files.

## Private state and data handling

Keep the token, absolute project/export paths, and process metadata in the existing permission-restricted bridge-state file for the local monitor. The public health response contains no token or absolute path. Update the README and privacy policy to explain token-free discovery, same-origin local UI access, the remaining public health metadata, the 128 MiB limit, and local token storage/retention.

## Verification

- Bridge checks verify health contains no token, full path, or process ID; `/session` is same-origin only; `/export` and `/shutdown` stay protected; an oversized request returns 413 without writing files.
- Plugin checks verify discovery runs every time in local mode, selection loads the chosen local UI, manual fallback accepts URL only, the token never enters the bundled discovery UI or Figma client storage, and messages use the local origin and assigned plugin ID.
- Existing download, export, monitoring, shutdown, launcher cleanup, and path validation checks continue to pass.
- In Figma Desktop, verify the local-origin iframe loads, its message channel reaches the plugin main code, active-folder discovery works on each run, URL-only manual fallback works, and export saves only to the selected local helper.

## Remaining review questions

- The local-origin UI flow is based on Figma's documented custom-URL iframe behavior and localhost network access, but it must be tested in Desktop before release.
- The cross-origin health endpoint still exposes non-secret display names, port, and instance ID to origins able to reach localhost.
- Figma's separate eligibility rule about recreating MCP capabilities or working around paid features still needs Figma Support guidance.
