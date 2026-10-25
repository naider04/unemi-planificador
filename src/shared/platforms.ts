export const OTHER_SERVER_PREFIX = 'other_';

export const KNOWN_BASE_URLS: Record<string, string> = {
  a: 'https://aulagradoa.unemi.edu.ec',
  b: 'https://aulagradob.unemi.edu.ec',
  upsdt: 'https://aulas.upsdt.edu.ec'
};

/**
 * Normalize a user-supplied Moodle URL to its origin (protocol + host),
 * defaulting to https when no protocol is provided.
 */
export function normalizeBaseUrl(input: string): string {
  const trimmed = (input || '').trim();
  if (!trimmed) return '';
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);
  return `${url.protocol}//${url.host}`;
}

export function slugifyHost(host: string): string {
  return host
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Build a stable server partition key for a custom Moodle platform, e.g.
 * "other_capacitacionelectoral_cne_gob_ec". It is safe for Firestore doc IDs.
 */
export function createOtherServerKey(baseUrl: string): string {
  const host = new URL(normalizeBaseUrl(baseUrl)).host;
  return `${OTHER_SERVER_PREFIX}${slugifyHost(host)}`;
}

export function isOtherServer(server: string | null | undefined): boolean {
  return !!server && server.startsWith(OTHER_SERVER_PREFIX);
}

/**
 * Resolve the Moodle origin for a session/task. Custom platforms must provide
 * their own base URL; known UNEMI/UPSDT codes keep their fixed origins.
 */
export function resolveBaseUrl(server: string, baseUrl?: string | null): string {
  if (KNOWN_BASE_URLS[server]) return KNOWN_BASE_URLS[server];
  if (baseUrl) return normalizeBaseUrl(baseUrl);
  throw new Error(`Servidor Moodle desconocido: ${server}`);
}

export function getSessionKey(session: { server: string; username: string }): string {
  return `${session.server}_${session.username.trim().toLowerCase()}`;
}

/**
 * Human readable platform label used across the UI.
 */
export function getServerLabel(server: string | null | undefined, baseUrl?: string | null): string {
  if (!server) return '';
  if (server === 'a') return 'UNEMI P/S';
  if (server === 'b') return 'UNEMI Online';
  if (server === 'upsdt') return 'UPSDT';
  if (baseUrl) {
    try {
      return new URL(normalizeBaseUrl(baseUrl)).host;
    } catch {
      // fall through to the server-key based label
    }
  }
  if (isOtherServer(server)) {
    return server.slice(OTHER_SERVER_PREFIX.length).replace(/_/g, '.');
  }
  return server.toUpperCase();
}
