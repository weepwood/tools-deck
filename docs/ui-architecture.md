# Tools Deck UI Architecture

## Information architecture

The desktop interface separates tool discovery from tool execution:

- **Home**: active tasks, latest run, favorites and recent tools.
- **Library**: search, category filters and grid/list browsing.
- **Workspace**: a full-width focused page for one tool.
- **Tasks**: queue management and retry/removal actions.
- **History**: restore parameters from previous runs.
- **Settings**: theme, sidebar and runtime information.

## Global surfaces

### Command palette

`Ctrl/Cmd + K` opens a global palette for tools, pages and application commands.

### Activity drawer

The activity drawer is available from every page. It shows the active standalone run and pending/running queue items without forcing navigation away from the current workspace.

### Sidebar

The sidebar supports expanded, collapsed and mobile drawer states. The collapsed preference is persisted in LocalStorage.

## Runtime state rules

- A standalone tool run and the sequential queue cannot run at the same time because they share the cancellation controller.
- Switching pages or opening another tool does not cancel or hide the active background task.
- Run results and logs are only rendered in the workspace that owns the corresponding `toolId`.
- Existing LocalStorage keys and the Tauri IPC protocol remain compatible with v0.4.0.

## Tool workspace templates

The first redesign phase provides two templates:

- **Text editor workspace** for JSON formatting, with input and output panes.
- **Form workspace** for file, data, network and developer tools.

Future phases can add dedicated batch-file and inspection-result templates without changing the Rust execution protocol.
