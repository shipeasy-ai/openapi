import { z } from "zod";

export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 500;

/**
 * Query params for any paginated list endpoint. `cursor` is opaque to
 * consumers; servers encode/decode via {@link encodeCursor}/{@link decodeCursor}.
 */
export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursor: z.string().min(1).optional(),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;

/** Standard envelope every paginated list endpoint returns. */
export interface Page<T> {
  data: T[];
  next_cursor: string | null;
}

/**
 * Cursor encodes the `(ts, id)` tuple of the last row from the previous page.
 * `ts` is whichever ISO-8601 timestamp column the resource sorts by — most
 * resources use `updated_at`, but ones that lack it (universes, sdk_keys) use
 * `created_at`. Sort order is always `ORDER BY <ts> DESC, id DESC`; keyset
 * comparison is `(ts, id) < (cursor.ts, cursor.id)`. ISO-8601 text sorts
 * lexicographically, so string comparison is correct.
 *
 * The cursor is opaque to SDK consumers — only the server (which encodes) and
 * the client transport (which round-trips it) need to know the structure.
 */
export interface CursorParts {
  ts: string;
  id: string;
}

const SEP = "|";

export function encodeCursor(parts: CursorParts): string {
  if (parts.ts.includes(SEP)) {
    throw new Error(`pagination: ts must not contain '${SEP}'`);
  }
  return base64UrlEncode(`${parts.ts}${SEP}${parts.id}`);
}

export function decodeCursor(cursor: string): CursorParts {
  let raw: string;
  try {
    raw = base64UrlDecode(cursor);
  } catch {
    throw new Error("pagination: cursor is not valid base64url");
  }
  const sep = raw.indexOf(SEP);
  if (sep < 0) throw new Error("pagination: cursor missing separator");
  const ts = raw.slice(0, sep);
  const id = raw.slice(sep + 1);
  if (!ts || !id) throw new Error("pagination: cursor parts empty");
  return { ts, id };
}

function base64UrlEncode(s: string): string {
  // btoa works on latin-1; ISO timestamps and ids are ASCII so we're safe.
  const b64 = btoa(s);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
}
