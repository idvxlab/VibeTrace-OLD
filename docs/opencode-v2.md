# OpenCode V2 integration

This is maintenance documentation: it explains the adapter and test scope, not
an executable configuration, skill, or runtime prompt. Installation instructions
for users are in README and [installation.md](installation.md).

This branch targets OpenCode 2.1.4 and uses `@opencode/plugin` and
`@opencode/client` 2.1.4. It does not implement a V1 server fallback. VibeTrace
releases use the independent `@xiaokeyan/opencode-v2-vibetrace` package. The original
`@xiaokeyan/opencode-vibetrace` package remains for V1. This beta covers the
V2 terminal client; desktop verification is not a release requirement.

The root `index.js` forwards to `plugins/vibetrace.mjs`. OpenCode 2.1.4's local
directory resolver looks for `server`/`index` at the directory root; package
exports alone did not load this checkout. Keep this root entrypoint in the npm
files list as well as the repository. Test direct-directory loading with
`VIBETRACE_TEST_SHARED=1 VIBETRACE_TEST_LOCAL_PACKAGE=1 npm run test:plugin`.

## Connection and lifecycle

`plugins/vibetrace.mjs` exports `Plugin.define({ id, setup })`. Setup starts
connection discovery in the background so it cannot block service registration.
The official `Service.discover()` API supplies the shared service URL and Basic
auth password. `server.info()` must report the same PID as the plugin host; an
endpoint for another installation is rejected. Standalone hosts can provide
`VIBETRACE_OPENCODE_URL` and `OPENCODE_PASSWORD` (or plugin options `serverUrl`
and `password`). Only loopback HTTP endpoints are accepted.

All locations in one OpenCode process share one VibeTrace runtime per endpoint.
The last plugin location unloading stops the owned runtime. The existing parent
process watchdog also stops it on host exit. Services belonging to another
process are not stopped. Credentials remain in the local backend.

## Browser opening belongs to the client

V2 terminal launches normally reuse the same long-lived server, so opening the
browser only in server `setup` does not work on subsequent terminal launches.
The TUI entry (`tui.js`) asks its connected server for the dashboard URL through
the `vibetrace.dashboard` RPC. Each TUI opens the browser once, after the dashboard
is ready. Ephemeral TUI storage prevents duplicate tabs on plugin reconciliation.
Server startup alone does not launch a browser. `VIBETRACE_NO_BROWSER=1` on the
client suppresses opening. Desktop activation is outside this beta's scope.

## UI and worker boundary

V2 has new native routes, paginated responses, and message shapes. Rather than
duplicating conversion in React and Python, `plugins/v2-api.mjs` translates the
private VibeTrace API into native V2 client operations:

- Session lists and messages follow cursors until all pages are read. Cursor
  requests omit the original ordering/filter arguments, as required by V2.
- Session locations, model references, assistant content, tool input/output,
  timestamps, and fork origins are mapped into the existing VibeTrace view model.
- Sending a message explicitly selects the model/agent before admitting a V2
  prompt. The response is asynchronous; the existing event/poll paths read it.
- Pending V2 forms become question items. String, multiselect, boolean, and
  numeric answers are mapped back to keyed V2 form answers. External form fields
  must be answered in OpenCode. V2 validation still enforces field constraints.
- Permission requests/replies use V2's session and request IDs.
- Native events become the envelopes expected by the UI; disconnects cause a
  fresh subscription. Events are live-only and do not replay. Slow consumers
  reconnect rather than creating an unbounded queue.
- Todos are read from completed todo tool inputs. V2 disables todo tools by
  default; absence of a plan does not mean the connection failed.

The runtime starts its HTTP adapter before Python and supplies that adapter URL
as Python's `OPENCODE_BASE`. Both `legacy` and `skill_evolve` therefore use the
same V2 connection without changing their algorithms or score thresholds.

## Local installation

Run `npm run plugin:doctor` to check the executables without registering a plugin.
Python discovery supports `python` / `py -3` / `python3` on Windows and `python3`
/ `python` elsewhere. Failed probes print OS-specific install guidance. The npm
`setup` command and `scripts/install.sh`, `.ps1`, `.cmd` share that check before
calling `opencode plugin add` with the package's exact version; `setup --local`
uses the managed checkout link instead. No system runtime is silently installed.
See [installation details](installation.md) and the platform commands in README.

`npm run plugin:install` writes a managed local package with server and TUI
entrypoints under `plugins/vibetrace/`, using absolute Node and Python paths. Remove the old V1 VibeTrace npm config entry
before activating the local copy to avoid duplicate/failed plugin loading.
Restart the V2 service to reload it. Global config edits and npm publication are
separate actions; building the source does not replace an installed npm package.

After publication, the user command is:

```sh
npx --yes @xiaokeyan/opencode-v2-vibetrace@1.0.1 setup
```

## Validation

`npm run build:plugin` builds the dashboard from the maintained TypeScript
sources, even if older generated JavaScript files remain beside them. These
generated copies are ignored by Git; root `index.js` and `tui.js` are maintained
plugin entrypoints and must be committed and packaged.

After building, `npm run test:composer` runs an isolated Chrome browser against
a local API fixture. It checks direct typing in an empty workspace, first-send
session creation, session reuse, draft recovery after creation failure,
navigation during creation, and the explicit New session button. Set
`VIBETRACE_TEST_CHROME` to a Chrome-compatible executable when needed. This test
does not use a real model or change the user's OpenCode configuration.

`npm run test:installer` checks Windows interpreter fallback and explicit path
failures, Node host rejection, real doctor/setup subprocesses with a fake OpenCode
command, registration failures, and local paths containing spaces. Actual Windows
shell execution and full Windows end-to-end validation remain outstanding.

`npm run test:plugin` uses a real OpenCode V2 server with temporary configuration,
data, and credentials. It tests plugin loading, static UI, Python health, session
CRUD and forks, imported history, asynchronous prompts, models, forms, permissions,
SSE, port conflicts, origin rejection, Python generation, and runtime cleanup.
Its local provider fixture does not send requests to external models.

`VIBETRACE_TEST_SHARED=1 npm run test:plugin` also exercises service discovery
using the actual service registration and its generated port/password. If the
installed Electron binary is available, tests check Node/Python startup under
that executable in Node mode. This is not full V2 Desktop interaction testing.

Sources: [plugin migration](https://opencode.ai/v2/docs/build/plugins/migrate-v1/),
[client and service discovery](https://opencode.ai/v2/docs/build/client/),
[server API](https://opencode.ai/v2/docs/api).
