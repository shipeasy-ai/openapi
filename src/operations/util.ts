import type { OpInput } from "./types.js";

/** Read a coerced number param (already `Number()`-ed by the framework), or undefined. */
export const num = (i: OpInput, k: string): number | undefined =>
  i[k] === undefined ? undefined : (i[k] as number);

/** Read a string param, or undefined. */
export const str = (i: OpInput, k: string): string | undefined =>
  i[k] === undefined ? undefined : (i[k] as string);

/** Read a boolean param, or undefined. */
export const bool = (i: OpInput, k: string): boolean | undefined =>
  i[k] === undefined ? undefined : (i[k] as boolean);
