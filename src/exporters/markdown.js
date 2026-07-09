// Generates a first-draft Markdown flow document from a normalized flow.
// Claude/Cursor can read the JSON for detail; this is the human-readable draft.

function shortBody(body, isJson, max = 600) {
  if (body == null || body === '') return '';
  let s = isJson ? JSON.stringify(body, null, 2) : String(body);
  if (s.length > max) s = s.slice(0, max) + '\n… [truncated]';
  return s;
}

function safeLabel(s) {
  return String(s).replace(/[^\w./:-]/g, '_').slice(0, 40);
}

// Show each repeated (polling) endpoint once; the count lives on the entry.
function collapseRepeats(entries) {
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    if (e.repeatKey) {
      if (seen.has(e.repeatKey)) continue;
      seen.add(e.repeatKey);
    }
    out.push(e);
  }
  return out;
}

function repeatSuffix(e) {
  return e.repeatCount > 1 ? ` ×${e.repeatCount}` : '';
}

export function toMarkdown(session, options = {}) {
  const { flow, stats } = session;
  const apiFlow = flow.filter((e) => e.category === 'api' || e.category === 'websocket' || e.category === 'sse');
  const coreFlow = collapseRepeats(apiFlow.filter((e) => !e.thirdParty));
  const thirdFlow = collapseRepeats(apiFlow.filter((e) => e.thirdParty));
  const title = options.title || `API Flow — ${session.target?.title || session.target?.url || 'recording'}`;
  const lines = [];

  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`> Recorded ${session.startedAt || ''} → ${session.stoppedAt || ''}`);
  if (session.target?.url) lines.push(`> Page: ${session.target.url}`);
  lines.push('');

  // Overview
  lines.push('## Overview');
  lines.push('');
  const coreTotal = apiFlow.filter((e) => !e.thirdParty).length;
  lines.push(`- **Core API calls:** ${coreFlow.length} unique (${coreTotal} total incl. polling)`);
  if (thirdFlow.length) {
    lines.push(`- **Third-party calls:** ${thirdFlow.length} unique (see "Third-party calls" below)`);
  }
  lines.push(`- **Total requests seen:** ${stats.totalCaptured} (${stats.droppedCount} filtered as noise)`);
  if (options.events?.count) {
    const byP = Object.entries(options.events.byProvider || {}).map(([p, n]) => `${p} ×${n}`).join(', ');
    lines.push(`- **Analytics events:** ${options.events.count}${byP ? ` (${byP})` : ''} — see \`${options.events.file}\``);
  }
  if (stats.sessionSites?.length) {
    lines.push(`- **Session scope:** ${stats.sessionSites.map((s) => `\`${s}\``).join(', ')}`);
  }
  const hosts = Object.entries(stats.byHost).sort((a, b) => b[1] - a[1]);
  if (hosts.length) {
    lines.push(`- **Hosts:** ${hosts.map(([h, n]) => `\`${h}\` (${n})`).join(', ')}`);
  }
  const statuses = Object.entries(stats.byStatus).sort();
  if (statuses.length) {
    lines.push(`- **Status codes:** ${statuses.map(([s, n]) => `${s}×${n}`).join(', ')}`);
  }
  lines.push('');

  // Sequence diagram (core flow only, one arrow per unique endpoint)
  lines.push('## Sequence diagram');
  lines.push('');
  lines.push('```mermaid');
  lines.push('sequenceDiagram');
  lines.push('    participant B as Browser');
  const participants = new Map();
  for (const e of coreFlow) {
    if (!participants.has(e.host)) participants.set(e.host, `S${participants.size}`);
  }
  for (const [host, id] of participants) lines.push(`    participant ${id} as ${host}`);
  for (const e of coreFlow) {
    const id = participants.get(e.host);
    const label = `${e.method} ${safeLabel(e.path)}${repeatSuffix(e)}`;
    lines.push(`    B->>${id}: ${label}`);
    const st = e.failed ? `FAILED ${e.errorText || ''}` : `${e.status || '?'} ${e.statusText || ''}`.trim();
    lines.push(`    ${id}-->>B: ${st}`);
  }
  lines.push('```');
  lines.push('');

  // Ordered endpoint table — the core (first-party) flow
  lines.push('## Core API flow');
  lines.push('');
  lines.push('| # | Method | Endpoint | Status | Time | Calls |');
  lines.push('|---|--------|----------|--------|------|-------|');
  coreFlow.forEach((e, i) => {
    const status = e.failed ? `✗ ${e.errorText || 'failed'}` : e.status || '';
    const time = e.durationMs != null ? `${e.durationMs}ms` : '';
    const calls = e.repeatCount > 1 ? `×${e.repeatCount} (polling)` : '';
    lines.push(`| ${i + 1} | ${e.method} | \`${e.host}${e.path}\` | ${status} | ${time} | ${calls} |`);
  });
  lines.push('');

  // Third-party calls, kept but out of the way of the core flow.
  if (thirdFlow.length) {
    lines.push('## Third-party calls');
    lines.push('');
    lines.push('_Calls to hosts outside the session scope — widgets, CDNs, external services. Full detail is in the `.flow.json`._');
    lines.push('');
    lines.push('| Method | Endpoint | Status | Calls |');
    lines.push('|--------|----------|--------|-------|');
    thirdFlow.forEach((e) => {
      const status = e.failed ? `✗ ${e.errorText || 'failed'}` : e.status || '';
      const calls = e.repeatCount > 1 ? `×${e.repeatCount}` : '';
      lines.push(`| ${e.method} | \`${e.host}${e.path}\` | ${status} | ${calls} |`);
    });
    lines.push('');
  }

  // Detailed breakdown (core flow)
  lines.push('## Call details');
  lines.push('');
  coreFlow.forEach((e, i) => {
    lines.push(`### ${i + 1}. ${e.method} ${e.path}${repeatSuffix(e)}`);
    lines.push('');
    lines.push(`- **URL:** \`${e.url}\``);
    if (e.repeatCount > 1) lines.push(`- **Calls:** ${e.repeatCount} (polling — first shown; all instances are in the \`.flow.json\`)`);
    if (e.tab > 0) lines.push(`- **Tab:** popup/new tab #${e.tab}${e.tabUrl ? ` (\`${e.tabUrl}\`)` : ''}`);
    lines.push(`- **Status:** ${e.failed ? `✗ ${e.errorText}` : `${e.status || ''} ${e.statusText || ''}`}`);
    if (e.durationMs != null) lines.push(`- **Duration:** ${e.durationMs}ms`);
    if (e.initiator) lines.push(`- **Initiated by:** ${e.initiator}`);
    if (e.query && Object.keys(e.query).length) {
      lines.push(`- **Query params:** \`${JSON.stringify(e.query)}\``);
    }
    const reqStr = shortBody(e.requestBody, e.requestBodyIsJson);
    if (reqStr) {
      lines.push('');
      lines.push('**Request body:**');
      lines.push('```json');
      lines.push(reqStr);
      lines.push('```');
    }
    const resStr = shortBody(e.responseBody, e.responseBodyIsJson);
    if (resStr) {
      lines.push('');
      lines.push('**Response body:**');
      lines.push('```json');
      lines.push(resStr);
      lines.push('```');
    }
    lines.push('');
  });

  lines.push('---');
  lines.push('_Draft generated by browser-flow-tracker. Refine with Claude/Cursor using the accompanying `.flow.json`._');
  lines.push('');
  return lines.join('\n');
}
