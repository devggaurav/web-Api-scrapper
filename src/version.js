// Single source of truth for the tool version (keep in sync with package.json).
// A plain constant (not a package.json read) so the bun-compiled standalone
// binaries don't need the file on disk at runtime.
export const VERSION = '0.3.0';
