# 🕵️ browser-flow-tracker

[![npm version](https://img.shields.io/npm/v/browser-flow-tracker.svg)](https://www.npmjs.com/package/browser-flow-tracker)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

### *"What is this website actually doing behind the scenes?"*

You know that feeling when you click a button on a website and a bunch of invisible
stuff happens — data flies back and forth, APIs get called, magic occurs — but you
have **no idea what's going on** unless you open the scary black DevTools console and
squint at a wall of text?

**This tool is your spy. 🔍**

It quietly watches a web page while you click around, notes down every important
conversation the page has with its servers (the "APIs"), and then hands you a
**clean, human-readable document** explaining the whole flow — complete with a
diagram. No more squinting. No more console.

You can use it **by typing one command**, or just **ask Claude / Cursor to do it for you**.

---

## 🎯 What you get out of it

After you record a flow, the tool drops **3 files** in a folder for you:

| File | Emoji | What it's for | Who reads it |
|------|-------|---------------|--------------|
| `something.md` | 📄 | A nice, readable document: overview, a **diagram**, a table of every API call in order, and the details | **You!** (and Claude/Cursor) |
| `something.flow.json` | 🤖 | The same info in "robot language" | Claude / Cursor, to help you write even better docs |
| `something.har` | 🔧 | An industry-standard file | Developers, tools like Postman/DevTools |

👉 **The one you'll actually open and read is the `.md` file.** Open it in any Markdown
viewer, VS Code, or even just a text editor.

### 📁 Where do the files go?

By default, everything is saved into a folder called **`recordings/`** right inside
this project:

```
Scrapper/
└── recordings/
    ├── flow-2026-07-01T14-30-00.md      ← 📄 open this one
    ├── flow-2026-07-01T14-30-00.flow.json
    └── flow-2026-07-01T14-30-00.har
```

Each recording is automatically named with the **date and time** so they never
overwrite each other. Want a nicer name or a different folder? See
[the options](#-handy-options) below.

---

## 🍬 What a finished document looks like

Here's a taste of what ends up in your `.md` file:

> ## Sequence diagram
> ```mermaid
> sequenceDiagram
>     participant B as Browser
>     participant S0 as api.myapp.com
>     B->>S0: GET /products
>     S0-->>B: 200
>     B->>S0: POST /cart/add
>     S0-->>B: 201
> ```
>
> ## Call sequence
> | # | Method | Endpoint | Status | Time |
> |---|--------|----------|--------|------|
> | 1 | GET | `api.myapp.com/products` | 200 | 120ms |
> | 2 | POST | `api.myapp.com/cart/add` | 201 | 340ms |

…plus the full request and response details for each call. 🎉

It's smart, too: it **throws away the boring noise** (images, fonts, styling,
tracking/analytics pixels) and keeps only the meaningful stuff. And it **hides your
passwords and login tokens** by default so you can share the doc safely.

---

## 🚀 First-time setup (do this once)

> ✅ **Using it through Claude or Cursor?** You can skip this whole section — just add the
> tiny config in [Connecting to Claude / Cursor](#-connecting-to-claude--cursor) and `npx`
> handles the rest. The steps below are only for the **Terminal / `bft` command** usage.

You need this **one-time** setup. It's two steps.

**1. Make sure you have Node.js.** Open the **Terminal** app and paste this:

```bash
node --version
```

If you see a number like `v18` or higher, you're good. If it says "command not found",
download Node from [nodejs.org](https://nodejs.org) and install it (just click Next → Next → Done).

**2. Install the tool's bits.** Paste this into Terminal:

```bash
cd path/to/browser-flow-tracker   # 👈 the folder where this tool lives
npm install
```

Wait a few seconds. Done forever. ✅

> 💡 **What's "Terminal"?** It's the app on your Mac where you type commands.
> Press `Cmd + Space`, type "Terminal", hit Enter.

> 📌 **What do I put instead of `path/to/browser-flow-tracker`?** The easiest trick:
> type `cd ` (with a space), then **drag the tool's folder from Finder into the
> Terminal window** and hit Enter — the correct path fills itself in. From then on,
> the `cd ...` line is the same in every command below.

---

## 🎬 How to use it — 3 ways

Pick whichever feels comfortable. They all produce the same nice files.

### Way 1: 🗣️ Just ask Claude or Cursor (easiest — zero commands)

Once the tool is connected (it already is — see [Connecting to Claude/Cursor](#-connecting-to-claude--cursor)),
you literally just **say the magic phrase**:

> ### *"Let's record the session for this url `https://your-website.com`"*

Here's what happens automatically:

1. 🪟 The AI opens a **real browser window** at that URL (it picks a free port itself —
   nothing for you to configure).
2. 🖱️ **You** click through the flow you want documented. *You* drive — the AI does not
   click for you.
3. 🛑 When you're finished, either **say "done"** *or just **close the browser window***.
4. 📄 The AI writes the `.flow.json` / `.har` / `.md` files and hands you a clean doc of
   the APIs it saw.

You don't type a single command. ✨

> 🔐 **Logging in?** The window uses its own saved profile, so you only log in the
> **first** time — future recordings remember you.

> ⚠️ **If your AI ignores the phrase** and starts poking around on its own instead of
> using the tool, you haven't installed the rule yet — see
> [Make your AI always use it](#-make-your-ai-always-use-it).

---

### Way 2: 🧼 Let the tool open a browser for you (Terminal)

Paste this into Terminal (change the website):

```bash
cd path/to/browser-flow-tracker   # 👈 the folder where this tool lives
node bin/bft.js record --launch --browser brave --url https://your-website.com
```

A browser window pops open on its own **private profile** (it never touches your normal
Brave). **Click around, do the thing you want to document** — logging in if you need to.
When you're done, either press **`Ctrl + C`** in Terminal **or just close the browser
window** — both save the recording.

💥 Your files appear in the `recordings/` folder.

> 🔐 You only log in the **first** time — the private profile remembers you for next time.

> Don't have Brave? Run `node bin/bft.js list` to see which browsers you have,
> then swap `brave` for `arc`, `chrome`, etc.

---

### Way 3: 🔐 Watch your *own* main browser (advanced)

Usually **Way 1 or Way 2 is enough** even for logged-in sites (you log in once in the
tool's own window and it's remembered). Use this only if you specifically need to record
inside your **existing, already-open** browser session.

**Step 1.** Ask the tool for the magic command:

```bash
cd path/to/browser-flow-tracker   # 👈 the folder where this tool lives
node bin/bft.js attach-help brave
```

It prints an exact command — **copy it, quit Brave completely, and paste that command**
into Terminal. Brave reopens in "watch me" mode.

**Step 2.** Log in and go to where the flow starts. Then, in a **new** Terminal window:

```bash
cd path/to/browser-flow-tracker   # 👈 the folder where this tool lives
node bin/bft.js record --attach --url-match your-website.com
```

**Step 3.** Do your thing in the browser, then press **`Ctrl + C`** in Terminal.

💥 Files appear in `recordings/`.

---

## 🎛️ Handy options

Add any of these to the end of a `record` command:

| Option | What it does | Example |
|--------|--------------|---------|
| `--name checkout` | Name the files `checkout` instead of a timestamp | `--name checkout` |
| `--out ~/Desktop/docs` | Save files somewhere else (like your Desktop) | `--out ~/Desktop/docs` |
| `--title "Checkout Flow"` | Give the document a proper title | `--title "Checkout Flow"` |
| `--url-match myapp` | Watch the correct browser tab | `--url-match myapp` |
| `--include-noise` | Keep *everything* (images, fonts, tracking too) | `--include-noise` |
| `--no-redact` | Show passwords/tokens (⚠️ don't share the file then) | `--no-redact` |

Full example:

```bash
node bin/bft.js record --launch --browser brave \
  --url https://shop.example.com \
  --name checkout-flow \
  --title "Shop Checkout Flow" \
  --out ~/Desktop
```

---

## 🤖 Connecting to Claude / Cursor

### ✅ Recommended: one-line install (no Node, works everywhere)

The most reliable way — **no Node.js required**, and it avoids the `spawn npx ENOENT`
PATH problems that trip up GUI apps. It installs a standalone binary to a fixed path
your AI can always find.

**macOS / Linux** — paste into Terminal:

```bash
curl -fsSL https://apiflowtracker.com/install.sh | sh
```

**Windows** — download `browser-flow-tracker-windows-x64.exe` from the
[latest release](https://github.com/devggaurav/web-Api-scrapper/releases/latest).

Then add this to your MCP config (the installer prints the exact path):

```json
{
  "mcpServers": {
    "browser-flow-tracker": {
      "command": "/usr/local/bin/browser-flow-tracker"
    }
  }
}
```

That absolute path is the **same on every Mac/Linux box**, so there's no PATH guessing.
Restart your AI app and you're done.

### Alternative: via npx (only if you already have Node.js)

If Node 18+ is installed *and* on your app's PATH, you can skip the install and run it
straight from npm:

```json
{
  "mcpServers": {
    "browser-flow-tracker": {
      "command": "npx",
      "args": ["-y", "browser-flow-tracker@latest"]
    }
  }
}
```

Claude Code shortcut: `claude mcp add browser-flow-tracker -- npx -y browser-flow-tracker@latest`

> If you hit `spawn npx ENOENT`, your app can't see `npx` on its PATH — use the one-line
> installer above instead; it sidesteps the whole issue.

### Where the config file lives

- **Claude Code:** `.mcp.json` in a project, or your user config (managed by `claude mcp`).
- **Cursor:** `.cursor/mcp.json` (per project) or `~/.cursor/mcp.json` (global).

> ⚠️ **Already using other MCP tools?** Don't replace your file — **add** the
> `browser-flow-tracker` block *inside* your existing `mcpServers`, with a **comma** after
> your previous tool. Keep it valid JSON (commas between entries, none after the last).

Ready-made copies are in this repo as `.mcp.json.example` and `.cursor/mcp.json.example`.

### Prefer to run from source? (for the CLI or development)

You don't need this for the AI use case, but if you want the `bft` command-line tool or
want to hack on the code:

```bash
git clone https://github.com/devggaurav/web-Api-scrapper.git
cd web-Api-scrapper
npm install
# MCP: point your config's command at "node" with args ["<full-path>/mcp/server.js"]
# CLI: node bin/bft.js record --launch --browser brave --url https://example.com
```

---

Behind the scenes it has four skills it uses automatically:

| Skill | What it does |
|-------|--------------|
| `list_browsers` | See which browsers you have |
| `start_tracking` | Start watching |
| `get_flow` | Peek at what's been captured so far (without stopping) |
| `stop_tracking` | Stop and save the files |

---

## 🧲 Make your AI always use it

Sometimes an AI will "helpfully" try to analyze a page **its own way** (poking around with
scripts) instead of using this tool. To stop that, give it a standing rule so the phrase
**"let's record the session for this url …"** always triggers the tool. Do it once and it
works in every project.

### Cursor

Add a **User Rule** (applies in all projects): **Settings → Rules & Memories → User Rules
→ + Add**, and paste:

```
When I say "let's record the session for this url <URL>" — or ask you to record/
analyze/document the API or network flow of a page — ALWAYS use the browser-flow-
tracker MCP tools (start_tracking, get_flow, stop_tracking). Do not launch browsers,
touch debug ports, or sniff traffic yourself.
Loop: call start_tracking with launch:true, browser:"brave", url:<URL>. Then let ME
navigate — do not click for me. The recording ends when I say "done" (call
stop_tracking with a name+title) OR I close the browser (it auto-finalizes; detect via
get_flow returning status:"ended"). Both write .flow.json/.har/.md — read the
.flow.json and write me a clean flow doc.
```

*(A copy of this rule also ships in `.cursor/rules/browser-flow-tracker.mdc`, which
applies automatically whenever you work inside this project.)*

### Claude Code

Add the same guidance to your **global** `~/.claude/CLAUDE.md` (create the file if it
doesn't exist) so it applies in every project. The exact text is in
[`.cursor/rules/browser-flow-tracker.mdc`](.cursor/rules/browser-flow-tracker.mdc) — copy
the body into `~/.claude/CLAUDE.md`.

> After adding a rule, **restart the AI app** so it picks it up.

---

## ❓ Common questions & fixes

**"My AI didn't use the tool — it started doing its own thing."**
You haven't given it the standing rule yet. See
[Make your AI always use it](#-make-your-ai-always-use-it), then restart the AI app.

**"How do I stop a recording?"**
Two ways, whichever you like: **say "done"** to your AI, **or just close the browser
window**. Both save the files automatically. (In Terminal, `Ctrl + C` also works.)

**"Do I have to log in every time?"**
No — the tool's browser window keeps its own saved profile, so you log in the **first**
time and it's remembered afterwards.

**"It says 'No known browsers found'."**
Run `node bin/bft.js list`. If it's empty, you don't have a supported browser
installed. Install Brave or Chrome (both free) and try again.

**"Nothing showed up in my recording."**
Make sure you actually *did the thing* in the browser before you stopped. Some pages need
a click or a page load to fire their APIs.

**"Where are my files again?"**
In the `recordings/` folder — unless you used `--out` (or the AI set a different location).
The tool prints the exact file paths when it finishes, and the AI can read them back to you.

**"Can I use Safari?"**
Not yet 😔 — Safari and Firefox work differently under the hood. For now use Brave,
Chrome, Arc, or Edge. (Safari support is on the roadmap.)

**"Is it safe to share the document?"**
By default, **yes** — passwords, cookies, and login tokens are automatically hidden.
Only if you used `--no-redact` should you be careful.

---

## 🧠 How it works (the 20-second version)

The tool speaks the same secret language browsers use to talk to their own developer
tools (it's called the "Chrome DevTools Protocol"). So it can listen in on every
network request a page makes — the same info you'd see in that scary DevTools tab —
and then it cleans it up, filters out the junk, and formats it into something a human
can actually read. That's it. 🎩

---

## 🗺️ Roadmap (coming later)

- 🧭 Safari & Firefox support (via a different listening method)
- 🪟 Watch multiple browser tabs at once
- 🔀 "Diff" mode — compare two recordings to see what changed
- 🧩 Auto-group calls into logical steps in the doc

---

Made to save you from ever having to open the browser console again. Happy tracking! 🕵️‍♀️
