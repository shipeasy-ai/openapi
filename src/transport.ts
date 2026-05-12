export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface Transport {
  request<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    query?: Record<string, string>,
  ): Promise<T>;
}

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface AuthSnapshot {
  token: string;
  projectId: string;
}

export interface HttpTransportOptions {
  /** Base URL for the admin API, e.g. "https://shipeasy.ai" (no trailing slash required). */
  baseUrl: string;
  /**
   * Returns the auth token + project_id for the next request. Called per request
   * so consumers can refresh credentials or apply per-call project overrides.
   */
  getAuth(): AuthSnapshot;
  /**
   * Optional gate run before any non-GET request. Throw to abort. CLI uses this
   * to enforce `.shipeasy` binding for mutations; MCP uses it to surface a
   * notBound error. GET requests bypass this hook.
   */
  beforeMutation?(method: HttpMethod, path: string): void | Promise<void>;
}

export function createHttpTransport(opts: HttpTransportOptions): Transport {
  const baseUrl = opts.baseUrl.replace(/\/$/, "");

  return {
    async request<T>(
      method: HttpMethod,
      path: string,
      body?: unknown,
      query?: Record<string, string>,
    ): Promise<T> {
      if (method !== "GET" && opts.beforeMutation) {
        await opts.beforeMutation(method, path);
      }

      const auth = opts.getAuth();
      const url = new URL(`${baseUrl}${path}`);
      if (query) {
        for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
      }

      const res = await fetch(url.toString(), {
        method,
        headers: {
          "X-SDK-Key": auth.token,
          "X-Project-Id": auth.projectId,
          "Content-Type": "application/json",
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });

      if (res.status === 204 || res.status === 202) return undefined as T;

      const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      if (!res.ok) {
        const msg = (json as { error?: string }).error ?? `HTTP ${res.status}`;
        throw new ApiError(msg, res.status);
      }
      return json as T;
    },
  };
}
