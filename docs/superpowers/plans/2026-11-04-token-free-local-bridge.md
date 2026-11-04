# Implementation Plan: Token-free local bridge connection

**Date:** 2026-11-04
**Spec:** [Token-free local bridge connection](../specs/2026-11-04-local-origin-ui-design.md)
**Status:** Implemented; automated checks passed; Figma Desktop verification pending

## Goal

Keep the existing download and active-folder experience. On every local-save run, discover active localhost helpers automatically. Selecting a discovered helper, or entering a local URL manually, switches the plugin UI to that helper so it can retrieve the token same-origin and save exports without asking the user for credentials.

## Global constraints

- Never ask for or persist a token in the plugin UI or Figma client storage.
- Only accept `http://localhost` on ports 3847–3867 for UI navigation and manual entry.
- Do not serve project/cache files or add a hosted UI or third-party service.
- Keep wildcard CORS on token-free `/health` metadata only.
- Keep token, filesystem paths, and process details in the existing user-private state file.
- Do not invent a Figma plugin ID. If `figma.pluginId` is missing, stay on the bundled UI and explain that a Figma-assigned ID is required for secure local UI messaging.

## Review focus

- Verify `/health` cannot reveal the token, absolute paths, or process IDs, and only `/health` receives wildcard CORS.
- Verify `/session`, `/export`, and `/shutdown` reject mismatched browser origins/hosts while local monitor requests continue to work.
- Verify the bridge serves only the fixed plugin UI file and caps export request bodies before parsing or writing.
- Verify the token moves only from same-origin `/session` into local UI memory and never through the bundled UI, plugin messages, or client storage.
- Verify local-origin messages use Figma's assigned plugin ID and exact documented target origins.
- Preserve download mode, active-folder discovery, helper monitoring/shutdown, and existing export behavior.

## Task 1: Protect bridge endpoints and move monitor metadata to private state

**Files:** `bin/bridge.mjs`, `bin/bridge-state.mjs`, `bin/read-limited-body.mjs`, `bin/monitor.mjs`, `test/bridge-test.mjs`, `test/bridge-body-limit-test.mjs`, `test/monitor-test.mjs`, `test/launcher-cleanup-test.mjs`.

1. **Add regression checks first.** Update bridge and monitor tests to require redacted health metadata, token-free terminal output, same-origin session access, no CORS on sensitive endpoints, rejection of mismatched `Host`/`Origin`/`Sec-Fetch-Site`, authenticated exports and shutdown, monitor requests without browser headers, and private-state-backed monitor discovery/stop. Add a request over 128 MiB and assert HTTP 413 with no files written. Check the fixed `/plugin-ui` route returns the UI with a Figma-only `frame-ancestors` policy and does not expose arbitrary file paths.
   - Run `node test/bridge-test.mjs`, `node test/bridge-body-limit-test.mjs`, and `node test/monitor-test.mjs`.
   - Expected before implementation: failures identify the existing token/path health fields, unrestricted CORS, absent `/session` and `/plugin-ui`, and missing size cap.
2. **Implement the bridge boundary.** Make response headers route-specific. Return only port, instance ID, display names, and shutdown support from `/health`; retain wildcard CORS there only. Add guarded `/session` and fixed-file `/plugin-ui` routes. Protect browser requests to `/session`, `/export`, and `/shutdown` using local host/origin/fetch-site checks, while allowing authenticated local Node monitor calls without browser headers. Enforce the 128 MiB limit from both `Content-Length` and streamed bytes before JSON parsing or writes. Stop printing the token.
3. **Move monitor-only details into private state.** Store root/export paths, process IDs, start time, port, instance ID, and token in the existing permission-restricted state file. Update `monitor.mjs` and occupied-port duplicate detection to read these values from private state. Never use a token returned by health; tolerate older health metadata only as needed for status compatibility.
   - Run `node test/bridge-test.mjs`, `node test/monitor-test.mjs`, `node test/launcher-cleanup-test.mjs`, and `node test/bridge-port-retry-test.mjs`.
   - Expected: all pass; health contains no secret/path/PID, the monitor still identifies and stops its own helper, and oversize requests write nothing.

