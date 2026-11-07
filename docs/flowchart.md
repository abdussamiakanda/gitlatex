# GitLaTeX — Architecture and Control-Flow Charts

This document describes how GitLaTeX works, in a set of flowcharts. It is
written for engineers who are new to the codebase. Each diagram covers one
subsystem, and file paths point to where the code lives. The diagrams are
written in [Mermaid](https://mermaid.js.org/), which GitHub, VS Code and most
Markdown viewers render.

**Contents**

1. [System overview](#1-system-overview)
2. [Server startup](#2-server-startup)
3. [HTTP request dispatch](#3-http-request-dispatch)
4. [Client boot and opening a project](#4-client-boot-and-opening-a-project)
5. [Edit → save → auto-compile loop](#5-edit--save--auto-compile-loop)
6. [Compile: choosing a backend](#6-compile-choosing-a-backend)
7. [Local TeX build loop (server)](#7-local-tex-build-loop-server)
8. [In-browser TeX build loop (WebAssembly worker)](#8-in-browser-tex-build-loop-webassembly-worker)
9. [Engine and package-shelf proxy cache](#9-engine-and-package-shelf-proxy-cache)
10. [Git: push and pull with rebase](#10-git-push-and-pull-with-rebase)
11. [SyncTeX: source ↔ PDF](#11-synctex-source--pdf)
12. [Live collaboration](#12-live-collaboration)
13. [Build and release pipeline](#13-build-and-release-pipeline)

---

## 1. System overview

GitLaTeX has three parts:

- a **local Python/Flask server** (`gitlatex/`) that owns the disk, Git and local TeX
- a **React single-page app** (`web/`, built into `gitlatex/ui/`) that runs in the browser
- an optional **Cloudflare Worker** (`collab-worker/`) that relays live-collaboration edits

```mermaid
flowchart LR
    subgraph Browser["Browser (React SPA — web/src)"]
        UI["UI components<br/>components/*.tsx"]
        Store["Global store<br/>state/store.ts"]
        Actions["Controller<br/>state/actions.ts"]
        WS["Workspace (in-memory project)<br/>state/workspace.ts"]
        Monaco["Monaco editor / LyX editor<br/>editor/*, lyx/*"]
        PDF["pdf.js viewer<br/>pdf/*"]
        EC["EngineClient<br/>engine/EngineClient.ts"]
        Worker["Web Worker: TeX in WASM<br/>engine/tex.worker.ts + compiler.ts"]
        Collab["Yjs collab session<br/>collab/session.ts"]
        API["HTTP client<br/>storage/server.ts"]
    end

    subgraph Server["Local server (Python / Flask — gitlatex/)"]
        Flask["Flask app<br/>app.py"]
        Routes["Blueprints<br/>routes/*.py"]
        Services["Services<br/>services/*.py"]
        State["Process state + project_lock<br/>state.py"]
    end

    Disk[("Project folders<br/>./repos/&lt;name&gt;")]
    Cache[("~/.gitlatex<br/>engine, shelf, snippets, dictionary")]
    TeX["Local TeX<br/>pdflatex / xelatex / lualatex<br/>bibtex / biber"]
    GitBin["git CLI via GitPython"]
    Remote[("Git remote<br/>e.g. GitHub")]
    Upstream["BusyTeX engine build +<br/>package shelf on the web"]
    Zotero["Zotero desktop app<br/>localhost"]
    Relay["Collab relay<br/>Cloudflare Worker + Durable Object"]
    CompAPI["Optional remote<br/>Compiler API"]

    UI <--> Store
    UI --> Actions
    Actions <--> WS
    Actions --> EC --> Worker
    Monaco <--> WS
    Actions --> PDF
    WS --> API
    Actions --> API
    Collab <--> Monaco
    Collab <-->|WebSocket| Relay
    Actions -->|fetch| CompAPI

    API <-->|"JSON over HTTP"| Flask
    Worker -->|"GET /engine, /shelf"| Flask
    Flask --> Routes --> Services
    Routes --> State
    Services --> Disk
    Services --> TeX
    Services --> GitBin --> Disk
    GitBin <--> Remote
    Services --> Zotero
    Routes -->|"proxy + cache"| Upstream
    Routes --> Cache
```

**Key design points**

- The server holds one *current project* (`state.current_repo_path`). Opening a
  project selects it for every later file, compile, Git and SyncTeX route.
- Every route that changes project files is serialised by a single re-entrant
  lock, `state.project_lock`, applied by the `@with_project_lock` decorator
  (`gitlatex/http.py`). This covers Git, compiles, PDF saves and writes.
- The browser keeps the whole project in memory (`Workspace`) and writes changes
  back to disk through a serial queue, so Git always sees what the editor shows.

---

## 2. Server startup

Entry point: `gitlatex` → `gitlatex/server.py:main`.

```mermaid
flowchart TD
    A(["$ gitlatex [--port] [--host] [--repos] [--no-browser] [--fetch-engine]"]) --> B["_check_dependencies():<br/>import flask, git"]
    B -->|missing| B1["Print install hint<br/>sys.exit 1"]
    B -->|ok| C["argparse"]
    C --> D{"--fetch-engine?"}
    D -->|yes| E["routes/engine.fetch_engine():<br/>download all engine assets<br/>into ~/.gitlatex/engine, check SHA-256"] --> E1(["exit 0"])
    D -->|no| F["run_server()"]
    F --> G["app.create_app(repos_dir)"]
    G --> G1["Flask(static_folder=None)<br/>MAX_CONTENT_LENGTH = 50 MB"]
    G1 --> G2["state.BASE_DIR = abspath(--repos or ./repos)<br/>makedirs"]
    G2 --> G3{"public/ dir exists?"}
    G3 -->|no| G4["raise FileNotFoundError"]
    G3 -->|yes| G5["register_blueprints(app)<br/>15 blueprints, pages last"]
    G5 --> G6["after_request: CORS headers<br/>before_request: OPTIONS→204, log non-static paths"]
    G6 --> H{"open browser?"}
    H -->|yes| H1["daemon thread: sleep 1.2 s,<br/>webbrowser.open(url)"]
    H -->|no| I
    H1 --> I["app.run(threaded=True, use_reloader=False)"]
    I --> J(["Serving on http://127.0.0.1:5000"])
```

---

## 3. HTTP request dispatch

The routes are split into blueprints, one per UI area (`gitlatex/routes/__init__.py`).
`pages` is registered **last** because its catch-all `/<path>` route serves the SPA.

```mermaid
flowchart TD
    R(["Incoming HTTP request"]) --> O{"method == OPTIONS?"}
    O -->|yes| O1(["204 (CORS preflight)"])
    O -->|no| P{"GET / ?"}
    P -->|yes| IDX
    P -->|no| M{"Matches a blueprint route?"}

    M -->|"/repos, /clone, /select-repo,<br/>/delete-repo, /create-workspace"| BR["repos.py"]
    M -->|"/api/project/*, /api/fs/*"| BW["workspace.py<br/>(file API used by web/)"]
    M -->|"/file, /save, /files, /upload,<br/>/move, /delete, ..."| BF["files.py<br/>(classic UI file API)"]
    M -->|"/compile, /pdf/*, /save-pdf"| BC["compile.py"]
    M -->|"/push, /pull, /status,<br/>/commits, /diff, ..."| BG["git.py"]
    M -->|"/api/scm/*"| BS["scm.py<br/>Source control panel"]
    M -->|"/synctex/forward, /synctex/inverse"| BX["synctex.py"]
    M -->|"/review/*"| BRV["review.py"]
    M -->|"/spell/*"| BSP["spell.py"]
    M -->|"/snippets"| BSN["snippets.py"]
    M -->|"/project-index"| BPI["projectindex.py"]
    M -->|"/api/zotero/*"| BZ["zotero.py"]
    M -->|"/engine/*, /shelf/*"| BE["engine.py"]
    M -->|"/api/info, /api/update-check"| BSY["system.py"]
    M -->|"anything else"| PG["pages.py: /&lt;path&gt;"]

    BC & BG & BS & BW --> L["@with_project_lock<br/>(state.project_lock RLock)"]
    L --> SV["services/*.py"]

    PG --> F1{"file exists in<br/>gitlatex/ui/ or public/?"}
    F1 -->|yes| F2(["send_file<br/>/assets/* cached immutable"])
    F1 -->|no| F3{"path ends in an<br/>asset extension?"}
    F3 -->|yes| F4(["404"])
    F3 -->|no| IDX{"Built UI present?<br/>(gitlatex/ui/index.html)"}
    IDX -->|yes| IDX1(["Serve new React UI"])
    IDX -->|no| IDX2(["Serve classic UI<br/>public/index.html"])
```

The **classic UI** (`gitlatex/public/`, plain JS) is still served at `/classic`,
and at `/` when the React build is missing. The rest of this document describes
the React UI in `web/`.

---

## 4. Client boot and opening a project

Code: `web/src/main.tsx` → `App.tsx` → `state/actions.ts` (`boot`, `openProject`).

```mermaid
flowchart TD
    A(["Browser loads index.html"]) --> B["main.tsx: effect-guard,<br/>render &lt;ErrorBoundary&gt;&lt;App/&gt;"]
    B --> C["App: useEffect → actions.boot()"]
    C --> D["GET /repos → store.projects"]
    D --> E{"Last project in<br/>localStorage?"}
    E -->|no| HOME["Render ProjectsHome<br/>(list, create from template,<br/>clone, import zip)"]
    E -->|yes| OP
    HOME -->|"user picks / creates / clones"| OP

    OP["actions.openProject(id)"] --> OP1["flush previous Workspace,<br/>stopCollab(), engine.cancel()"]
    OP1 --> OP2["Workspace.open(name)"]
    OP2 --> S1["POST /api/project/open"]
    S1 --> S2["server: state.current_repo_path = dir<br/>read every file (text / base64 / omitted if large)<br/>install comments merge driver if .git"]
    S2 --> OP3["Build in-memory Map&lt;path, MemFile&gt;<br/>guess main file & engine if unknown"]
    OP3 --> OP4["bindWorkspace + subscribe to changes<br/>(meta / tree / content)"]
    OP4 --> OP5["setState: project, tabs, activePath"]
    OP5 --> P1["refreshScm()<br/>GET /api/scm/status"]
    OP5 --> P2{"collab enabled<br/>for this project?"}
    P2 -->|yes| P2a["rejoinCollab()"]
    OP5 --> P3["showExistingPdf():<br/>load main.pdf + main.synctex.gz from disk"]
    OP5 --> P4["warmUpEngine():<br/>boot WASM worker on idle,<br/>only if compiler = browser"]
    OP5 --> P5["compile(reason='open')"]
    P5 --> RENDER["Render editor layout:<br/>TopBar · Sidebar · EditorPane | PdfPane ·<br/>BottomPanel · StatusBar"]
```

---

## 5. Edit → save → auto-compile loop

```mermaid
flowchart TD
    K(["User types in Monaco<br/>(or LyX editor, or a collab peer's edit arrives)"]) --> M["Monaco model changes"]
    M --> W["Workspace.setText(path)<br/>mark dirty, notify 'content'"]
    W --> Q["Debounced write, put on the serial queue"]
    Q --> Q1["POST /api/fs/write<br/>(project_lock held on server)"]
    Q1 --> DISK[("File on disk<br/>visible to git")]
    W --> N["Subscriber in actions.ts"]
    N --> N1["compile.dirtySinceCompile = true"]
    N --> N2["scheduleScmRefresh()"]
    N --> N3{"settings.autoCompile?"}
    N3 -->|no| WAIT(["Wait for Ctrl/Cmd+S or Ctrl+Enter<br/>→ compile(reason='manual')"])
    N3 -->|yes| T["setTimeout(autoCompileDelay)<br/>→ compile(reason='auto')"]
    T --> C["compile()"]
    WAIT --> C
    C --> CR{"another compile<br/>already running?"}
    CR -->|yes| CR1["pending = {clean}<br/>(coalesce; rerun when done)"]
    CR -->|no| CC["see §6"]
```

Other editor services that run while typing (all in `web/src/editor/`):
spell checking (`POST /spell/check`), autocomplete from labels and BibTeX keys,
snippets (`/snippets`), review comments (`/review/*`), outline, Vim/VimTeX
key maps, and conflict-marker tools.

---

## 6. Compile: choosing a backend

Code: `web/src/state/actions.ts` (`compile`, `resolveCompiler`, `buildLocally`,
`buildInBrowser`, `buildViaApi`).

```mermaid
flowchart TD
    A(["compile({reason, clean})"]) --> B{"ws open?"}
    B -->|no| Z(["return"])
    B -->|yes| C["resolveCompiler(engine)"]
    C --> C1{"settings.compiler"}
    C1 -->|local / browser / api| D
    C1 -->|auto| C2["GET /api/info (cached)<br/>is pdflatex / xelatex / lualatex on PATH?"]
    C2 -->|yes| D1["local"]
    C2 -->|no| D2["browser"]
    D1 & D2 --> D
    D{"reason=open AND autoCompile off<br/>AND engine not ready?"} -->|yes| Z
    D -->|no| E{"running?"}
    E -->|yes| E1(["pending = clean; return"])
    E -->|no| F["running = true; generation++<br/>status = running<br/>ws.flush() → every write is on disk"]
    F --> G{"backend"}
    G -->|local| L["buildLocally:<br/>POST /compile {main, engine}<br/>then GET raw main.pdf + main.synctex.gz"]
    G -->|browser| BB["buildInBrowser:<br/>engine.compile({files, mainFile, engine,<br/>bibtex, maxPasses: 5, synctex, useShelf})"]
    G -->|api| AP["buildViaApi:<br/>POST {main, files, engine} to the user's<br/>Compiler API (+ Bearer key)"]
    BB --> SV{"PDF and persist<br/>and savePdf?"}
    AP --> SV
    SV -->|yes| SV1["POST /api/save-pdf<br/>(PDF + SyncTeX → project folder)"]
    L & SV & SV1 --> R{"project switched or<br/>Stop pressed meanwhile?<br/>(generation check)"}
    R -->|yes| X(["discard result"])
    R -->|no| P["Parse diagnostics:<br/>parseTexLog + parseBibtexLog +<br/>unresolved packages + notices"]
    P --> S["SyncTex.fromGzip(result.synctex)"]
    S --> U["patchCompile: status, pdf, pdfVersion++,<br/>synctex, diagnostics"]
    U --> V["applyMarkers(): squiggles in Monaco<br/>Problems list in BottomPanel"]
    V --> W{"reason != open<br/>and PDF + SyncTeX?"}
    W -->|yes| W1["followCursor():<br/>scroll PDF to the cursor line"]
    W --> FIN
    W1 --> FIN["finally: running = false<br/>if pending → compile(reason='auto')"]
```

**Cancelling.** In the browser, `EngineClient.cancel()` terminates the worker,
because a TeX run in WebAssembly cannot be interrupted, and boots a new one from
the cache. Local and API builds cannot be stopped. `generation++` makes the UI
ignore their results.

---

## 7. Local TeX build loop (server)

Code: `gitlatex/routes/compile.py` → `gitlatex/services/latex.py:run_latex_build`.
The rules are the same as latexmk's: a pass is repeated only while the files TeX
reads back change.

```mermaid
flowchart TD
    A(["POST /compile {main, engine}"]) --> A1{"repo selected?"}
    A1 -->|no| A2(["400"])
    A1 -->|yes| A3["acquire project_lock<br/>engine ∈ {pdflatex, xelatex, lualatex} else pdflatex"]
    A3 --> B["xdv = engine is xelatex<br/>and xdvipdfmx is on PATH"]
    B --> C["before = SHA1 digest of tracked files<br/>.aux .toc .lof .lot .out .bbl .nav .snm .ind .gls .acr<br/>+ \\include'd .aux"]
    C --> D["Engine pass 1:<br/>engine -interaction=nonstopmode -file-line-error<br/>-synctex=1 [-no-pdf] main.tex<br/>(timeout 180 s)"]
    D --> E{"main.bcf exists?"}
    E -->|yes| E1["bib tool = biber"]
    E -->|no| E2{"\\bibdata in .aux?"}
    E2 -->|yes| E3["bib tool = bibtex"]
    E2 -->|no| LOOP
    E1 & E3 --> F["sig = hash(citations + tool binary mtime)<br/>+ hash(.bib contents)"]
    F --> G{"same sig as last run<br/>and last run failed?"}
    G -->|yes| G1["Record step 'not rerun',<br/>report the cached error"]
    G -->|no| H{"sig changed, first run,<br/>or .bbl missing?"}
    H -->|no| LOOP
    H -->|yes| I["Run biber / bibtex<br/>remember sig, exit code, error"]
    I -->|FileNotFoundError| I1["step.missing = true"]
    G1 & I & I1 --> LOOP
    LOOP{"passes &lt; 5 AND<br/>tracked digest changed?"}
    LOOP -->|yes| RR["Engine rerun; passes++"] --> LOOP
    LOOP -->|no| X{"xdv and main.xdv exists?"}
    X -->|yes| X1["xdvipdfmx → main.pdf"]
    X -->|no| PL
    X1 --> PL["Read main.log<br/>parse_latex_log → problems [file, line, message, severity]"]
    PL --> Q{"main.pdf exists?"}
    Q -->|no| Q1["error = first error problem<br/>or 'no PDF produced'"]
    Q -->|yes| Q2{"last step exit code ≠ 0<br/>and an error problem?"}
    Q2 -->|yes| Q3["error = first error message"]
    Q2 -->|no| OK
    Q1 --> FAIL(["500 {error, log, problems, steps}"])
    Q3 --> FAIL
    OK(["200 {success, pdf: /pdf/main.pdf,<br/>log, problems, steps}"])
```

---

## 8. In-browser TeX build loop (WebAssembly worker)

Code: `web/src/engine/` — `EngineClient.ts` (UI thread) ⇄ `tex.worker.ts` →
`compiler.ts` (`TexCompiler`) → `busytex-host.ts` (BusyTeX WASM: pdfTeX, XeTeX,
bibtex8, makeindex, xdvipdfmx).

```mermaid
flowchart TD
    A(["EngineClient.compile(req)"]) --> B{"worker booted?"}
    B -->|no| B1["new Worker(tex.worker.ts)<br/>post init {manifestUrl, shelfUrl}"]
    B1 --> B2["Worker: loadManifest(/engine/manifest.json)<br/>fetch WASM + data packages (CacheStorage)<br/>open PackageShelf index (/shelf/index.json)"]
    B2 --> B3["progress events → status bar"]
    B3 --> C
    B -->|yes| C["post {type: compile, id, req}<br/>start timeout guard"]
    C --> D["TexCompiler.compile(req)"]
    D --> D1["Sync files into the in-memory FS<br/>(FNV-1a fingerprint, so only changed files are written)"]
    D1 --> D2["scanSources(): predict \\usepackage files,<br/>fonts, biblatex backend"]
    D2 --> D3["Mount predicted collections /<br/>shelf bundles (+ font-map overlay)"]
    D3 --> D4{"biblatex backend = biber?"}
    D4 -->|yes| D5["notice: biber cannot run in the browser,<br/>use backend=bibtex"]
    D4 --> LOOP
    D5 --> LOOP
    LOOP["Run TeX pass"] --> M{"log: missing file or font?<br/>(findMissing)"}
    M -->|"yes, resolvable"| M1["Fetch shelf bundle / collection,<br/>add to 'fetched'"] --> LOOP
    M -->|"yes, unknown"| M2["add to 'unresolved'"]
    M -->|no| BIB
    M2 --> BIB{"\\bibdata in .aux and<br/>bibtex inputs key changed?"}
    BIB -->|yes| BIB1["bibtex8 --8bit --huge job.aux"] --> RR
    BIB -->|no| IDX{"index (.idx) changed?"}
    IDX -->|yes| IDX1["makeindex"] --> RR
    IDX -->|no| LBL{"labels / aux changed<br/>and passes &lt; maxPasses?"}
    LBL -->|yes| RR["rerun TeX"] --> M
    LBL -->|no| XE{"XeTeX?"}
    XE -->|yes| XE1["xdvipdfmx: .xdv → .pdf"]
    XE -->|no| OUT
    XE1 --> OUT["Collect PDF, .synctex.gz, logs, steps,<br/>fetched, unresolved"]
    OUT --> RES["post {type: result} with transferable buffers"]
    RES --> E(["Promise resolves in actions.compile()"])

    C -. "Stop pressed / timeout" .-> K["worker.terminate()<br/>reject with CompileCancelledError<br/>re-boot lazily from cache"]
```

---

## 9. Engine and package-shelf proxy cache

The WASM engine (~190 MB) is not part of the Python package. The server
downloads it on first use, checks it against the manifest, and serves it from
then on (`gitlatex/routes/engine.py`).

```mermaid
flowchart TD
    A(["Worker: GET /engine/&lt;build&gt;/&lt;asset&gt;"]) --> B{"build matches manifest.base<br/>and asset has a SHA-256?"}
    B -->|no| B1(["404"])
    B -->|yes| C{"~/.gitlatex/engine/&lt;build&gt;/&lt;asset&gt;<br/>cached?"}
    C -->|yes| C1(["send cached file"])
    C -->|no| D["open upstream URL"]
    D -->|network error| D1(["502 'check your internet connection'"])
    D -->|ok| E["Stream to the client while writing a temp file<br/>verify SHA-256, then rename into the cache"]
    E --> E1(["200 streamed body"])

    S(["Worker: GET /shelf/&lt;path&gt;"]) --> S0{"GITLATEX_SHELF_URL set<br/>and path is safe?"}
    S0 -->|no| S1(["404"])
    S0 -->|yes| S2{"cached and fresh?<br/>(.json index TTL is 24 h; bundles never expire)"}
    S2 -->|yes| S3(["send cached"])
    S2 -->|no| S4["fetch upstream"]
    S4 -->|"HTTP error / offline"| S5{"stale copy cached?"}
    S5 -->|yes| S3
    S5 -->|no| S6(["upstream status / 502"])
    S4 -->|ok| S7(["stream and cache"])
```

---

## 10. Git: push and pull with rebase

Code: `gitlatex/routes/git.py` (toolbar push/pull), `gitlatex/routes/scm.py` +
`services/scm.py` (Source control panel), and `services/sync.py` (shared
pull/push logic). Design notes: [docs/sync-and-conflicts.md](sync-and-conflicts.md).

### Push

```mermaid
flowchart TD
    A(["POST /push {message}"]) --> A1["acquire project_lock<br/>message = trimmed, or a timestamp"]
    A1 --> B["git add -A"]
    B --> C{"anything staged / dirty?"}
    C -->|yes| C1["commit(message); committed = true"]
    C -->|no| D
    C1 --> D["push_current(): git push origin"]
    D --> E{"result"}
    E -->|accepted| OK(["200 {success, committed, pulled: false}"])
    E -->|"remote / other error"| ER(["500 'Push failed: ...'"])
    E -->|"REJECTED (fetch first)"| F["pull_rebase(repo) — see below"]
    F -->|Conflict| CF(["409 'someone else pushed changes to the same lines'<br/>+ files; local commit kept, not pushed"])
    F -->|ok| G["push_current() again"]
    G -->|accepted| OK2(["200 {success, committed, pulled: true}"])
    G -->|rejected again| RJ(["409 'remote changed again while pushing'"])
```

### Pull (`services/sync.py:pull_rebase`)

```mermaid
flowchart TD
    A(["pull_rebase(repo, keep_conflicts)"]) --> A1["install comments merge driver<br/>(.gitlatex/comments/*.json threads merge automatically)"]
    A1 --> A2["before = HEAD sha"]
    A2 --> B["git pull --rebase --autostash"]
    B -->|"raised, and no rebase in progress"| ERR(["re-raise: network / auth error"])
    B -->|"raised, rebase stopped"| ADV
    B -->|"exit 0"| C{"unmerged files after<br/>autostash pop?"}
    C -->|no| OK(["return 'pulled'"])
    C -->|yes| C1{"keep_conflicts?"}
    C1 -->|yes| CK(["raise Conflict(kept=True)<br/>markers left in files for the editor"])
    C1 -->|no| C2["git reset --hard before<br/>git stash pop"] --> CA(["raise Conflict: pull undone"])

    ADV["advance_rebase()"] --> L{"rebase in progress?"}
    L -->|no| OK
    L -->|yes| U["files = unmerged<br/>real = files that are not build output"]
    U --> U1{"keep_conflicts and real?"}
    U1 -->|yes| U2["resolve build output with --theirs (the local copy)<br/>raise Conflict(real, kept=True)"]
    U1 -->|no| U3{"no files, or any real conflict?"}
    U3 -->|yes| U4["git rebase --abort<br/>raise Conflict(files)"]
    U3 -->|"only build output<br/>(main.pdf, .aux, .synctex.gz, ...)"| U5["checkout --theirs (keep the local build)<br/>git add; rebase --continue"] --> L
```

The editor's **Source control panel** (`/api/scm/*`) uses the same functions
with `keep_conflicts=True`. Conflicts are then left in the files, and the user
settles them in the editor with *Accept current / incoming* (`/api/scm/resolve`),
*Mark resolved*, or *Abort*.

---

## 11. SyncTeX: source ↔ PDF

The React UI parses the `.synctex.gz` produced by the last build **in the
browser** (`web/src/latex/synctex.ts`). The classic UI uses the server's pure-Python
reader instead (`/synctex/forward|inverse` → `services/synctex_reader.py`).

```mermaid
flowchart LR
    subgraph Forward["Source → PDF"]
        F1(["Cmd/Ctrl+click a line<br/>or 'Show in PDF'"]) --> F2["synctex.forward(file, line)"]
        F2 --> F3["boxes: page, x, y, w, h"]
        F3 --> F4(["PdfViewer scrolls and<br/>highlights the box"])
    end
    subgraph Inverse["PDF → Source"]
        I1(["Double-click in the PDF"]) --> I2["page + PDF coordinates"]
        I2 --> I3["synctex.inverse(page, x, y)"]
        I3 --> I4["{file, line}<br/>mapped onto project paths"]
        I4 --> I5(["Open the tab, reveal the line,<br/>flash it"])
    end
    BUILD["Compile result:<br/>main.synctex.gz"] --> PARSE["SyncTex.fromGzip(gz, mainDir,<br/>{mainFile, files})"]
    PARSE --> F2
    PARSE --> I3
```

---

## 12. Live collaboration

Optional, per project. Code: `web/src/collab/` and `collab-worker/src/index.ts`.
Only text is relayed. Each participant still writes, compiles and commits on
their own machine.

```mermaid
sequenceDiagram
    autonumber
    participant A as Owner's browser
    participant R as Relay (Cloudflare Worker,<br/>one Durable Object per room)
    participant B as Co-author's browser
    participant DA as Owner's disk (gitlatex server)
    participant DB as Co-author's disk (gitlatex server)

    A->>R: Admin token → create room (per project), get room token
    A-->>B: Invite string (host + room + room token), sent out of band
    A->>R: WebSocket /parties/collab/<room>?token=… (Yjs sync)
    R-->>A: Y.Doc { files: Map<path, Y.Text> } (loaded from chunked storage)
    Note over A,R: Join: the room wins for files that differ,<br/>local-only text files are added to the room<br/>(build output and binaries are excluded)
    B->>R: WebSocket join with the invite token
    R-->>B: Full document state
    B->>DB: Workspace writes the room's text to disk
    loop Editing
        A->>R: Y.Text delta (TextBinding on Monaco model) + awareness (cursor, file)
        R-->>B: Broadcast delta + awareness
        B->>DB: POST /api/fs/write (debounced)
        A->>DA: POST /api/fs/write (debounced)
    end
    R->>R: Persist the document (debounced 2 s, max 10 s, 512 KB chunks)
    Note over A,B: Compile, commit and push stay local to each person
```

---

## 13. Build and release pipeline

```mermaid
flowchart LR
    subgraph Dev["Developer machine"]
        W["web/ (React + TS + Vite)"] -->|"npm ci && npm run build<br/>(tsc -b && vite build)"| UI["gitlatex/ui/<br/>(git-ignored)"]
        PY["gitlatex/ Python package"] --> PKG
        UI --> PKG["pip install -e .<br/>or python -m build"]
        PKG --> CLI(["gitlatex CLI"])
        W -->|"npm run dev :5173<br/>proxies the API to :5000"| HOT(["Hot-reload UI"])
    end

    subgraph CI[".github/workflows/publish.yml"]
        T1(["workflow_dispatch (patch / minor / major)<br/>or push of tag v*.*.*"]) --> T2["Compute the next tag & push it<br/>(manual run only)"]
        T2 --> T3["Node 22: npm ci, npm test, npm run build"]
        T3 --> T4["Python 3.12: python -m build, twine check"]
        T4 --> T5{"wheel contains ui/index.html<br/>and engine/manifest.json?"}
        T5 -->|no| T6(["fail"])
        T5 -->|yes| T7{"clean X.Y.Z version<br/>(setuptools-scm)?"}
        T7 -->|no| T6
        T7 -->|yes| T8(["Publish to PyPI<br/>(Trusted Publishing / OIDC)"])
    end
```

---

## Appendix: where to look

| Concern | Server (`gitlatex/`) | Client (`web/src/`) |
| --- | --- | --- |
| Entry point | `server.py`, `app.py` | `main.tsx`, `App.tsx` |
| Global state | `state.py` | `state/store.ts`, `state/actions.ts` |
| Project files | `routes/workspace.py`, `routes/files.py`, `services/paths.py` | `state/workspace.ts`, `storage/server.ts` |
| Compile | `routes/compile.py`, `services/latex.py` | `engine/*`, `latex/log-parser.ts` |
| Git | `routes/git.py`, `routes/scm.py`, `services/sync.py`, `services/scm.py` | `components/GitPanel.tsx`, `editor/conflicts.ts` |
| Review comments | `routes/review.py`, `services/comments*.py` | `editor/review.ts`, `components/ReviewPanel.tsx` |
| SyncTeX | `routes/synctex.py`, `services/synctex*.py` | `latex/synctex.ts`, `pdf/*` |
| Spell / snippets / Zotero | `services/spell.py`, `snippets.py`, `zotero.py` | `editor/spell.ts`, `editor/snippets.ts` |
| LyX-style editor | — | `lyx/*` (tex-import ⇄ DOM model ⇄ tex-export) |
| Live collaboration | — | `collab/*` + `collab-worker/` |
| Tests | `tests/*.py` (unittest) | `web/tests/unit` (vitest), `web/tests/e2e` |
