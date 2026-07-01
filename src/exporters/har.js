// Minimal HAR 1.2 exporter so recordings can be opened in Chrome DevTools,
// Charles, Insomnia, Postman, etc.

function headerArray(headers) {
  return Object.entries(headers || {}).map(([name, value]) => ({ name, value: String(value) }));
}

function queryArray(query) {
  return Object.entries(query || {}).map(([name, value]) => ({ name, value: String(value) }));
}

export function toHar(records, meta = {}) {
  const entries = records
    .filter((r) => r.url && r.method !== 'WS')
    .map((r) => {
      const reqBody = r.requestBody;
      const resBody = r.responseBody;
      return {
        startedDateTime: meta.startedAt || new Date(0).toISOString(),
        time: r.durationMs || 0,
        request: {
          method: r.method || 'GET',
          url: r.url,
          httpVersion: 'HTTP/1.1',
          headers: headerArray(r.requestHeaders),
          queryString: queryArray(r.query),
          cookies: [],
          headersSize: -1,
          bodySize: reqBody ? -1 : 0,
          ...(reqBody != null
            ? { postData: { mimeType: 'application/json', text: typeof reqBody === 'string' ? reqBody : JSON.stringify(reqBody) } }
            : {}),
        },
        response: {
          status: r.status || 0,
          statusText: r.statusText || '',
          httpVersion: r.protocol || 'HTTP/1.1',
          headers: headerArray(r.responseHeaders),
          cookies: [],
          content: {
            size: r.sizeBytes || -1,
            mimeType: (r.responseHeaders && (r.responseHeaders['content-type'] || r.responseHeaders['Content-Type'])) || '',
            text: resBody == null ? '' : typeof resBody === 'string' ? resBody : JSON.stringify(resBody),
          },
          redirectURL: '',
          headersSize: -1,
          bodySize: -1,
        },
        cache: {},
        timings: { send: 0, wait: r.durationMs || 0, receive: 0 },
      };
    });

  return {
    log: {
      version: '1.2',
      creator: { name: 'browser-flow-tracker', version: '0.1.0' },
      pages: [],
      entries,
    },
  };
}
