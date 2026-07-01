# 🕵️ browser-flow-tracker

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
you literally just **ask in plain English**:

> *"Track the login flow on staging.myapp.com and write me a doc of what APIs it calls."*

Claude/Cursor will open a browser, record the flow, and write the document for you.
You don't type a single command. ✨

---

### Way 2: 🧼 Let the tool open a fresh browser for you

Best when you **don't need to be logged in** to see the flow.

Paste this into Terminal (change the website):

```bash
cd path/to/browser-flow-tracker   # 👈 the folder where this tool lives
node bin/bft.js record --launch --browser brave --url https://your-website.com
```

A browser window pops open. **Click around, do the thing you want to document.**
When you're done, come back to Terminal and press **`Ctrl + C`** to stop.

💥 Your files appear in the `recordings/` folder.

> Don't have Brave? Run `node bin/bft.js list` to see which browsers you have,
> then swap `brave` for `arc`, `chrome`, etc.

---

### Way 3: 🔐 Watch your *own* browser (for sites you're logged into)

Best when the flow only happens **after you log in** (dashboards, checkout, admin panels).

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

There are two ready-made template files. Copy each one and fill in the real path to
this folder (the same path trick from setup — drag the folder into Terminal to get it):

```bash
cp .mcp.json.example .mcp.json                # for Claude Code
cp .cursor/mcp.json.example .cursor/mcp.json  # for Cursor
```

Then open each copy and replace `/full/path/to/browser-flow-tracker` with your actual path.

**To use in Claude Code:** open this folder in Claude Code and approve the
`browser-flow-tracker` tool when it asks. Or connect it everywhere with:

```bash
claude mcp add browser-flow-tracker -- node /full/path/to/browser-flow-tracker/mcp/server.js
```

**To use in Cursor:** restart Cursor, go to **Settings → MCP**, and switch on
`browser-flow-tracker`.

Then just talk to it (see [Way 1](#way-1-️-just-ask-claude-or-cursor-easiest--zero-commands)).
Behind the scenes it has four skills it uses automatically:

| Skill | What it does |
|-------|--------------|
| `list_browsers` | See which browsers you have |
| `start_tracking` | Start watching |
| `get_flow` | Peek at what's been captured so far (without stopping) |
| `stop_tracking` | Stop and save the files |

---

## ❓ Common questions & fixes

**"It says 'No known browsers found'."**
Run `node bin/bft.js list`. If it's empty, you don't have a supported browser
installed. Install Brave or Chrome (both free) and try again.

**"It won't attach to my browser (Way 3)."**
Chrome/Brave refuse "watch me" mode if a normal window is already open. **Fully quit
the browser first** (`Cmd + Q`), then run the command from `attach-help`.

**"Nothing showed up in my recording."**
Make sure you actually *did the thing* in the browser between starting and pressing
`Ctrl + C`. Some pages need a click or a page load to fire their APIs.

**"Where are my files again?"**
In the `recordings/` folder inside this project — unless you used `--out` to send
them elsewhere. The tool also prints the exact file paths when it finishes.

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
