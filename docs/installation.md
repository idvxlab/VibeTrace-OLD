# V2 installation and packaging

Updated 2026-11-02. This checkout is a V2-only prerelease (`1.0.0-beta.2`). No npm
publication is performed by building, diagnosing, or installing a local link.
Its package name is `@xiaokeyan/opencode-v2-vibetrace`; the V1 package remains
`@xiaokeyan/opencode-vibetrace`. The executable command is still `vibetrace`.

## What ships

One npm package contains the server and TUI plugin entrypoints, built dashboard,
Python worker and prompts, a shared `vibetrace` command, and three small installer
entrypoints: `scripts/install.sh`, `scripts/install.ps1`, and `scripts/install.cmd`.
The OpenCode client/plugin libraries are package dependencies, not manual user
setup steps. Node and Python executables are not bundled or automatically installed.

An `install.cmd` file is a Windows installer **script**, not a package format.
Plannotator uses scripts to download an already-built executable and configure
agent integrations. VibeTrace's scripts instead invoke the same JS setup command
and register its npm package with OpenCode. npm already supplies package download
and dependency resolution. OS-specific scripts do not imply OS-specific npm packages.

Our scripts currently live in the repository and npm file list; no public
download endpoint has been deployed. Do not invent a hosted installer URL.

## Management commands

In a checkout, run `node scripts/vibetrace.mjs <command>`. After publication,
`npx --yes @xiaokeyan/opencode-v2-vibetrace@1.0.0-beta.2 <command>` invokes the
same CLI; use `npx.cmd` on Windows. Commands are:

- `doctor` (optionally `--json`): check Node, Python and OpenCode versions, without
  registering a plugin or starting services. It does not test model credentials.
- `setup`: check the environment and register this package's exact name/version
  through `opencode plugin add`. That version must already exist on npm.
- `install` or `setup --local`: create the managed local wrapper pointing at
  this code directory, with resolved Node/Python paths. A built dashboard is
  required; `setup --local` also checks the OpenCode version first.
- `status`: show this installation's local wrapper and any matching live runtimes.
- `open`: open the matching running dashboard(s); it does not start a backend.
- `stop`: stop matching VibeTrace runtimes, leaving OpenCode running. Restart
  OpenCode to load the plugin again if needed.
- `uninstall`: remove only the wrapper managed by the local installer, preserving
  data. It does not unregister npm or a manually configured source path. npm
  registration is removed using OpenCode's `plugin remove` command.

Current runtime discovery is scoped to the code directory. If npx and OpenCode
use different cached copies, `status` / `open` / `stop` do not yet manage across
those copies. Use the same installation path that owns the runtime; unified
management across installation modes remains planned work.

The three platform scripts all delegate to `setup`; choose **one**, matching your
shell, rather than running all three. The PowerShell script also supports
`-CheckOnly` for diagnosis and `-Local` for a checkout. Shell/CMD accept `--local`.
Scripts are convenience entrypoints, not separate copies of the plugin.

## Requirements and checks

- OpenCode V2 terminal client, tested with 2.1.4. Desktop is outside this beta's scope.
- Standalone Node.js 20+; npm/npx for the npm setup entrypoint.
- Python 3.9+ with the worker's standard-library modules available.
- A browser for the dashboard and a usable OpenCode model for chat/analysis.

`npm run plugin:doctor` checks executable availability and versions, prints the
resolved Node/Python paths and exits nonzero when prerequisites are missing.
`node scripts/vibetrace.mjs doctor --json` returns the same report as JSON. It does
not start the server, send model requests, or change plugin configuration.
OpenCode's version command may write its own diagnostic log.

Python search order is `python`, `py -3`, `python3` on Windows and `python3`,
`python` elsewhere. Candidates must actually execute and report a suitable version.
The resolved executable is used directly, including paths with spaces. Set `PYTHON`
to an executable path or the plugin's `python` option to override; do not put
`py -3` into that path setting. `VIBETRACE_NODE` or the `node` plugin option selects
a standalone Node executable. An explicit invalid override fails with guidance
instead of silently choosing something else. Probe timeouts prevent endless waits.
Automatic runtime provisioning by Python's install manager is disabled during probes.

Node discovery rejects Electron/Bun host executables. Local installation pins the
resolved Node and Python paths in its managed wrapper. npm setup currently relies
on the OpenCode host's environment (or explicit plugin options); it does not yet
persist a separate runtime-path configuration for GUI applications.

The plugin also checks runtimes at startup. Checks cannot depend on `postinstall`
alone because a host can skip npm lifecycle scripts. Missing runtime errors are
reported without repeating the same probe 30 times. Model/provider access remains
a separate runtime concern: successful executable checks do not prove model quota.

## Missing runtimes

The installer prints commands; it does not execute them automatically.

macOS, with Homebrew already installed:

```bash
brew install node python
```

Without Homebrew, use the official [Node](https://nodejs.org/en/download) and
[Python for macOS](https://www.python.org/downloads/macos/) installers.

Windows PowerShell or Command Prompt, with WinGet available:

```powershell
winget install --exact --id OpenJS.NodeJS.LTS
winget install --exact --id Python.Python.3.13
```

Otherwise use the official [Node](https://nodejs.org/en/download) and
[Python for Windows](https://www.python.org/downloads/windows/) installers. Open
a new terminal afterwards; fully exit and restart OpenCode's server as well so
it receives the new environment. Never copy a Mac-specific absolute path to Windows.

See the [README](../README.md#installation--running) for npm setup, local setup,
environment-variable examples, and uninstall commands for each shell.

## Validation still required before release

The Mac installer and isolated V2 runtime are tested locally. Unit tests simulate
Windows interpreter discovery, but they cannot prove PowerShell/CMD execution,
Windows service lifecycle, or browser opening. Native Windows validation is
planned after the Mac terminal beta; do not claim verified Windows support yet.
The existing integration suite has Unix-specific fixtures.

Before publication, create a tarball and install it in an isolated environment,
test both direct registration and guided setup, inspect its file list for source
secrets/logs, verify package removal, and test a real accepted skill write. Keep
the npm prerelease on `next`. The separate V1 package and its `latest` tag remain
unchanged. These are release tasks, not automatic actions.
