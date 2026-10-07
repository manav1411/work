# Verification

Required checks: TypeScript/ESLint, unit/API tests, browser tests, production build, and built Worker runtime checks.

API coverage verifies current contracts, ownership, current-content retry receipts, conflict counters, permanent deletion and parent cascades, account removal, complete file export/upload, replacement semantics, missing files, changed workspaces, repeated commit requests, and stale device writes. Runtime checks execute the built Worker with D1/R2, including a file package larger than 18 MB and native source pruning. Authentication callback and GitHub allowlist tests remain independent.

Browser checks cover the current editor, application process/scheduling, interview tabs/STAR content, learning roadmap, appearance controls, and native documents. No compatibility or recovery UI is expected.

Deployment verification should check `/api/health` in both environments, private APIs rejecting unauthenticated requests, current database tables, empty reset testing content, and empty old file storage. Real GitHub callback checks require an interactive allowed account; automated synthetic identities never authenticate production.
