import { createServer } from "node:http";
import { spawn, execFile } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LIMITS, validateJob, inputHash, diagnostics } from "./protocol.mjs";
export { LIMITS, validateJob, inputHash, diagnostics } from "./protocol.mjs";
const execute = promisify(execFile),
  base = dirname(fileURLToPath(import.meta.url));
const texEnvironment = "texlive-2025-20250308-pdftex-1.40.27";
async function outputFile(path, limit) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > limit)
      return null;
    return await readFile(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function startCompiler({
  token,
  host = "127.0.0.1",
  port = 8788,
  timeout = 90000,
  temporaryDirectory = process.env.WORK_COMPILER_TMPDIR || join(base, "state"),
  texliveDirectory = process.env.WORK_TEXLIVE_ROOT || "/opt/work-texlive/2025",
} = {}) {
  if (!token || token.length < 24)
    throw new Error("WORK_COMPILER_TOKEN must contain at least 24 characters");
  if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 180000)
    throw new Error("Compile timeout must be 1000–180000 ms");
  await mkdir(temporaryDirectory, { recursive: true, mode: 0o700 });
  const texliveBin = join(
    resolve(texliveDirectory),
    "bin",
    process.arch === "arm64" ? "aarch64-linux" : "x86_64-linux",
  );
  const compilerPath = `${texliveBin}:/usr/bin:/bin`;
  const versions = await Promise.all(
    ["pdflatex", "latexmk", "pdftotext"].map(async (engine) => {
      const { stdout, stderr } = await execute(
        engine === "pdftotext"
          ? "/usr/bin/pdftotext"
          : join(texliveBin, engine),
        [
          engine === "latexmk"
            ? "-version"
            : engine === "pdftotext"
              ? "-v"
              : "--version",
        ],
        { maxBuffer: 8192, env: { ...process.env, PATH: compilerPath } },
      );
      return `${engine}:${(stdout || stderr).trim()}`;
    }),
  );
  if (!versions[0].includes("1.40.27 (TeX Live 2025)"))
    throw new Error(
      "This service requires the official TeX Live 2025 release with pdfTeX 1.40.27. Run install-texlive-2025.sh before activating it.",
    );
  await execute("bwrap", ["--version"]);
  const compilerFingerprint = createHash("sha256")
    .update(versions.join("\n"))
    .update(await readFile(join(base, "run-job.sh")))
    .digest("hex");
  const auth = Buffer.from(`Bearer ${token}`),
    jobs = new Map();
  let active = null;
  for (const filename of await readdir(temporaryDirectory)) {
    if (/^work-tex-[a-zA-Z0-9]+$/.test(filename)) {
      await rm(join(temporaryDirectory, filename), {
        recursive: true,
        force: true,
      });
      continue;
    }
    if (/^[a-zA-Z0-9_-]+\.json$/.test(filename)) {
      try {
        const state = JSON.parse(
          await readFile(join(temporaryDirectory, filename), "utf8"),
        );
        if (["queued", "running"].includes(state.status)) {
          state.status = "failed";
          state.result = {
            success: false,
            log: "Compiler restarted before this job finished. Recompile the saved source.",
            text: "",
            fonts: "",
            diagnostics: [],
            metadata: { compilerFingerprint },
          };
          await writeFile(
            join(temporaryDirectory, filename),
            JSON.stringify(state),
            { mode: 0o600 },
          );
        }
        if (Date.now() - state.updatedAt < 3600000) jobs.set(state.id, state);
        else await rm(join(temporaryDirectory, filename));
      } catch {
        /* corrupted state is not usable */
      }
    }
  }
  const persist = (state) =>
    writeFile(
      join(temporaryDirectory, `${state.id}.json`),
      JSON.stringify({
        id: state.id,
        status: state.status,
        updatedAt: state.updatedAt,
        hash: state.hash,
        result: state.result,
      }),
      { mode: 0o600 },
    );
  const publicState = (state) => ({
    id: state.id,
    status: state.status,
    updatedAt: state.updatedAt,
    ...(state.result ? { result: state.result } : {}),
  });
  async function compile(state) {
    const job = state.job,
      directory = await mkdtemp(join(temporaryDirectory, "work-tex-"));
    state.directory = directory;
    await chmod(directory, 0o700);
    try {
      for (const file of job.files) {
        const path = join(directory, file.path);
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await writeFile(path, file.content, { mode: 0o600 });
      }
      await mkdir(join(directory, "build"), { mode: 0o700 });
      const args = [
        "--die-with-parent",
        "--new-session",
        "--unshare-all",
        "--ro-bind",
        "/usr",
        "/usr",
        "--ro-bind",
        resolve(texliveDirectory),
        resolve(texliveDirectory),
        "--symlink",
        "usr/bin",
        "/bin",
        "--symlink",
        "usr/lib",
        "/lib",
        "--symlink",
        "usr/lib64",
        "/lib64",
        "--proc",
        "/proc",
        "--dev",
        "/dev",
        "--tmpfs",
        "/tmp",
        "--dir",
        "/etc",
        "--ro-bind",
        "/etc/fonts",
        "/etc/fonts",
        "--dir",
        "/var",
        "--dir",
        "/var/cache",
        "--ro-bind",
        "/var/cache/fontconfig",
        "/var/cache/fontconfig",
        "--bind",
        directory,
        "/job",
        "--ro-bind",
        join(base, "run-job.sh"),
        "/runner.sh",
        "--chdir",
        "/job",
        "--clearenv",
        "--setenv",
        "PATH",
        compilerPath,
        "/usr/bin/prlimit",
        "--cpu=90",
        "--as=1073741824",
        "--fsize=16777216",
        "--nproc=64",
        "--",
        "/bin/sh",
        "/runner.sh",
        job.engine,
        job.mainFile,
      ];
      const proc = spawn("bwrap", args, {
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
      state.process = proc;
      let consoleLog = "";
      for (const stream of [proc.stdout, proc.stderr])
        stream.on("data", (chunk) => {
          consoleLog = (consoleLog + chunk).slice(-LIMITS.log);
        });
      const kill = () => {
        try {
          process.kill(-proc.pid, "SIGKILL");
        } catch {
          /* already stopped */
        }
      };
      state.cancel = kill;
      const timer = setTimeout(() => {
        state.timedOut = true;
        kill();
      }, timeout);
      const code = await new Promise((res, rej) => {
        proc.once("error", rej);
        proc.once("close", res);
      }).finally(() => clearTimeout(timer));
      const build = join(directory, "build"),
        pdf =
          code === 0 && !state.timedOut
            ? await outputFile(join(build, "output.pdf"), LIMITS.pdf)
            : null;
      const log = (
        (
          await outputFile(join(build, "compile.log"), LIMITS.log)
        )?.toString() || consoleLog
      ).slice(-LIMITS.log);
      state.result = {
        success: Boolean(pdf),
        ...(pdf
          ? {
              pdfBase64: pdf.toString("base64"),
              synctexBase64: (
                await outputFile(
                  join(build, "output.synctex.gz"),
                  2 * 1024 * 1024,
                )
              )?.toString("base64"),
            }
          : {}),
        log: state.timedOut ? `Compile timed out.\n${log}` : log,
        text:
          (await outputFile(join(build, "text.txt"), 500000))?.toString() || "",
        fonts:
          (await outputFile(join(build, "fonts.txt"), 20000))?.toString() || "",
        diagnostics: diagnostics(log),
        metadata: {
          texEnvironment,
          compilerFingerprint,
          texLiveRelease:
            /TeX Live\s+(\d{4})/.exec(versions[0])?.[1] || "unknown",
          engine: job.engine,
          inputHash: inputHash(job),
          configuration: {
            latexmkVersion: versions[1].slice(0, 200),
            shellEscape: false,
            customLatexmkrc: false,
            synctex: true,
            network: false,
          },
        },
      };
      if (state.status !== "cancelled")
        state.status = pdf ? "succeeded" : "failed";
    } catch (error) {
      if (state.status !== "cancelled") {
        state.status = "failed";
        state.result = {
          success: false,
          log: error.message,
          text: "",
          fonts: "",
          diagnostics: [],
          metadata: { compilerFingerprint },
        };
      }
    } finally {
      state.updatedAt = Date.now();
      delete state.job;
      delete state.process;
      delete state.cancel;
      delete state.directory;
      await rm(directory, { recursive: true, force: true });
      await persist(state);
    }
  }
  async function drain() {
    if (active) return;
    const next = [...jobs.values()].find(
      (state) => state.status === "queued" && state.job,
    );
    if (!next) return;
    active = next;
    next.status = "running";
    next.updatedAt = Date.now();
    await persist(next);
    await compile(next);
    active = null;
    void drain();
  }
  const cleanup = setInterval(() => {
    for (const [id, state] of jobs)
      if (
        !["queued", "running"].includes(state.status) &&
        Date.now() - state.updatedAt > 3600000
      ) {
        jobs.delete(id);
        void rm(join(temporaryDirectory, `${id}.json`), { force: true });
      }
  }, 60000);
  cleanup.unref();
  const server = createServer(async (req, res) => {
    const reply = (status, data) => {
      if (!res.destroyed) {
        res.writeHead(status, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        res.end(JSON.stringify(data));
      }
    };
    const supplied = Buffer.from(req.headers.authorization || "");
    if (supplied.length !== auth.length || !timingSafeEqual(supplied, auth))
      return reply(401, { error: "Unauthorized" });
    try {
      if (req.method === "GET" && req.url === "/health")
        return reply(200, {
          ready: true,
          compilerFingerprint,
          activeJobs: active ? 1 : 0,
          engines: ["pdflatex"],
          texEnvironment,
          versions,
        });
      const match = /^\/jobs\/([a-zA-Z0-9_-]{1,100})$/.exec(req.url || "");
      if (match) {
        const state = jobs.get(match[1]);
        if (!state) return reply(404, { error: "Job not found" });
        if (req.method === "DELETE") {
          if (["queued", "running"].includes(state.status)) {
            state.status = "cancelled";
            state.updatedAt = Date.now();
            state.cancel?.();
            delete state.job;
            await persist(state);
          }
          return reply(200, publicState(state));
        }
        if (req.method === "GET") return reply(200, publicState(state));
      }
      if (req.method !== "POST" || req.url !== "/jobs")
        return reply(404, { error: "Not found" });
      const chunks = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > LIMITS.body)
          return reply(413, { error: "Project too large" });
        chunks.push(chunk);
      }
      const job = validateJob(JSON.parse(Buffer.concat(chunks).toString()));
      const existing = jobs.get(job.jobId);
      if (existing) {
        if (existing.hash !== inputHash(job))
          return reply(409, {
            error: "Job ID already belongs to different source",
          });
        return reply(200, publicState(existing));
      }
      if (
        [...jobs.values()].filter((state) =>
          ["queued", "running"].includes(state.status),
        ).length >= 8
      )
        return reply(429, { error: "Compiler queue is full" });
      if (jobs.size >= 24) {
        const oldest = [...jobs.values()]
          .filter((state) => !["queued", "running"].includes(state.status))
          .sort((a, b) => a.updatedAt - b.updatedAt)[0];
        if (oldest) {
          jobs.delete(oldest.id);
          await rm(join(temporaryDirectory, `${oldest.id}.json`), {
            force: true,
          });
        }
      }
      const state = {
        id: job.jobId,
        status: "queued",
        updatedAt: Date.now(),
        hash: inputHash(job),
        job,
      };
      jobs.set(state.id, state);
      await persist(state);
      reply(202, publicState(state));
      void drain();
    } catch (error) {
      reply(400, { error: error.message });
    }
  });
  server.on("close", () => {
    clearInterval(cleanup);
    active?.cancel?.();
  });
  server.requestTimeout = 15000;
  await new Promise((res, rej) => {
    server.once("error", rej);
    server.listen(port, host, res);
  });
  return server;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const server = await startCompiler({
    token: process.env.WORK_COMPILER_TOKEN,
    host: process.env.WORK_COMPILER_HOST || "127.0.0.1",
    port: Number(process.env.WORK_COMPILER_PORT || 8788),
    timeout: Number(process.env.WORK_COMPILE_TIMEOUT || 90000),
  });
  console.log(
    `Private native compiler listening on ${JSON.stringify(server.address())}`,
  );
}
