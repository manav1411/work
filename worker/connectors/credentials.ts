import { ApiError, type Env } from "../env";
import { fromBase64, toBase64 } from "../files";
import { createPrivateKey } from "node:crypto";

export interface ConnectorCredentials {
  token?: string;
  refreshToken?: string;
  installationId?: string;
}
export function credentialsConfigured(env: Env): boolean {
  return Boolean(
    (env.CONNECTOR_ENCRYPTION_KEY || env.BETTER_AUTH_SECRET || "").length >= 32,
  );
}
async function key(env: Env): Promise<CryptoKey> {
  const secret = env.CONNECTOR_ENCRYPTION_KEY || env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new ApiError(
      503,
      "CONNECTORS_NOT_CONFIGURED",
      "Private connections are not configured yet. Public profiles and project links are available.",
    );
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`work:connectors:v1:${env.ENVIRONMENT}:${secret}`),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function sealCredentials(
  env: Env,
  connectionId: string,
  credentials: ConnectorCredentials,
): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: new TextEncoder().encode(connectionId),
    },
    await key(env),
    new TextEncoder().encode(JSON.stringify(credentials)),
  );
  return `v1.${toBase64(nonce)}.${toBase64(new Uint8Array(cipher))}`;
}
export async function openCredentials(
  env: Env,
  connectionId: string,
  value: string | null,
): Promise<ConnectorCredentials> {
  if (!value) return {};
  const [version, nonce, cipher] = value.split(".");
  if (version !== "v1" || !nonce || !cipher)
    throw new ApiError(
      503,
      "CREDENTIAL_UNAVAILABLE",
      "Reconnect this source to restore access.",
    );
  try {
    const bytes = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: new Uint8Array(fromBase64(nonce)),
        additionalData: new TextEncoder().encode(connectionId),
      },
      await key(env),
      new Uint8Array(fromBase64(cipher)),
    );
    return JSON.parse(new TextDecoder().decode(bytes)) as ConnectorCredentials;
  } catch {
    throw new ApiError(
      503,
      "CREDENTIAL_UNAVAILABLE",
      "Reconnect this source to restore access.",
    );
  }
}

function base64url(bytes: Uint8Array): string {
  return toBase64(bytes)
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}
export function githubAppConfigured(env: Env): boolean {
  return Boolean(
    env.GITHUB_APP_ID &&
    env.GITHUB_APP_SLUG &&
    env.GITHUB_APP_PRIVATE_KEY &&
    credentialsConfigured(env),
  );
}
export async function githubAppRequest(
  env: Env,
  path: string,
  method = "GET",
): Promise<Record<string, unknown>> {
  if (!githubAppConfigured(env))
    throw new ApiError(
      503,
      "GITHUB_APP_NOT_CONFIGURED",
      "Repository access is not configured yet. You can track public projects by username.",
    );
  const pem = env.GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g, "\n");
  const der = createPrivateKey(pem).export({ type: "pkcs8", format: "der" });
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    new Uint8Array(der),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const seconds = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) =>
    base64url(new TextEncoder().encode(JSON.stringify(value)));
  const message = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: seconds - 60, exp: seconds + 540, iss: env.GITHUB_APP_ID })}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(message),
  );
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${message}.${base64url(new Uint8Array(signature))}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "Work-career-workspace",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok)
    throw new ApiError(
      response.status === 404 ? 404 : 502,
      "GITHUB_ACCESS_FAILED",
      "GitHub repository access could not be verified. Reconnect and check the app installation.",
    );
  return response.status === 204
    ? {}
    : ((await response.json()) as Record<string, unknown>);
}
export async function installationToken(
  env: Env,
  installationId: string,
): Promise<string> {
  if (!/^[1-9]\d*$/.test(installationId))
    throw new ApiError(
      400,
      "INVALID_INSTALLATION",
      "Choose a valid GitHub installation.",
    );
  const result = await githubAppRequest(
    env,
    `/app/installations/${installationId}/access_tokens`,
    "POST",
  );
  if (typeof result.token !== "string")
    throw new ApiError(
      502,
      "GITHUB_ACCESS_FAILED",
      "GitHub did not return repository access.",
    );
  return result.token;
}
