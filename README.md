# VibeTrace: See how your agents think

Visualizing Agent Runtime Behavior for Human Intervention in Vibe Coding.

A web dashboard for **[OpenCode](https://opencode.ai/)** that connects to a local OpenCode HTTP server (REST + Server-Sent Events). VibeTrace gives developers a live, layered view of agent execution and supports **action-level process intervention** — fork, inspect, and steer runs without losing trajectory context.

---

## UI preview

<p align="center">
<img src="./fig/timeline-view.png" alt="VibeTrace action-flow view" width="100%" />
</p>

---

## Three core capabilities

### 1. Layered real-time execution visualization

VibeTrace turns raw OpenCode message streams into a structured, reviewable execution surface:

- **Task-aware session view** — Detects when the user switches tasks inside a session and surfaces each completed task as its own tab, so trajectories from different goals are not mixed together.
- **Subtask panels from todos** — Within a task, planner todos are materialized into subtask panels. Each panel shows the action-flow trace for that slice of work, making it easy to locate and audit specific steps.
- **Rich action-flow rendering** — Orthogonal layout of mapped tool/agent steps, branching forks, contextual tooltips, and click-to-focus linking between the flow, todos, and transcripts. **`Actions duration`** toggles between fixed step spacing and horizontally scaled blocks keyed to measured duration. **`Actions color`** switches the palette between **tokens** and **tool type** lenses. Toolbar **`timeline` / `summary`** changes how subtasks are arranged in the rail; fullscreen is available for the flow view.
- **Per-panel analysis** — Each subtask panel can show a trace summary and automated error diagnosis to help you understand what happened and where things went wrong.
- **Cross-linking** — Optional connectors from todo rows into a linked card **or into the focused action** when one is selected.

### 2. Action-level process intervention

Beyond observation, VibeTrace supports interactive steering grounded in the live trajectory:

- **Fork from any action** — Branch the session at a specific tool/agent step, capture a pre-fork panel snapshot, and continue in a new OpenCode session while preserving comparison context.
- **Trajectory-based branching** — Fork connectors and ghost trails show how a branched run diverges from the parent path, so you can experiment without losing sight of the original execution.


### 3. Continuous skill evolution

VibeTrace turns execution traces and feedback into reusable skills:

- **Learn from completed tasks** — Task-switch detection separates completed work from the next goal, providing task-level evidence for skill evolution.
- **Distill and refine skills** — The evolution pipeline evaluates trace evidence, distills candidate changes, scores them, and writes accepted changes to local skill files. Skills can be created, revised, merged, or removed as experience accumulates.
- **Learn from feedback** — Task-level and panel-level feedback can be distilled into reusable guidance, with links back to the source trajectory for review.

Analysis is triggered through the dashboard and uses models configured in OpenCode. Background model availability and quota affect whether analysis and evolution can complete; installing the plugin does not by itself train or change the underlying model.


---

## Installation & Running

### Install the plugin

**Requirements:** Node.js 20+, Python 3.9+, and OpenCode.
First check your OpenCode version:

```sh
opencode --version
```

**OpenCode V1: `1.18.29` or newer within `1.x`** — macOS / Linux / Windows:

```sh
opencode plugin @xiaokeyan/opencode-vibetrace@1.0.0 -g
```

For an older V1 release, update within the V1 line first.

**OpenCode V2: `2.x`** — beta, tested with the 2.1.4 terminal client:

macOS / Linux:

```sh
npx --yes @xiaokeyan/opencode-v2-vibetrace@next setup
```

Windows PowerShell / Command Prompt:

```powershell
npx.cmd --yes @xiaokeyan/opencode-v2-vibetrace@next setup
```

Fully restart OpenCode after installation. For V2, restart its shared service
with `opencode service restart` first. VibeTrace starts its services and opens
the dashboard automatically. Native Windows end-to-end validation is pending.

### Optional: choose a background analysis model

Both release lines use OpenCode's configured models. Background analysis defaults
to `opencode/big-pickle`. If it is unavailable or its quota is exhausted, choose a
working provider/model already configured in your OpenCode account.

macOS / Linux:

```bash
MW_OPENCODE_MODEL='your-provider/your-model' \
MW_SKILL_EVOLVE_MODEL='your-provider/your-model' \
opencode
```

Windows PowerShell:

```powershell
$env:MW_OPENCODE_MODEL = 'your-provider/your-model'
$env:MW_SKILL_EVOLVE_MODEL = 'your-provider/your-model'
opencode
```

Windows Command Prompt:

```bat
set "MW_OPENCODE_MODEL=your-provider/your-model"
set "MW_SKILL_EVOLVE_MODEL=your-provider/your-model"
opencode
```

These settings apply to the current terminal and its child processes. Fully exit
the previous OpenCode process or V2 service before restarting with new settings.
Use the provider ID and model ID separated by `/`. OpenCode supplies credentials;
background requests consume the selected provider's quota. The dashboard's chat
model is selected separately in the composer.

### Runtime and logs

Closing the browser leaves VibeTrace's services running. Stopping the owning
OpenCode process stops its VibeTrace services.

- **V1:** restart the owning OpenCode process to reopen the dashboard, or use its
  previous URL while the service is still running.
- **V2:** each new terminal client opens the dashboard through the TUI plugin,
  including when the shared OpenCode service is already running. In the updated
  V2 dashboard, an empty workspace accepts input directly and creates its first
  session when the first message is sent. Opening a folder alone adds no empty
  session; the **New session** button remains available.

Set `VIBETRACE_NO_BROWSER=1` to suppress automatic browser opening. Runtime logs
and analysis data are stored locally:

- **macOS:** `~/Library/Application Support/VibeTrace`
- **Linux:** `~/.local/state/vibetrace` (or `$XDG_STATE_HOME/vibetrace`)
- **Windows:** `%LOCALAPPDATA%\VibeTrace`

### Uninstall

**V1:** remove `@xiaokeyan/opencode-vibetrace` from your `opencode.json(c)` plugin list.

**V2:** remove the installed version (replace `1.0.0-beta.2` if different):

```sh
opencode plugin remove @xiaokeyan/opencode-v2-vibetrace@1.0.0-beta.2
```

**Local development install:** run from the source checkout:

```sh
npm run plugin:uninstall
```

Restart OpenCode afterwards (for V2, run `opencode service restart`).
Your chat history, analysis data, and skills are preserved.

### Develop from source — choose the matching branch

The repository contains two source branches, each building its own package.
Switching README content does not switch implementations. Use a separate clone
for each line if you want both development checkouts available at once.

**V1 source:**

```sh
git clone -b V1.5 https://github.com/idvxlab/VibeTrace.git VibeTrace-v1
cd VibeTrace-v1
npm install
npm run plugin:install
```

**V2 source:**

```sh
git clone -b V2 https://github.com/idvxlab/VibeTrace.git VibeTrace-v2
cd VibeTrace-v2
npm install
npm run plugin:install
```

Local installation builds the dashboard and creates a managed link to the checkout.
Keep that checkout in place. Remove an existing VibeTrace npm registration before
using a local link to avoid loading two copies. Restart the matching OpenCode
process/service after installing or changing the plugin.

For V2, the checkout also includes platform installer entrypoints after a build:

- macOS / Linux: `bash scripts/install.sh --local`
- Windows PowerShell: `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Local`
- Windows Command Prompt: `scripts\install.cmd --local`

All three call the same V2 setup logic. There is no separate Windows npm package
or hosted VibeTrace installer download URL. Interpreter-discovery simulation is
covered by tests; native Windows validation remains outstanding.

Useful commands available in both source lines include `npm run plugin:status`,
`npm run plugin:open`, `npm run build:plugin`, and `npm run test:plugin`. Check the
selected branch's `package.json` for its supported commands and test scope.

V2-specific verification uses isolated configuration and local provider fixtures:

```sh
npm run test:installer
npm run test:composer
npm run test:plugin
```

Build the dashboard before `test:composer`; it runs Chrome against a local API
fixture. `test:plugin` exercises a real OpenCode V2 server with a local model
fixture. Neither requires sending test prompts to an external model. The runtime
suite has Unix-specific fixtures; it does not prove full Windows or V2 desktop
interaction. See [V2 implementation and verification](https://github.com/idvxlab/VibeTrace/blob/V2/docs/opencode-v2.md).


---

## Tech stack

React 19 · TypeScript · Vite · Tailwind CSS 4 · d3 · react-tooltip

---

## License

[MIT](./LICENSE)
