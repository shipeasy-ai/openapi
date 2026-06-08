/**
 * Re-export of the cursor codec + types from `./schemas/pagination.js` so
 * SDK consumers can import these straight from `@shipeasy/openapi`.
 */
export {
  pageQuerySchema,
  encodeCursor,
  decodeCursor,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "./schemas/pagination.js";
export type { Page, PageQuery, CursorParts } from "./schemas/pagination.js";