## Task 2: Implement token-free discovery and local-origin UI messaging

**Files:** `exporter/code.ts`, generated `exporter/code.js`, `exporter/ui.html`, `test/exporter-connection-test.mjs`, `test/exporter-context-test.mjs`, `test/exporter-svg-test.mjs`, new `test/exporter-ui-test.mjs`.

1. **Add regression checks first.** Cover per-run local-mode discovery, health results without credentials or paths, the URL-only manual fallback, rejection of non-local/out-of-range URLs, missing-plugin-ID fallback, navigation to the selected fixed `/plugin-ui` route, and exact message origins/plugin ID. Check that the bundled UI never receives a token, the local UI gets it only from same-origin `/session`, local exports POST directly to `/export`, and no token enters Figma client storage. Preserve download and existing JSON/assets/preview export cases.
   - Run `node test/exporter-connection-test.mjs`, `node test/exporter-context-test.mjs`, `node test/exporter-svg-test.mjs`, and `node test/exporter-ui-test.mjs`.
   - Expected before implementation: failures identify the bundled token flow and current manual URL-plus-token form.
2. **Implement the two-stage UI flow.** Keep bundled UI for token-free discovery and URL-only fallback. Validate the helper URL again in plugin main code. On selection, require `figma.pluginId` and reload the same UI from the helper's `/plugin-ui` URL; if the ID is missing or navigation does not complete, return to the bundled UI with an actionable setup/retry message. On the local-origin page, fetch `/session` into page memory and send prepared exports directly to the same-origin `/export` endpoint. Keep connection mode as the only Figma client-storage preference.
3. **Secure message routing.** Add one small main-code wrapper for `figma.ui.postMessage` that targets the selected helper origin after navigation. Local-origin UI messages include the assigned plugin ID and target `https://www.figma.com`; bundled discovery messages carry no secret. Keep the helper URL restricted to the manifest-approved port range. The current manifest already permits these localhost ports; do not add a placeholder plugin ID. If Figma has assigned an ID before implementation, add that real ID to the manifest.
   - Run `npm run build --prefix exporter`, then rerun the four plugin tests above.
   - Expected: TypeScript compilation and plugin checks pass; no token is present in Figma client storage or a plugin message.

## Task 3: Update user-facing data and connection documentation

**Files:** `README.md`, `PRIVACY_POLICY.md`.

1. Update local setup instructions to say that discovery is automatic on each local-save run, manual fallback asks only for a localhost URL, and no token needs to be copied. Explain that the helper serves the UI and keeps the token in a permission-restricted temporary file for monitor shutdown.
2. Update privacy details for the public health fields, same-origin token retrieval, localhost-only request guards, 128 MiB request limit, export destinations, and data retention. Remove the obsolete statement that any cross-origin page can retrieve the token.
3. Review the diff for duplicate or contradictory instructions and run `git diff --check`.

## Task 4: End-to-end verification and handoff

1. Run `npm run build --prefix exporter`, all nine existing test scripts and both new tests, and `git diff --check`.
2. In Figma Desktop, verify discovery on every run, local UI navigation, message delivery, URL-only fallback, export to the selected helper, download mode, missing-helper recovery, and that no token prompt appears. This requires a Figma-assigned plugin ID; keep the safe bundled-UI error until that ID is present.
3. Inspect the final diff and report the Desktop checks that did or did not run. Do not claim local-origin navigation verified unless it was actually tested in Figma Desktop.

## External reference checks

- [Figma UI and non-null origin messaging](https://developers.figma.com/docs/plugins/creating-ui/)
- [Figma network access and null-origin CORS](https://developers.figma.com/docs/plugins/making-network-requests/)
- [Figma manifest and assigned plugin ID](https://developers.figma.com/docs/plugins/manifest/)
- [Figma `figma.ui.postMessage` origin option](https://developers.figma.com/docs/plugins/api/properties/figma-ui-postmessage/)
