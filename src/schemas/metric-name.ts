import { z } from "zod";

// Metric name validation. Lives here (rather than in core's richer metrics
// schema) because the experiment contract references it and the admin client
// must validate it without pulling in core's DB-coupled metric definitions.
export const metricNameSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?)?$/)
  .max(128);
