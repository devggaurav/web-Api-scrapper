// Redaction of secrets so recordings are safe to share by default.
// Covers three places secrets actually show up:
//   1. headers (Authorization, Cookie, ...)
//   2. URL query params (?token=..., ?api_key=...)
//   3. JSON / form-encoded request & response bodies ({"password": ...},
//      login responses returning {"access_token": ...}, etc.)

export const SENSITIVE_HEADERS = new Set([
  'authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token',
  'proxy-authorization', 'x-csrf-token', 'x-xsrf-token', 'x-session-token',
  'x-access-token', 'x-refresh-token', 'api-key', 'apikey',
]);

// Key names (matched case-insensitively, ignoring -_ separators) whose VALUES
// are secrets wherever they appear: query params, JSON bodies, form bodies.
const SENSITIVE_KEY_RE = new RegExp(
  '^(' + [
    'password', 'passwd', 'pwd', 'passphrase', 'currentpassword', 'newpassword',
    'oldpassword', 'confirmpassword', 'secret', 'clientsecret', 'appsecret',
    'token', 'accesstoken', 'refreshtoken', 'idtoken', 'authtoken', 'apitoken',
    'sessiontoken', 'bearertoken', 'csrftoken', 'xsrftoken',
    'apikey', 'apisecret', 'privatekey', 'secretkey', 'encryptionkey',
    'auth', 'authorization', 'credential', 'credentials',
    'sessionid', 'sid', 'jsessionid', 'phpsessid',
    'otp', 'totp', 'mfacode', 'pin', 'securitycode', 'verificationcode',
    'cardnumber', 'ccnumber', 'cvv', 'cvc', 'ssn',
  ].join('|') + ')$',
  'i',
);

const REDACTED = '[redacted]';
const MAX_DEPTH = 12;

function isSensitiveKey(key) {
  return SENSITIVE_KEY_RE.test(String(key).replace(/[-_.]/g, ''));
}

export function redactHeaders(headers, redact = true) {
  if (!headers) return {};
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = redact && SENSITIVE_HEADERS.has(k.toLowerCase()) ? REDACTED : v;
  }
  return out;
}

// Flat object of query params ({token: 'abc'} -> {token: '[redacted]'}).
export function redactQuery(query, redact = true) {
  if (!query || !redact) return query;
  const out = {};
  for (const [k, v] of Object.entries(query)) {
    out[k] = isSensitiveKey(k) ? REDACTED : v;
  }
  return out;
}

// Deep-walk parsed JSON, replacing values of sensitive keys.
export function redactJson(value, depth = 0) {
  if (value == null || depth > MAX_DEPTH) return value;
  if (Array.isArray(value)) return value.map((v) => redactJson(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = isSensitiveKey(k) ? REDACTED : redactJson(v, depth + 1);
    }
    return out;
  }
  return value;
}

// application/x-www-form-urlencoded bodies ("user=a&password=b").
function looksLikeFormBody(s) {
  return /^[^=\s&]+=[^&\n]*(&[^=\s&]+=[^&\n]*)*$/.test(s) && s.includes('=');
}

function redactFormBody(s) {
  return s
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq === -1) return pair;
      const key = pair.slice(0, eq);
      let decoded = key;
      try { decoded = decodeURIComponent(key); } catch { /* keep raw */ }
      return isSensitiveKey(decoded) ? `${key}=${encodeURIComponent(REDACTED)}` : pair;
    })
    .join('&');
}

/**
 * Redact a body. `body` may be a parsed JSON value (object/array) or a raw
 * string (form-encoded or anything else). Returns the same shape.
 */
export function redactBody(body, redact = true) {
  if (!redact || body == null) return body;
  if (typeof body === 'object') return redactJson(body);
  if (typeof body === 'string' && looksLikeFormBody(body.trim())) {
    return redactFormBody(body.trim());
  }
  return body;
}
