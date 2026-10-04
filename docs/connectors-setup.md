# Historical connector setup (retired)

> Retired by the 4 October 2026 simplification. The material below preserves the earlier connector setup; its deployment statements and commands describe that historical implementation, not the current release or setup instructions. See the [current README](../readme.md) and [verification](verification.md).

The current product has four pages: Home, Learn, Applications, and Documents. There is no Connectors destination. Scheduled source mirroring, suggestion generation, and webhook ingestion are inactive; old webhook delivery paths return a retired response. Do not enable the historical polling or webhook flows as part of the simplified product.

Learn now uses explicit authenticated Work endpoints under `/api/learning` to read authored content, accumulated solve observations, and shared task progress from the fixed personal-site source `https://manavdodia.com`. Configure a LeetCode username in Settings. Overleaf documents are saved URLs that open externally, without an upload or connector setup requirement.

Existing credentials, records, revisions, and files remain retained for recovery. Settings exposes removal of existing connections with imported records kept. Legacy compatibility and credential-retention code is not a background integration workflow. Applying migrations still includes `0003_connectors.sql` before the additive `0004_simplification.sql`; normal learning requests need no new Notion/GitHub connector registration.

## Archived setup reference

Connectors are optional. Work keeps source credentials on the server and imports only the Notion pages and GitHub repositories you select. LeetCode reads a public profile. Overleaf stores a project link beside a PDF version that you save in Work.

## Before connecting

Apply the connector migration to the environment you are setting up. For local development, run `npm run db:local`. Staging and production have separate D1 databases, Worker secrets, OAuth registrations, and provider installations; configure each environment independently.

Copy `.dev.vars.example` to `.dev.vars` for local development. Set a random `CONNECTOR_ENCRYPTION_KEY` of at least 32 characters before using a private Notion token, Notion OAuth, or the GitHub App. The Worker derives an AES-GCM key using this secret and the environment name. If the connector key is absent, it falls back to `BETTER_AUTH_SECRET`; a dedicated connector key is recommended so the two purposes can be rotated independently. Changing either key makes existing encrypted credentials unreadable, so users must reconnect those sources.

Set production and staging secrets with Wrangler, for example:

```sh
npx wrangler secret put CONNECTOR_ENCRYPTION_KEY
npx wrangler secret put NOTION_CLIENT_ID
npx wrangler secret put NOTION_CLIENT_SECRET
npx wrangler secret put GITHUB_APP_ID
npx wrangler secret put GITHUB_APP_SLUG
npx wrangler secret put GITHUB_APP_PRIVATE_KEY
npx wrangler secret put NOTION_WEBHOOK_SECRET
npx wrangler secret put GITHUB_APP_WEBHOOK_SECRET
```

Add `--env staging` when setting staging secrets. Only set provider credentials for providers you plan to enable. Never put secrets in frontend code, `VITE_` variables, record content, screenshots, logs, or content backups. Keep `.dev.vars` out of version control. The checked-in `.dev.vars.example` contains names only.

## Configure each provider

### Notion

There are two connection methods:

- **Public OAuth integration:** configure `NOTION_CLIENT_ID` and `NOTION_CLIENT_SECRET`. Set the integration redirect URI to `https://<your-work-origin>/api/connectors/callback/notion` (use the local origin for local testing). Grant read-content capability only. The user authorizes the integration, then chooses pages in Work. OAuth credentials are encrypted before storage; refresh tokens are refreshed server-side.
- **Selected-page connection token:** this is useful for a private integration or a restricted test workspace. Configure the connector encryption key, paste the integration token in the Notion card, and share only the pages that should be available to that integration. The token is sent to the server for verification and encrypted storage. Do not paste it into an issue, browser console, or a shared document.

Choose pages explicitly. Descendants are optional. Work reads page metadata and enhanced Markdown, copies supported Notion-hosted images/files into private Work storage, and keeps a source link. Unsupported or truncated content is marked in the source metadata. Work does not offer arbitrary property mapping or database-to-record mapping.

Notion webhook setup is an optional administrator flow after connecting Notion:

1. In a signed-in Work session, send `POST /api/connectors/notion/webhook-setup`. The response contains a unique callback URL and a setup ID; pending setup expires after ten minutes.
2. Enter that URL in the Notion integration's webhook settings. Notion sends its initial verification challenge to that specific callback. Work stores the challenge token encrypted and accepts it only once.
3. Retrieve the token through the authenticated `GET /api/connectors/notion/webhook-setup/<id>` endpoint and enter it in Notion to verify the subscription. Keep it out of logs and source control.

