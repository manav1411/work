# Work's private LaTeX compiler

This is an actual TeX Live/latexmk execution service. It never renders HTML as a substitute PDF. The Work Worker is the authenticated gateway; this service receives bounded source files and sends the same compiled PDF bytes, SyncTeX, compiler log, extracted text and font inspection back to it.

The job image starts from the full historic TeX Live 2025 snapshot. The gateway resolves the locally built image's immutable `sha256` image ID at startup and executes that exact ID for every job, recording it and the actual engine/version/configuration in each response. Production builds should additionally set `TEX_BASE` to an approved registry **digest**, retain the built image, and avoid unattended rebuilds: the historic TeX tag freezes TeX packages but the Dockerfile's Poppler installation is a separate OS snapshot dependency.

Image documentation: [Island of TeX Docker images](https://github.com/islandoftex/texlive). Reproducing existing documents requires the same engine, package/font snapshot and project settings. Custom `latexmkrc` files contain executable Perl and are rejected under the default supported policy; unsupported project configuration is reported rather than executed.

## Local setup

Requires Docker and Node 22+. Build the real TeX Live image before starting the service. On macOS, a Docker-compatible VM such as Colima supplies the Linux runtime; production uses a dedicated Linux host. Provisioning the public application does not automatically provision this separate private compiler.

```sh
docker build -t work-texlive:2025 compiler
export WORK_COMPILER_TOKEN='a-long-random-private-token-at-least-24-characters'
node compiler/server.mjs
```

`WORK_TEX_IMAGE` selects the already-built image (default `work-texlive:2025`). `WORK_COMPILER_HOST` defaults to localhost; `WORK_COMPILER_PORT` defaults to 8788. Use the same token in the Work gateway's compiler secret. Put this service behind private networking or TLS; do not publish the Docker socket or the token. The gateway process needs permission to launch Docker, and should run on a dedicated compilation host, separate from application secrets and other workloads.

`WORK_COMPILER_TMPDIR` optionally selects an existing job directory visible to the Docker daemon. On macOS with Colima, use a directory under a mounted home folder, for example `.private/compiler-tmp` in this repository; the macOS default temporary directory may not be mounted in the VM. On a Linux host, the ordinary system temporary directory works.

The token exists only in the parent service. It is never passed as a container environment variable or mounted file. Each job gets its own temporary source/output folder, runs UID/GID 65532, disables shell escape, has no network, drops capabilities, uses a read-only root filesystem and receives CPU/memory/process/time/file-size limits. Source paths, encodings, duplicate paths and collisions are checked before any write. Symlink outputs are never returned. Jobs and directories are removed on success, error, timeout and request cancellation.

Use a bounded host temporary filesystem (for example a dedicated 512 MiB tmpfs mounted at the service's `TMPDIR`) and a bounded host process/log policy in production. Individual output files are capped and only PDF/SyncTeX/log/text/font outputs are returned; a bounded temporary filesystem also constrains the sum of any unwanted outputs created by hostile sources. Size the volume/concurrency for two jobs maximum, with a 20-second job deadline. `WORK_COMPILE_TIMEOUT` permits 1,000–22,000 milliseconds so cancellation precedes the Work gateway's 25-second deadline and Worker background-task limit. Runtime containers never pull images or install dependencies.

## HTTP contract

All requests require `Authorization: Bearer <WORK_COMPILER_TOKEN>`.

- `GET /health`: actual resolved image digest, active job count and supported engines.
- `POST /compile`: `{jobId, engine, mainFile, files:[{path,contentBase64}]}`. Engines: `pdflatex`, `xelatex`, `lualatex`. Up to 100 files/20 MiB decoded. The Work gateway may apply a smaller limit. This request waits for compilation and returns `{success,pdfBase64?,synctexBase64?,log,text,fonts,diagnostics,metadata}`. TeX errors produce `success:false` and the real log; malformed requests return 400. Capacity returns 429. Infrastructure failures return 500.
- `DELETE /jobs/:jobId`: removes a running job container. Closing the compile connection also cancels that job.

The synchronous channel is intentional: the Worker owns the async job record, background task and browser polling, while the compiler keeps no durable user data. Job IDs must be unique opaque IDs minted by the Worker.

## Verify before hosting

For a focused local verification, run `node compiler/smoke.mjs` after building the image. It verifies one real résumé compile, PDF bytes, extracted text and embedded fonts. Before hosting additional engines or templates, check those intended projects with their chosen engine/package/font snapshot. LaTeX and font fidelity do not guarantee every ATS parser's behaviour.

Record image size, a cold and warm compile duration, peak memory and disk use before choosing a Linux host. No hosting cost estimate is claimed until those measurements exist. This service requires a Docker-capable host; ordinary Worker isolates cannot run TeX Live or launch its containers.
