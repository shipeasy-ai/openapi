import { z } from "zod";

/** Folder name validation shared across every entity that supports folders.
 *  Flat string — no `/` allowed because `/` is the folder/name separator in
 *  SDK lookup keys (see KV blob format 3). Empty string is coerced to null
 *  at the boundary so the DB stores a single canonical "no folder" value. */
export const folderSchema = z
  .string()
  .max(256)
  .regex(/^[a-zA-Z0-9_-]+$/, "Folder must be alphanumeric, `_` or `-` (no `/`).")
  .nullable()
  .optional()
  .describe(
    "Optional folder name used to group items in the dashboard. Part of the SDK lookup key: an item in folder `checkout` named `new-cart` is referenced as `checkout/new-cart` from the SDK.",
  );

export type FolderInput = z.infer<typeof folderSchema>;