Subsequent events must have a valid `X-Notion-Signature` using the registered token. Duplicate deliveries are tracked. Events bring the selected connection forward for the next scheduler dispatch; they do not synchronously fetch page contents. The scheduled poll remains the recovery path. An already verified subscription can instead use the global `/api/connectors/webhooks/notion` endpoint with `NOTION_WEBHOOK_SECRET` set to its actual verification token. Work does not accept an unsigned challenge on that global endpoint.

### GitHub

Public repositories can be connected by entering a GitHub username or profile URL. No GitHub access token is requested. Discovery is limited to public repositories.

For private repositories, create a dedicated GitHub App for Work and configure `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, and `GITHUB_APP_PRIVATE_KEY`. Grant read-only repository metadata and contents permissions. Set the app setup callback to `https://<your-work-origin>/api/connectors/callback/github`, and set its webhook URL to `https://<your-work-origin>/api/connectors/webhooks/github` with a random `GITHUB_APP_WEBHOOK_SECRET`. Install the app on the personal GitHub account used to sign in to Work, then select repositories. Organization installations are not supported by the current callback ownership check. Do not use the GitHub sign-in app's OAuth credentials as repository credentials.

Work imports repository metadata and a bounded README. A repository change can create a prompt to capture a decision or contribution; it is not treated as evidence that you personally made a particular achievement.

### LeetCode

Enter the public LeetCode username. Work requests public profile difficulty totals, the submission calendar, and the provider's latest accepted-submission feed. There is no LeetCode sign-in or private credential. The feed is partial: it does not provide a complete history, and Work does not invent older solve dates. Repeated solves in the returned feed retain their submission identity where available and otherwise use the problem slug and timestamp.

### Overleaf

Enter a private Overleaf project URL and choose the résumé asset it belongs to, or create a résumé asset through the connection flow. Overleaf is a link, not a live editor integration. After editing in Overleaf, export the PDF and upload/save it as a new version in Work's Assets area. Submitted application PDFs remain separate snapshots.

## Use and maintain connections

Open **Connectors** to review a connection, select or map sources, refresh, pause, resume, or disconnect. When linking a source to an existing Work note or project, review the record before selecting it. The initial connection does not automatically reconcile older imports by title or overwrite an existing record unless you choose that mapping.

The Worker checks for due syncs every 15 minutes. Current polling intervals are 30 minutes for Notion, one hour for GitHub, and four hours for LeetCode. Each dispatch processes at most eight due connections, and Notion/GitHub imports process at most five selected sources per chunk; longer imports resume from their saved cursor. Webhook notifications can request an earlier refresh, while scheduled polling catches missed events. A manual refresh is rate-limited to once per minute. Provider rate limits and access errors appear in the connection status; the last successful content remains available while a source needs attention.

Pause a source when you want to stop automatic updates temporarily. Disconnecting removes its stored credential and webhook registrations, and attempts to revoke Notion OAuth access or uninstall the dedicated GitHub App when applicable. If revocation is unavailable, Work displays the provider-side step to finish it. Internal Notion integration tokens are removed locally; remove the integration's shared-page access in Notion if required. OAuth token revocation follows [Notion's revoke endpoint](https://developers.notion.com/reference/revoke-token).

When deselecting or disconnecting, choose a detached copy or removal of cached source content. Work annotations, relationships, and project plans remain. Removal purges synced note text, its historical copies, and copied media; independent Work copies remain. An attachment used in a submitted application is protected, so retain that source copy rather than remove it. Source access loss hides affected private content in normal views, search, revisions, and attachment access until access is restored or retention is resolved.

Content backups include connector identities, configurations, retained records, copied files, and observed activity, and exclude OAuth tokens, integration tokens, installation tokens, private keys, and webhook secrets. Restore leaves connections disconnected and records editable; reauthorize and reselect sources to resume updates on the same mapped records. Reconnecting after a key rotation requires provider authorization again.

## Local demo and verification

The local demo uses synthetic connector fixtures. It does not call Notion, GitHub, LeetCode, or Overleaf. To exercise real provider requests, configure the matching secrets in a non-production environment and connect only test pages/repositories that you are comfortable importing. Confirm discovery, a selected-source refresh, private attachment access where applicable, disconnect retention, and reconnection before enabling the provider for a live workspace.

Use the provider's test workspace/account for webhook setup. Verify the provider signature and event delivery without logging request bodies or secrets. Live provider registrations and selected-source smoke tests are environment-specific and are not implied by the mocked adapter tests.
