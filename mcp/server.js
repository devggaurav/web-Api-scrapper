#!/usr/bin/env node
// MCP server exposing browser-flow-tracker to Claude / Cursor.
//
// Tools:
//   list_browsers   - which Chromium browsers are installed
//   start_tracking  - launch or attach, begin recording (one session at a time)
//   get_flow        - live snapshot of the current recording (without stopping)
//   stop_tracking   - stop, write JSON/HAR/Markdown, return the flow

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { TrackingSession } from '../src/session.js';
import { detectInstalled } from '../src/browsers.js';

let current = null; // the single active TrackingSession

function json(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
function err(message) {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

const server = new McpServer(
  { name: 'browser-flow-tracker', version: '0.1.0' },
  {
    instructions: [
      'Use these tools whenever the user wants to record, analyze, or document the',
      'API / network flow of a web page or app module (e.g. "what APIs does this call",',
      '"document the checkout flow", "track the requests on this page").',
      '',
      'ALWAYS use these tools for that job. Do NOT hand-roll browser automation, do NOT',
      'launch browsers or poke at debug ports via the shell, and do NOT try to analyze',
      'network traffic yourself — start_tracking handles launching/attaching and picks a',
      'free port automatically.',
      '',
      'The capture is USER-DRIVEN: call start_tracking (launch a fresh window OR attach to',
      "the user's browser), then STOP and let the USER navigate/click through the real flow",
      'themselves. Do not auto-navigate the flow for them. When they say they are done, call',
      'stop_tracking and turn the returned flow into a document. Use get_flow for a live peek.',
      'The launched window uses a persistent profile, so a login done once is remembered.',
    ].join('\n'),
  },
);

server.registerTool(
  'list_browsers',
  {
    description: 'List Chromium-family browsers installed on this machine that can be tracked (Brave, Chrome, Arc, Edge, etc.). Safari/Firefox are not supported (no CDP).',
    inputSchema: {},
  },
  async () => json({ browsers: detectInstalled() }),
);

server.registerTool(
  'start_tracking',
  {
    description:
      'Start recording a page\'s API/network flow. Either launch a fresh browser (launch=true, requires browser id) or attach to a browser already running with --remote-debugging-port (attach mode). Only one session runs at a time.',
    inputSchema: {
      launch: z.boolean().optional().describe('Launch a fresh browser with a throwaway profile. If false/omitted, attach to a running browser.'),
      browser: z.string().optional().describe('Browser id for launch mode: brave | arc | chrome | edge | vivaldi | opera | chromium'),
      port: z.number().optional().describe('CDP port (default 9222).'),
      url: z.string().optional().describe('URL to open (launch mode).'),
      urlMatch: z.string().optional().describe('When attaching, pick the tab whose URL contains this substring.'),
      headless: z.boolean().optional().describe('Launch headless (launch mode).'),
      includeNoise: z.boolean().optional().describe('Also keep filtered static/analytics requests.'),
      redact: z.boolean().optional().describe('Redact auth/cookie headers (default true).'),
    },
  },
  async (args) => {
    if (current?.active) return err('A tracking session is already active. Call stop_tracking first.');
    if (args.launch && !args.browser) return err('launch=true requires a browser id. Call list_browsers.');
    current = new TrackingSession({
      launch: Boolean(args.launch),
      browser: args.browser,
      port: args.port ?? 9222,
      url: args.url,
      urlMatch: args.urlMatch,
      headless: Boolean(args.headless),
      includeNoise: Boolean(args.includeNoise),
      redact: args.redact !== false,
    });
    try {
      const info = await current.start();
      const hint = info.reusedExisting
        ? 'Reused the already-open recording window (your login is preserved). Now let the USER navigate the flow; call get_flow to peek or stop_tracking when they are done.'
        : 'A browser window is open and recording. Do NOT navigate it yourself — let the USER click through the real flow, then call get_flow to peek or stop_tracking to finish. (Persistent profile: any login is remembered next time.)';
      return json({ status: 'recording', ...info, hint });
    } catch (e) {
      current = null;
      return err(`Failed to start tracking: ${e.message}`);
    }
  },
);

server.registerTool(
  'get_flow',
  {
    description: 'Return a live snapshot of the API calls captured so far in the current session, without stopping it.',
    inputSchema: {
      full: z.boolean().optional().describe('Include full request/response bodies and headers (default: summary only).'),
    },
  },
  async ({ full }) => {
    if (!current?.active) return err('No active tracking session. Call start_tracking first.');
    const snap = current.snapshot();
    if (full) return json(snap);
    const summary = snap.flow
      .filter((e) => e.category !== 'document')
      .map((e) => ({ i: e.index, method: e.method, url: `${e.host}${e.path}`, status: e.status, ms: e.durationMs }));
    return json({ stats: snap.stats, calls: summary });
  },
);

server.registerTool(
  'stop_tracking',
  {
    description: 'Stop the current recording, write JSON + HAR + Markdown outputs to disk, and return the full normalized flow plus file paths.',
    inputSchema: {
      outDir: z.string().optional().describe('Output directory (default ./recordings).'),
      name: z.string().optional().describe('Output file basename (default flow-<timestamp>).'),
      title: z.string().optional().describe('Title for the generated Markdown document.'),
      closeBrowser: z.boolean().optional().describe('Close the browser if it was launched by this tool.'),
    },
  },
  async (args) => {
    if (!current) return err('No session to stop.');
    if (args.title) current.opts.title = args.title;
    try {
      const { session, files } = await current.stop({
        outDir: args.outDir,
        name: args.name,
        closeBrowser: args.closeBrowser,
      });
      const result = { status: 'stopped', files, stats: session.stats, target: session.target, flow: session.flow };
      current = null;
      return json(result);
    } catch (e) {
      return err(`Failed to stop: ${e.message}`);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
