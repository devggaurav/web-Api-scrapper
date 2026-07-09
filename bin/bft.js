#!/usr/bin/env node
// browser-flow-tracker CLI

import { TrackingSession } from '../src/session.js';
import { detectInstalled, resolveBrowser, UNSUPPORTED_CDP } from '../src/browsers.js';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

const HELP = `browser-flow-tracker (bft) — record & document a page's API flow

USAGE
  bft record [options]      Record until you press Ctrl+C, then write outputs
  bft list                  List Chromium browsers installed on this machine
  bft attach-help [browser] Show how to start a browser for --attach mode

RECORD OPTIONS
  --browser <id>    brave | arc | chrome | edge | vivaldi | opera | chromium
  --launch          Launch a fresh browser (throwaway profile) with debugging on
  --attach          Attach to a browser already running with --remote-debugging-port
                    (default when --launch is not given)
  --port <n>        CDP port (default 9222)
  --url <url>       URL to open (only with --launch)
  --url-match <s>   When attaching, pick the tab whose URL contains this string
  --headless        Launch headless (only with --launch)
  --out <dir>       Output directory (default ./recordings)
  --name <base>     Output file basename; the recording start timestamp is
                    appended automatically (default flow-<timestamp>)
  --title <t>       Title for the generated Markdown doc
  --scope <hosts>   Comma-separated hosts the flow is about (e.g. myapp.com);
                    calls to other hosts are kept but flagged third-party.
                    Default: auto-detected from the pages you visit
  --include-noise   Keep filtered (static/analytics) requests too
  --no-events       Skip the analytics/business events timeline (GA4, Segment,
                    Mixpanel, …) that is otherwise written to .events.json/.md
  --no-redact       Do NOT redact auth/cookie headers (default: redact)

EXAMPLES
  # Launch Brave, open a page, record the flow, Ctrl+C to finish
  bft record --launch --browser brave --url https://example.com

  # Attach to the browser you're already logged into (see: bft attach-help brave)
  bft record --attach --port 9222 --url-match myapp.com
`;

async function cmdList() {
  const found = detectInstalled();
  if (!found.length) {
    console.log('No known Chromium browsers found.');
    return;
  }
  console.log('Installed Chromium browsers (CDP-capable):');
  for (const { id, bin } of found) console.log(`  ${id.padEnd(10)} ${bin}`);
  console.log('\nNote: Safari/Firefox are not CDP-capable — proxy mode is on the roadmap.');
}

function cmdAttachHelp(browser) {
  const id = browser || 'brave';
  if (UNSUPPORTED_CDP[id]) {
    console.log(UNSUPPORTED_CDP[id]);
    return;
  }
  let bin;
  try { bin = resolveBrowser(id); } catch (e) { console.error(e.message); process.exit(1); }
  console.log(`To attach to your real ${id} session, fully quit ${id}, then run:\n`);
  console.log(`  "${bin}" --remote-debugging-port=9222\n`);
  console.log('Then, in another terminal:\n');
  console.log('  bft record --attach --port 9222 --url-match <part-of-your-app-url>\n');
  console.log('Browse/click through the flow, then press Ctrl+C to write the recording.');
}

async function cmdRecord(args) {
  const launch = Boolean(args.launch) && !args.attach;
  if (launch && !args.browser) {
    console.error('--launch requires --browser <id>. Try: bft list');
    process.exit(1);
  }

  const session = new TrackingSession({
    launch,
    browser: args.browser,
    port: args.port ? Number(args.port) : 9222,
    url: typeof args.url === 'string' ? args.url : undefined,
    urlMatch: typeof args['url-match'] === 'string' ? args['url-match'] : undefined,
    headless: Boolean(args.headless),
    includeNoise: Boolean(args['include-noise']),
    redact: !args['no-redact'],
    scopeHosts: typeof args.scope === 'string' ? args.scope.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    captureEvents: !args['no-events'],
    title: typeof args.title === 'string' ? args.title : undefined,
    // Used if the user closes the browser instead of pressing Ctrl+C.
    outDir: typeof args.out === 'string' ? args.out : undefined,
    name: typeof args.name === 'string' ? args.name : undefined,
  });

  console.log(launch ? `Launching ${args.browser}…` : `Attaching to CDP on port ${args.port || 9222}…`);
  let info;
  try {
    info = await session.start();
  } catch (e) {
    console.error(`\nFailed to start: ${e.message}`);
    if (!launch) console.error('\nIs the browser running with --remote-debugging-port? See: bft attach-help');
    process.exit(1);
  }

  console.log(`Attached to: ${info.attachedTo?.url || '(page)'}`);
  console.log('● Recording… interact with the page, then press Ctrl+C — or just close the browser — to save.\n');

  // Periodic live count so the user sees it's working. Also detects the user
  // closing the browser (session auto-finalizes) and reports the written files.
  const ticker = setInterval(() => {
    if (session.finalized) {
      clearInterval(ticker);
      const { session: result, files } = session.finalized;
      process.stdout.write('\n\nBrowser closed — recording saved.\n');
      console.log(`\nCaptured ${result.stats.kept} API calls (${result.stats.droppedCount} filtered)${result.stats.analyticsEvents ? ` and ${result.stats.analyticsEvents} analytics events` : ''}.`);
      console.log('\nWrote:');
      console.log(`  JSON (for Claude/Cursor): ${files.json}`);
      console.log(`  HAR  (DevTools/Postman):  ${files.har}`);
      console.log(`  Doc  (Markdown draft):    ${files.markdown}`);
      if (files.eventsJson) {
        console.log(`  Events (analytics/GA):    ${files.eventsMarkdown}`);
      }
      process.exit(0);
    }
    const snap = session.snapshot();
    process.stdout.write(`\r  ${snap.stats.kept || 0} API calls captured…   `);
  }, 1000);

  const finish = async () => {
    clearInterval(ticker);
    process.stdout.write('\n\nStopping…\n');
    try {
      const { session: result, files } = await session.stop({
        outDir: typeof args.out === 'string' ? args.out : undefined,
        name: typeof args.name === 'string' ? args.name : undefined,
        closeBrowser: launch,
      });
      console.log(`\nCaptured ${result.stats.kept} API calls (${result.stats.droppedCount} filtered)${result.stats.analyticsEvents ? ` and ${result.stats.analyticsEvents} analytics events` : ''}.`);
      console.log('\nWrote:');
      console.log(`  JSON (for Claude/Cursor): ${files.json}`);
      console.log(`  HAR  (DevTools/Postman):  ${files.har}`);
      console.log(`  Doc  (Markdown draft):    ${files.markdown}`);
      if (files.eventsJson) {
        console.log(`  Events (analytics/GA):    ${files.eventsMarkdown}`);
      }
    } catch (e) {
      console.error(`Error while stopping: ${e.message}`);
    }
    process.exit(0);
  };

  process.on('SIGINT', finish);
  process.on('SIGTERM', finish);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  switch (cmd) {
    case 'record': return cmdRecord(args);
    case 'list': return cmdList();
    case 'attach-help': return cmdAttachHelp(args._[1]);
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      return;
    default:
      console.error(`Unknown command: ${cmd}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
