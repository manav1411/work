# GitHub OAuth and deployment setup

Preserve existing working OAuth registrations, credentials, and build triggers. Use this document when configuring a new environment.

## 1. Dedicated GitHub OAuth application

The account owner must register an OAuth app at [GitHub application settings](https://github.com/settings/applications/new):

| Field | Value |
| --- | --- |
| Application name | Work |
| Homepage URL | `https://work.manavdodia.com` |
| Authorization callback URL | `https://work.manavdodia.com/api/auth/callback/github` |
| Device flow | Not required |

Generate its client secret. Place only these two values in the ignored `.private/oauth.env` file; never send the secret in chat:

```dotenv
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
```

From this repository, upload the credentials:

```sh
node scripts/cloudflare.mjs secrets
```

This command pipes values directly to Wrangler, displays no values, and creates a random auth secret only if production does not already have one. It does not overwrite an existing auth secret or reuse the development secret. Apply the private GitHub allowlist with `npm run auth:allowlist -- production` before deploying. The allowlist is a runtime secret; numeric IDs pin account access even after a username rename. See [allowlist setup](github-allowlist.md). The GitHub app requests identity/email scopes, not repository-write access.

Then check `/api/health` for `authenticationConfigured: true` and actually sign in through GitHub. Check a note edit/reload, an upload/download, and a full workspace export/upload. A configured health response alone does not prove a successful provider callback. Staging needs a separate OAuth app with callback `https://work-staging.manavbdodia.workers.dev/api/auth/callback/github` and independently generated staging secrets; do not share the production client secret.

## 2. Connect GitHub to Cloudflare Workers Builds

The existing Wrangler OAuth login can deploy Workers, D1 and R2, but returns 403 for Workers Builds configuration. It cannot authorise the Cloudflare GitHub App for the account. [Cloudflare's Builds API setup](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/) requires that one-time app authorisation.

In Cloudflare account `235b7f098227aa97860dfd1d4ea9ee71`, open **Workers & Pages → work → Settings → Builds → Connect**. Authorise the Cloudflare GitHub App for `manav1411/work` only and select:

| Setting | Value |
| --- | --- |
| Repository | `manav1411/work` |
| Production branch | `main` |
| Root directory | `/` |
| Build command | `npm run ci:build` |
| Deploy command | `npm run deploy:ci` |
| Node version/build variable | `NODE_VERSION=22.18.0` |
| Nonproduction/PR production deployments | Disabled |

Create a build token scoped to this Cloudflare account, with Workers Scripts Edit, D1 Edit, R2 Storage Edit, and the zone's Workers Routes Edit permissions required by the deploy/migration commands. Runtime OAuth secrets stay in the Worker, **not** build variables. Builds installs from the committed lockfile. The GitHub `Workspace checks` workflow separately runs the complete browser suite; enable a protected `main` branch requiring its `verify` job if you want to prevent unreviewed pushes.

The optional `node scripts/cloudflare.mjs connect-builds` command automates the repository connection and production trigger **after** GitHub App authorisation, with a user-scoped `CLOUDFLARE_BUILD_API_TOKEN` that has Workers Builds Configuration Edit/Workers Scripts Read and an existing build-token entry named `work-builds`. It refuses to replace existing triggers or reuse an unrelated token. It is not proof of connection until the API succeeds and an actual Git push produces a successful deployment.

Do not connect PR builds to production D1/R2 or production OAuth. A stable staging release is available for separate authorisation tests. Fixture-only previews may be added later with explicitly isolated preview bindings; they are not configured in this release.
