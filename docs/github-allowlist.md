# GitHub access allowlist

Edit `.private/github-allowlist.json` to add or remove accounts. This file is ignored by Git and must stay private. A fresh checkout must create it locally; the repository contains no default account list.

The file is a JSON array. Each entry has a `login` and may have an `id` containing the numeric GitHub account ID as a string. Example with a fictitious account:

```json
[{ "login": "example-user", "id": "12345" }]
```

An ID pins the account even if its username changes. Login-only entries such as `{ "login": "example-user" }` match the provider-verified username case insensitively. Use GitHub's public user API at `https://api.github.com/users/<username>` to find the account's `id`. Remove an entire entry to revoke access. `[]` denies everyone. Invalid JSON, invalid entries, or a missing secret also deny everyone.

Apply the file to the environment you want to change:

```sh
npm run auth:allowlist -- local
npm run auth:allowlist -- production
npm run auth:allowlist -- staging
```

Local application preserves other settings in ignored `.dev.vars`; restart the development server afterward. The local fixture remains available only on loopback when `ENVIRONMENT=local` and `LOCAL_DEV_AUTH=true`. Set `LOCAL_DEV_AUTH=false` to exercise real GitHub sign-in locally.

Production and staging commands upload only `ALLOWED_GITHUB_USERS` as a [Cloudflare Worker secret](https://developers.cloudflare.com/workers/configuration/secrets/), passing its value over stdin with output suppressed. Wrangler authentication is required. Apply the secret before the first deployment of the allowlist implementation. Once that implementation is deployed, later list changes apply without a code deployment. Every private request checks the current list, so removed accounts lose access even with an existing session.

The file, `.dev.vars`, and the runtime secret belong outside GitHub. Do not put list values in `wrangler.jsonc`, frontend `VITE_*` variables, build settings, committed examples, or documentation. The build configuration guard rejects allowlist values in public Worker vars. Keep the current private configuration available when setting up another machine.
