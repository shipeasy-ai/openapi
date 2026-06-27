import type { AdminClient } from "../resources/index.js";
import { ApiError } from "../transport.js";
import type { Operation, OpInput } from "./types.js";
import { str } from "./util.js";

/**
 * SDK-docs operations — `docs …`. Replaces the static, MCP-only
 * `get_sdk_snippet` with a generic fetcher over each SDK repo's `/docs/` folder
 * published to plain GitHub Pages (latest only; no backend, no version arg —
 * see doc 21 §A4.4).
 *
 * This is the FIRST op whose `run` does outbound `fetch` instead of an
 * `AdminClient` call — intentional, and worker-safe: outbound `fetch` is
 * available in Node 20+ AND Workers, and is NOT the fs/AST boundary, so the op
 * can live in the shared registry even though it bypasses the admin API. The
 * `client` arg is ignored.
 *
 * The doc standard each SDK repo follows (required `pages/`, nested
 * `snippets/<group>/<resource>.md`, an installable `skill/SKILL.md`, and a
 * tree-index `manifest.json`) is specified in `experiment-platform/22-sdk-docs-standard.md`.
 * Until a repo adopts it, the op falls back to a small built-in default set so
 * nothing breaks during rollout.
 */

/** Hardcoded SDK → GitHub repo map. Pages is served at `<owner>.github.io/<repo>/…`. */
const SDK_REPOS: Record<string, { owner: string; repo: string }> = {
  typescript: { owner: "shipeasy-ai", repo: "sdk" },
  javascript: { owner: "shipeasy-ai", repo: "sdk" },
  node: { owner: "shipeasy-ai", repo: "sdk" },
  ts: { owner: "shipeasy-ai", repo: "sdk" },
  python: { owner: "shipeasy-ai", repo: "sdk-python" },
  go: { owner: "shipeasy-ai", repo: "sdk-go" },
  java: { owner: "shipeasy-ai", repo: "sdk-java" },
  kotlin: { owner: "shipeasy-ai", repo: "sdk-kotlin" },
  php: { owner: "shipeasy-ai", repo: "sdk-php" },
  swift: { owner: "shipeasy-ai", repo: "sdk-swift" },
  ruby: { owner: "shipeasy-ai", repo: "sdk-ruby" },
};

const SDK_ENUM = Object.keys(SDK_REPOS);

interface DocManifest {
  schemaVersion: number;
  sdk: string;
  placeholders?: string[];
  skill?: string;
  pages?: Record<string, string>;
  snippets?: Record<string, Record<string, string>>;
}

/** Built-in fallback manifest + content for repos that haven't adopted the standard yet. */
const DEFAULT_MANIFEST: DocManifest = {
  schemaVersion: 2,
  sdk: "default",
  placeholders: ["RESOURCE_NAME"],
  skill: "skill/SKILL.md",
  pages: { overview: "pages/overview.md", installation: "pages/installation.md" },
  snippets: { release: { flags: "snippets/release/flags.md" } },
};
const DEFAULT_CONTENT: Record<string, string> = {
  "pages/overview.md":
    "# Shipeasy SDK\n\nThis SDK has not published its `/docs/` folder yet. See https://docs.shipeasy.ai for the full reference.",
  "pages/installation.md": "# Installation\n\nInstall the Shipeasy SDK for your language, then call `shipeasy({ serverKey })` (server) or `shipeasy({ clientKey })` (browser).",
  "snippets/release/flags.md": "```\nconst on = await client.checkGate(user, '{{RESOURCE_NAME}}');\n```",
  "skill/SKILL.md":
    "---\nname: shipeasy-sdk\ndescription: Use the Shipeasy SDK for flags, experiments, configs, and i18n.\n---\n\nThis SDK has not published a skill yet. See https://docs.shipeasy.ai.",
};

function repoFor(sdk: string): { owner: string; repo: string } {
  const r = SDK_REPOS[sdk.toLowerCase()];
  if (!r) throw new ApiError(`Unknown SDK '${sdk}'. One of: ${SDK_ENUM.join(", ")}`, 400);
  return r;
}

function pagesBase(sdk: string): string {
  const { owner, repo } = repoFor(sdk);
  return `https://${owner}.github.io/${repo}`;
}

async function fetchText(url: string): Promise<string | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.text();
}

async function loadManifest(sdk: string): Promise<{ manifest: DocManifest; fallback: boolean }> {
  const text = await fetchText(`${pagesBase(sdk)}/manifest.json`);
  if (!text) return { manifest: DEFAULT_MANIFEST, fallback: true };
  try {
    return { manifest: JSON.parse(text) as DocManifest, fallback: false };
  } catch {
    return { manifest: DEFAULT_MANIFEST, fallback: true };
  }
}

