# Email authentication and deployment setup

## 1. Email authentication

Follow [email setup and owner cutover](email-auth-setup.md). Better Auth uses email/password, six-digit verification and password recovery; the private Pi sender must pass network, DNS, SMTP and inbox-delivery checks before production cutover. Preserve existing Better Auth secrets and all workspace ownership. GitHub repository/build integration below remains independent of user sign-in.

## 2. Connect GitHub to Cloudflare Workers Builds

The existing Wrangler OAuth login can deploy Workers, D1 and R2, but returns 403 for Workers Builds configuration. It cannot authorise the Cloudflare GitHub App for the account. [Cloudflare's Builds API setup](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/) requires that one-time app authorisation.

In Cloudflare account `235b7f098227aa97860dfd1d4ea9ee71`, open **Workers & Pages → work → Settings → Builds → Connect**. Authorise the Cloudflare GitHub App for `manav1411/work` only and select:

| Setting                                 | Value                  |
| --------------------------------------- | ---------------------- |
| Repository                              | `manav1411/work`       |
| Production branch                       | `main`                 |
| Root directory                          | `/`                    |
| Build command                           | `npm run ci:build`     |
| Deploy command                          | `npm run deploy:ci`    |
| Node version/build variable             | `NODE_VERSION=22.18.0` |
| Nonproduction/PR production deployments | Disabled               |

Create a build token scoped to this Cloudflare account, with Workers Scripts Edit, D1 Edit, R2 Storage Edit, and the zone's Workers Routes Edit permissions required by the deploy/migration commands. Runtime authentication secrets stay in the Worker, **not** build variables. Builds installs from the committed lockfile. The GitHub `Workspace checks` workflow separately runs the complete browser suite; enable a protected `main` branch requiring its `verify` job if you want to prevent unreviewed pushes.

The optional `node scripts/cloudflare.mjs connect-builds` command automates the repository connection and production trigger **after** GitHub App authorisation, with a user-scoped `CLOUDFLARE_BUILD_API_TOKEN` that has Workers Builds Configuration Edit/Workers Scripts Read and an existing build-token entry named `work-builds`. It refuses to replace existing triggers or reuse an unrelated token. It is not proof of connection until the API succeeds and an actual Git push produces a successful deployment.

Do not connect PR builds to production D1/R2 or production authentication. A stable staging release is available for separate authorisation tests. Fixture-only previews may be added later with explicitly isolated preview bindings; they are not configured in this release.
