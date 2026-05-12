/**
 * Re-export of the cursor codec + types from `@shipeasy/core/pagination` so
 * SDK consumers don't have to depend on `@shipeasy/core` directly.
 */
export {
  pageQuerySchema,
  encodeCursor,
  decodeCursor,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "@shipeasy/core/pagination";
export type { Page, PageQuery, CursorParts } from "@shipeasy/core/pagination";
