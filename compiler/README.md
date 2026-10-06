# Work's private Pi compiler

LaTeX is compiled natively with the official TeX Live 2025 release (8 March 2025), pdfTeX 1.40.27 and latexmk on the Raspberry Pi. Only pdfLaTeX is supported. The pinned toolchain lives in `/opt/work-texlive/2025`, separate from Debian's TeX packages. This is the official release, not the private Overleaf container. The source checkout is `/home/manav/base/work_project`; installed service code is `/opt/work-compiler`, managed by `work-compiler.service`. A separate Node 22 runtime keeps the Pi's global Node installation unchanged. Cloudflare Tunnel routes `work-compiler.manavdodia.com` to the controller on `127.0.0.1:8788`, preserving the Pi's other routes.

The controller runs as a dedicated static unprivileged `work-compiler` account. A static account is required because systemd's `DynamicUser` automatically applies a strict host filesystem namespace that prevents Bubblewrap from creating its own nested mounts. Each job runs in a separate bubblewrap filesystem/PID/network namespace with only TeX tools/fonts/configuration, its own project directory and a private temporary filesystem. It cannot read other home directories, service secrets, or the host filesystem generally. Shell escape and project `latexmkrc` are disabled; CPU, address-space, file-size, process-count and wall-clock limits apply. No containers or local virtual machines are used.

## Installation

Install prerequisites on the Pi:

```sh
sudo apt-get update
sudo apt-get install --no-install-recommends perl curl ca-certificates poppler-utils bubblewrap
```

Copy the compiler files into the project folder. Run `sudo sh install-texlive-2025.sh` first: it downloads the immutable release ISO, checks its SHA-512 digest, mounts it read-only and installs all packages for the host architecture without documentation or source files. It does not change the host's TeX commands. The installation cache is `.texlive-2025/`; the verified ISO is unmounted and removed after installation to conserve disk space. Avoid updating this private installation with `tlmgr update`, since that would change the pinned environment.

`node install-runtime.mjs` downloads the official Node 22 ARM64 release, checks its published SHA-256 digest and installs it in the project's runtime folder. `sudo sh install-pi.sh` creates the dedicated service account, installs and restarts the service, and generates its private bearer token once in `/etc/work-compiler.env`. It requires the pinned TeX installation before activation. `sudo runtime/bin/node configure-tunnel.mjs` adds the dedicated hostname to the existing tunnel and saves a recoverable configuration backup first.

Cloudflare Access uses a dedicated Service Auth policy and service token. Work's Worker secrets are `LATEX_COMPILER_URL`, `LATEX_COMPILER_TOKEN`, `LATEX_ACCESS_CLIENT_ID`, and `LATEX_ACCESS_CLIENT_SECRET`. Credentials belong only in private service/Worker configuration. Local setup can use an SSH port forward to the controller and the same bearer token, without exposing credentials to the browser.

## Queue contract

All endpoints require the compiler bearer token; tunnel requests also require the Access service credentials.

- `GET /health`: native compiler fingerprint, installed versions and current capacity.
- `POST /jobs`: `{jobId,engine,mainFile,files:[{path,contentBase64}]}` → bounded queued job. Repeated IDs with the same source are idempotent; a different source with the same ID is rejected.
- `GET /jobs/:id`: queued/running/succeeded/failed/cancelled state and terminal result with exact PDF bytes, log, extracted text, font report and SyncTeX.
- `DELETE /jobs/:id`: cancel a queued or running job.

The Pi executes one job at a time, with eight pending jobs maximum and a default 90-second deadline. Source projects are limited to 100 files/5 MiB decoded. Terminal state/artifacts expire after one hour and stored results are also count-bounded. Restarted jobs are marked failed rather than silently rerun. Work polls the queue and stores successful outputs in its own private file storage; submitted versions stay tied to immutable source/PDF revisions.

Use `WORK_COMPILER_TMPDIR`, `WORK_COMPILER_PORT`, and `WORK_COMPILE_TIMEOUT` for service configuration. Systemd limits the controller and child processes to 1.5 GiB memory and 128 tasks. Source errors, timeout, cancellation and offline state are surfaced in Work; they never overwrite saved source or falsely report a successful PDF.

## Operations

`GET /health` reports the pinned environment, engine versions and compiler fingerprint. The controller refuses to start with a different pdfTeX release. The fingerprint records native engine versions and runner configuration. Successful job metadata records `texlive-2025-20250308-pdftex-1.40.27`, allowing Work to rebuild PDFs created with an older environment.

Inspect `systemctl status work-compiler` and `journalctl -u work-compiler` on the Pi. Reinstall updated source files with `install-pi.sh`, then restart the service. Tunnel configuration backups are under `/etc/cloudflared/config.yml.work-backup-*`; the other existing services must remain configured. Rotate the bearer token and Access service token together with Work's secrets when needed.