/** Resolve a user-supplied doc handle (`flags`, `release/experiments`, or a literal `pages/x.md`) to a manifest path. */
function resolvePath(manifest: DocManifest, handle: string): string {
  if (handle.endsWith(".md")) return handle;
  if (manifest.pages?.[handle]) return manifest.pages[handle];
  if (handle.includes("/")) {
    const [group, resource] = handle.split("/", 2);
    const p = manifest.snippets?.[group]?.[resource];
    if (p) return p;
  }
  throw new ApiError(
    `Doc '${handle}' not found. Run 'docs list --sdk <lang>' to see available pages and snippets.`,
    404,
  );
}

function substitute(body: string, manifest: DocManifest, i: OpInput): string {
  let out = body;
  for (const ph of manifest.placeholders ?? []) {
    // Map a few well-known placeholders onto caller args; default to `name`.
    const value =
      str(i, ph) ??
      (ph === "RESOURCE_NAME" ? str(i, "name") : undefined) ??
      (ph === "FRAMEWORK" ? str(i, "framework") : undefined);
    if (value !== undefined) out = out.replaceAll(`{{${ph}}}`, value);
  }
  return out;
}

export const docsOperations: Operation[] = [
  {
    group: ["docs"],
    name: "list",
    mutates: false,
    summary: "List an SDK's documentation tree",
    description:
      "Fetch an SDK's `/docs/manifest.json` and return the doc tree — the feature-reference " +
      "pages, the nested snippet groups, and whether an installable skill exists. The runtime " +
      "'explore' step before fetching a specific page or snippet.",
    params: [{ name: "sdk", type: "string", description: "SDK language.", required: true, enum: SDK_ENUM }],
    examples: [{ run: "shipeasy docs list --sdk python" }],
    run: async (_client: AdminClient, i: OpInput) => {
      const { manifest, fallback } = await loadManifest(i.sdk as string);
      return {
        sdk: i.sdk,
        fallback,
        pages: Object.keys(manifest.pages ?? {}),
        snippets: Object.fromEntries(
          Object.entries(manifest.snippets ?? {}).map(([g, r]) => [g, Object.keys(r)]),
        ),
        skill: Boolean(manifest.skill),
      };
    },
  },
  {
    group: ["docs"],
    name: "get",
    mutates: false,
    summary: "Fetch one SDK doc page or snippet",
    description:
      "Fetch one feature-reference page (`flags`, `experiments`, …) or nested snippet " +
      "(`release/experiments`, `i18n/setup`, …) from the SDK's published docs, substituting " +
      "declared {{placeholders}} from caller args. Replaces the old `get_sdk_snippet`.",
    params: [
      { name: "sdk", type: "string", description: "SDK language.", required: true, enum: SDK_ENUM },
      { name: "path", type: "string", description: "Page key or snippet 'group/resource'.", required: true, positional: true },
      { name: "framework", type: "string", description: "Framework hint (substitutes {{FRAMEWORK}})." },
      { name: "name", type: "string", description: "Resource name (substitutes {{RESOURCE_NAME}})." },
    ],
    examples: [
      { note: "A feature page", run: "shipeasy docs get --sdk python experiments" },
      { note: "A nested snippet, with a resource name", run: "shipeasy docs get --sdk typescript release/flags --name checkout_v2" },
    ],
    run: async (_client: AdminClient, i: OpInput) => {
      const sdk = i.sdk as string;
      const { manifest, fallback } = await loadManifest(sdk);
      const path = resolvePath(manifest, i.path as string);
      const body = fallback
        ? DEFAULT_CONTENT[path]
        : ((await fetchText(`${pagesBase(sdk)}/${path}`)) ?? undefined);
      if (body === undefined) throw new ApiError(`Doc '${path}' could not be fetched for '${sdk}'.`, 404);
      return { sdk, path, fallback, content: substitute(body, manifest, i) };
    },
  },
  {
    group: ["docs"],
    name: "skill",
    mutates: false,
    summary: "Fetch an SDK's installable LLM skill",
    description:
      "Fetch the SDK's `skill/SKILL.md` (YAML frontmatter intact) so an agent can install it " +
      "verbatim into its skills directory. The CLI's `--install` writes it locally (a consumer " +
      "fs side-effect layered on the fetch); the op itself just returns the bytes.",
    params: [
      { name: "sdk", type: "string", description: "SDK language.", required: true, enum: SDK_ENUM },
      { name: "install", type: "boolean", description: "CLI only: write the skill to the local agent skills dir." },
    ],
    examples: [
      { run: "shipeasy docs skill --sdk python" },
      { note: "Install into the local skills dir", run: "shipeasy docs skill --sdk python --install true" },
    ],
    run: async (_client: AdminClient, i: OpInput) => {
      const sdk = i.sdk as string;
      const { manifest, fallback } = await loadManifest(sdk);
      const skillPath = manifest.skill ?? "skill/SKILL.md";
      const content = fallback
        ? DEFAULT_CONTENT[skillPath]
        : ((await fetchText(`${pagesBase(sdk)}/${skillPath}`)) ?? undefined);
      if (content === undefined) throw new ApiError(`No skill published for '${sdk}'.`, 404);
      // The op returns the bytes; the CLI `--install` writer does the fs write consumer-side.
      return { sdk, skillPath, fallback, content };
    },
  },
];
