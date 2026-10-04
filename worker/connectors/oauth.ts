import { ApiError, id, now, type Env } from "../env";
import { hashValue } from "../validation";
import {
  assertIdle,
  connection,
  detachSources,
  editConnection,
  type ConnectionRow,
} from "./store";
import {
  credentialsConfigured,
  githubAppConfigured,
  githubAppRequest,
  sealCredentials,
  type ConnectorCredentials,
} from "./credentials";

export function notionOAuthConfigured(env: Env): boolean {
  return Boolean(
    env.NOTION_CLIENT_ID &&
    env.NOTION_CLIENT_SECRET &&
    credentialsConfigured(env),
  );
}
function callbackUrl(env: Env, provider: string): string {
  return `${env.APP_ORIGIN}/api/connectors/callback/${provider}`;
}
async function sessionHash(
  request: Request,
  owner: string,
  env: Env,
): Promise<string> {
  const cookies = (request.headers.get("Cookie") || "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => /^(?:__Secure-)?better-auth\.session_token=/.test(part));
  if (!cookies.length && env.ENVIRONMENT !== "local")
    throw new ApiError(
      401,
      "SESSION_REQUIRED",
      "Sign in again before connecting this source.",
    );
  return hashValue(
    cookies.length ? cookies.sort().join(";") : `local:${owner}`,
  );
}
export async function authorize(
  env: Env,
  owner: string,
  provider: "notion" | "github",
  request: Request,
): Promise<string> {
  if (provider === "notion" && !notionOAuthConfigured(env))
    throw new ApiError(
      503,
      "NOTION_NOT_CONFIGURED",
      "Notion sign-in is not configured yet. Use a selected-page connection token instead.",
    );
  if (provider === "github" && !githubAppConfigured(env))
    throw new ApiError(
      503,
      "GITHUB_APP_NOT_CONFIGURED",
      "Private repository access is not configured yet. You can track public repositories.",
    );
  const state = `${id()}${id()}`;
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM connector_oauth_states WHERE expires_at<? OR (owner_id=? AND provider=?)",
    ).bind(now(), owner, provider),
    env.DB.prepare(
      "INSERT INTO connector_oauth_states(state_hash,owner_id,provider,session_hash,expires_at,created_at) VALUES(?,?,?,?,?,?)",
    ).bind(
      await hashValue(state),
      owner,
      provider,
      await sessionHash(request, owner, env),
      new Date(Date.now() + 10 * 60_000).toISOString(),
      now(),
    ),
  ]);
  const url =
    provider === "notion"
      ? new URL("https://api.notion.com/v1/oauth/authorize")
      : new URL(
          `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`,
        );
  url.searchParams.set("state", state);
  if (provider === "notion") {
    url.searchParams.set("client_id", env.NOTION_CLIENT_ID!);
    url.searchParams.set("redirect_uri", callbackUrl(env, provider));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("owner", "user");
  }
  return url.href;
}
async function consumeState(
  env: Env,
  owner: string,
  provider: "notion" | "github",
  request: Request,
) {
  const state = new URL(request.url).searchParams.get("state") || "";
  if (!/^[a-f0-9-]{72}$/.test(state))
    throw new ApiError(
      400,
      "INVALID_STATE",
      "This connection request expired. Start again from Connectors.",
    );
  const found = await env.DB.prepare(
    "DELETE FROM connector_oauth_states WHERE state_hash=? AND owner_id=? AND provider=? AND session_hash=? AND expires_at>? RETURNING state_hash",
  )
    .bind(
      await hashValue(state),
      owner,
      provider,
      await sessionHash(request, owner, env),
      now(),
    )
    .first();
  if (!found)
    throw new ApiError(
      400,
      "INVALID_STATE",
      "This connection request expired or belongs to another session. Start again from Connectors.",
    );
}
export async function saveConnection(
  env: Env,
  owner: string,
  provider: ConnectionRow["provider"],
  accountId: string,
  label: string,
  config: Record<string, unknown>,
  credentials?: ConnectorCredentials,
): Promise<ConnectionRow> {
  let previous: ConnectionRow | null = null;
  try {
    previous = await connection(env.DB, owner, provider);
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }
  if (previous) assertIdle(previous);
  const connectionId = previous?.id || id();
  const cipher = credentials
    ? await sealCredentials(env, connectionId, credentials)
    : null;
  const sameAccount = previous?.account_id === accountId;
  const combinedConfig = sameAccount
    ? { ...JSON.parse(previous!.config), ...config }
    : config;
  if (
    sameAccount &&
    Array.isArray(config.selections) &&
    !config.selections.length
  ) {
    const priorSelections = (
      JSON.parse(previous!.config) as { selections?: unknown[] }
    ).selections;
    if (priorSelections?.length) combinedConfig.selections = priorSelections;
  }
  const save = async () => {
    if (previous && previous.account_id !== accountId)
      await detachSources(env, previous, true);
    await env.DB.prepare(
      "INSERT INTO connector_connections(id,owner_id,provider,account_id,label,status,config,snapshot,credential,created_at,next_sync_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,provider) DO UPDATE SET account_id=excluded.account_id,label=excluded.label,status=excluded.status,config=excluded.config,snapshot=excluded.snapshot,credential=excluded.credential,generation=generation+1,cursor='{}',error=NULL,next_sync_at=excluded.next_sync_at,lease_token=NULL,lease_until=NULL",
    )
      .bind(
        connectionId,
        owner,
        provider,
        accountId,
        label,
        provider === "overleaf" ? "linked" : "setting_up",
        JSON.stringify(combinedConfig),
        sameAccount ? previous!.snapshot : "{}",
        cipher,
        previous?.created_at || now(),
        provider === "overleaf" ? null : now(),
      )
      .run();
  };
  if (previous) await editConnection(env, previous, save);
  else await save();
  return connection(env.DB, owner, provider);
}
export async function callback(
  env: Env,
  owner: string,
  provider: "notion" | "github",
  request: Request,
): Promise<ConnectionRow> {
  await consumeState(env, owner, provider, request);
  const params = new URL(request.url).searchParams;
  if (params.has("error"))
    throw new ApiError(
      400,
      "CONNECTION_CANCELLED",
      "Connection cancelled. You can try again from Connectors.",
    );
  if (provider === "github") {
    const installationId = params.get("installation_id") || "";
    if (!/^[1-9]\d*$/.test(installationId))
      throw new ApiError(
        400,
        "INVALID_INSTALLATION",
        "GitHub did not return an installation.",
      );
    const installation = await githubAppRequest(
      env,
      `/app/installations/${installationId}`,
    );
    const account = installation.account as
      { id?: number; login?: string; type?: string } | undefined;
    const user = await env.DB.prepare("SELECT github_id FROM user WHERE id=?")
      .bind(owner)
      .first<{ github_id: string }>();
    if (
      !account ||
      account.type !== "User" ||
      String(account.id) !== user?.github_id
    )
      throw new ApiError(
        403,
        "INSTALLATION_OWNER_MISMATCH",
        "Install the connector on the personal GitHub account you use to sign in to Work.",
      );
    return saveConnection(
      env,
      owner,
      provider,
      String(account.id),
      account.login || "GitHub",
      { mode: "installation", selections: [] },
      { installationId },
    );
  }
  if (!notionOAuthConfigured(env))
    throw new ApiError(
      503,
      "NOTION_NOT_CONFIGURED",
      "Notion sign-in is not configured.",
    );
  const code = params.get("code");
  if (!code || code.length > 1000)
    throw new ApiError(
      400,
      "INVALID_CODE",
      "Notion did not return a valid connection code.",
    );
  const response = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Basic ${btoa(`${env.NOTION_CLIENT_ID}:${env.NOTION_CLIENT_SECRET}`)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl(env, provider),
    }),
  });
  if (!response.ok)
    throw new ApiError(
      502,
      "NOTION_AUTH_FAILED",
      "Notion could not finish connecting. Start again from Connectors.",
    );
  const result = (await response.json()) as Record<string, unknown>;
  if (
    typeof result.access_token !== "string" ||
    typeof result.workspace_id !== "string"
  )
    throw new ApiError(
      502,
      "NOTION_AUTH_FAILED",
      "Notion returned an incomplete connection.",
    );
  return saveConnection(
    env,
    owner,
    provider,
    result.workspace_id,
    typeof result.workspace_name === "string"
      ? result.workspace_name
      : "Notion workspace",
    { mode: "oauth", selections: [] },
    {
      token: result.access_token,
      ...(typeof result.refresh_token === "string"
        ? { refreshToken: result.refresh_token }
        : {}),
    },
  );
}
