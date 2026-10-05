import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { pathToFileURL } from "node:url";

export const LIMITS = {
  files: 100,
  bytes: 20 * 1024 * 1024,
  body: 29 * 1024 * 1024,
  pdf: 10 * 1024 * 1024,
  log: 150000,
};
const ENGINES = new Set(["pdflatex", "xelatex", "lualatex"]);

export function validateJob(input) {
  if (
    !input ||
    typeof input !== "object" ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(input.jobId)
  )
    throw new Error("Invalid job ID");
  if (!ENGINES.has(input.engine)) throw new Error("Unsupported engine");
  if (
    !Array.isArray(input.files) ||
    !input.files.length ||
    input.files.length > LIMITS.files
  )
    throw new Error("Invalid project files");
  let bytes = 0;
  const paths = new Set();
  const files = input.files.map((file) => {
    if (
      typeof file.path !== "string" ||
      !file.path.length ||
      file.path.length > 240 ||
      // Reject shell metacharacters as well as archive-control characters.
      // eslint-disable-next-line no-control-regex
      /[\u0000-\u001f\u007f:\\`$'";|<>&*?!(){}[\]]/.test(file.path) ||
      file.path.startsWith("/") ||
      !/\.(tex|cls|sty|bib|bst|png|jpg|jpeg|pdf|eps|otf|ttf|woff2?|txt|csv|json|def|cfg|clo|fd|dat)$/i.test(
        file.path,
      ) ||
      file.path.split("/").some((part) => !part || part.startsWith(".")) ||
      file.path.toLowerCase().startsWith("build/") ||
      file.path.toLowerCase() === "build" ||
      /(^|\/)(\.?latexmkrc)$/i.test(file.path)
    )
      throw new Error("Unsafe or unsupported source path");
    if (
      [...paths].some((path) => path.toLowerCase() === file.path.toLowerCase())
    )
      throw new Error("Duplicate source path");
    if (
      typeof file.contentBase64 !== "string" ||
      file.contentBase64.length > LIMITS.body ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        file.contentBase64,
      )
    )
      throw new Error("Invalid source encoding");
    const content = Buffer.from(file.contentBase64, "base64");
    bytes += content.length;
    if (bytes > LIMITS.bytes) throw new Error("Project too large");
    paths.add(file.path);
    return { path: file.path, content };
  });
  if (
    typeof input.mainFile !== "string" ||
    !paths.has(input.mainFile) ||
    !/\.tex$/i.test(input.mainFile)
  )
    throw new Error("Main file must be a project .tex file");
  for (const path of paths) {
    let parent = posix.dirname(path);
    while (parent !== ".") {
      if (paths.has(parent))
        throw new Error("Source path collides with a directory");
      parent = posix.dirname(parent);
    }
  }
  return {
    jobId: input.jobId,
    engine: input.engine,
    mainFile: input.mainFile,
    files,
  };
}

export function inputHash(job) {
  const hash = createHash("sha256").update(
    JSON.stringify({ engine: job.engine, mainFile: job.mainFile }),
  );
  for (const file of [...job.files].sort((a, b) =>
    a.path.localeCompare(b.path),
  )) {
    hash
      .update("\0")
      .update(file.path)
      .update("\0")
      .update(String(file.content.length))
      .update("\0")
      .update(file.content);
  }
  return hash.digest("hex");
}

export function diagnostics(log) {
  return log
    .split("\n")
    .flatMap((line) => {
      const error = /^(.+?\.\w+):(\d+):\s*(.+)$/.exec(line);
      if (error)
        return [
          {
            file: error[1].replace(/^\.\//, ""),
            line: Number(error[2]),
            severity: "error",
            message: error[3].slice(0, 1000),
          },
        ];
      if (
        /^(?:LaTeX|Package .+?) Warning:|^(?:Overfull|Underfull) \\[hv]box/.test(
          line,
        )
      )
        return [{ severity: "warning", message: line.slice(0, 1000) }];
      return [];
    })
    .slice(0, 200);
}

function command(args, limit = 65536) {
  return new Promise((resolve, reject) => {
    const proc = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("Docker control command timed out"));
    }, 10000);
    for (const stream of [proc.stdout, proc.stderr])
      stream.on("data", (chunk) => {
        output = (output + chunk).slice(-limit);
      });
    proc.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    proc.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(output || `Docker exited ${code}`));
    });
  });
}
async function outputFile(path, limit, tail = false) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || (info.size > limit && !tail))
      return null;
    const contents = await readFile(path);
    return tail ? contents.subarray(-limit) : contents;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function startCompiler({
  token,
  image = "work-texlive:2025",
  host = "127.0.0.1",
  port = 8788,
  timeout = 20000,
  concurrency = 2,
  temporaryDirectory = process.env.WORK_COMPILER_TMPDIR || tmpdir(),
} = {}) {
  if (!token || token.length < 24)
    throw new Error("WORK_COMPILER_TOKEN must contain at least 24 characters");
  if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 22000)
    throw new Error("Compile timeout must be 1000–22000 ms");
  const info = JSON.parse(await command(["image", "inspect", image]))[0];
  const imageDigest = info.Id;
  if (!/^sha256:[a-f0-9]{64}$/.test(imageDigest))
    throw new Error("Compiler image is not available locally");
  const jobs = new Map();
  const auth = Buffer.from(`Bearer ${token}`);
  async function compile(job, state) {
    const directory = await mkdtemp(join(temporaryDirectory, "work-tex-"));
    try {
      await chmod(directory, 0o777);
      for (const file of job.files) {
        const target = join(directory, file.path);
        await mkdir(dirname(target), { recursive: true, mode: 0o755 });
        await writeFile(target, file.content, { mode: 0o444 });
      }
      await mkdir(join(directory, "build"), { mode: 0o777 });
      await chmod(join(directory, "build"), 0o777);
      if (state.cancelled) throw new Error("Compile cancelled");
      const name = `work-tex-${createHash("sha256").update(job.jobId).digest("hex").slice(0, 24)}`;
      state.name = name;
      const args = [
        "run",
        "--rm",
        "--pull=never",
        "--name",
        name,
        "--network=none",
        "--read-only",
        "--user",
        "65532:65532",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--pids-limit=128",
        "--memory=768m",
        "--memory-swap=768m",
        "--cpus=1",
        "--ulimit",
        "fsize=16384:16384",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,noexec,size=128m",
        "--mount",
        `type=bind,source=${directory},target=/job`,
        imageDigest,
        job.engine,
        job.mainFile,
      ];
      const proc = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
      state.process = proc;
      let consoleLog = "";
      for (const stream of [proc.stdout, proc.stderr])
        stream.on("data", (chunk) => {
          consoleLog = (consoleLog + chunk).slice(-LIMITS.log);
        });
      const kill = async () => {
        state.cancelled = true;
        await command(["rm", "-f", name]).catch(() => {});
        proc.kill("SIGKILL");
      };
      state.cancel = kill;
      if (state.cancelled) void kill();
      const timer = setTimeout(() => void kill(), timeout);
      const code = await new Promise((resolve, reject) => {
        proc.once("error", reject);
        proc.once("close", resolve);
      }).finally(() => clearTimeout(timer));
      // Always remove a container, including daemon failures/disconnects.
      await command(["rm", "-f", name]).catch(() => {});
      const build = join(directory, "build");
      const pdf =
        !state.cancelled && code === 0
          ? await outputFile(join(build, "output.pdf"), LIMITS.pdf)
          : null;
      const log = (
        (
          await outputFile(join(build, "compile.log"), LIMITS.log, true)
        )?.toString() || consoleLog
      ).slice(-LIMITS.log);
      const engineVersion =
        (await outputFile(join(build, "engine.txt"), 4096))
          ?.toString()
          .split("\n")[0] || "";
      const latexmkVersion =
        (await outputFile(join(build, "latexmk.txt"), 4096))
          ?.toString()
          .trim() || "";
      return {
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
        log: state.cancelled ? `Compile cancelled or timed out.\n${log}` : log,
        text:
          (await outputFile(join(build, "text.txt"), 500000))?.toString() || "",
        fonts:
          (await outputFile(join(build, "fonts.txt"), 20000))?.toString() || "",
        diagnostics: diagnostics(log),
        metadata: {
          imageDigest,
          texLiveRelease:
            /TeX Live\s+(\d{4})/.exec(engineVersion)?.[1] || "unknown",
          engine: job.engine,
          engineVersion,
          inputHash: inputHash(job),
          configuration: {
            latexmkVersion,
            shellEscape: false,
            customLatexmkrc: false,
            synctex: true,
            network: false,
          },
        },
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  const server = createServer(async (req, res) => {
    const reply = (code, body) => {
      if (!res.destroyed) {
        res.writeHead(code, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        res.end(JSON.stringify(body));
      }
    };
    const supplied = Buffer.from(req.headers.authorization || "");
    if (supplied.length !== auth.length || !timingSafeEqual(supplied, auth))
      return reply(401, { error: "Unauthorized" });
    if (req.method === "GET" && req.url === "/health")
      return reply(200, {
        ready: true,
        imageDigest,
        activeJobs: jobs.size,
        engines: [...ENGINES],
      });
    if (
      req.method === "DELETE" &&
      /^\/jobs\/[a-zA-Z0-9_-]{1,100}$/.test(req.url || "")
    ) {
      const state = jobs.get(req.url.slice(6));
      if (state) {
        state.cancelled = true;
        await state.cancel?.();
      }
      return reply(200, { cancelled: Boolean(state) });
    }
    if (req.method !== "POST" || req.url !== "/compile")
      return reply(404, { error: "Not found" });
    if (jobs.size >= concurrency)
      return reply(429, { error: "Compiler busy; retry shortly" });
    let state;
    let job;
    try {
      let length = 0;
      const chunks = [];
      for await (const chunk of req) {
        length += chunk.length;
        if (length > LIMITS.body) {
          reply(413, { error: "Project too large" });
          req.destroy();
          return;
        }
        chunks.push(chunk);
      }
      job = validateJob(JSON.parse(Buffer.concat(chunks).toString()));
      // Recheck after reading, since several requests can arrive together.
      if (jobs.has(job.jobId))
        return reply(409, { error: "Job already running" });
      if (jobs.size >= concurrency)
        return reply(429, { error: "Compiler busy; retry shortly" });
      state = { cancelled: false };
      jobs.set(job.jobId, state);
      res.on("close", () => {
        if (!res.writableEnded) {
          state.cancelled = true;
          void state.cancel?.();
        }
      });
      reply(200, await compile(job, state));
    } catch (error) {
      reply(state ? 500 : 400, { error: error.message });
    } finally {
      if (state) jobs.delete(job.jobId);
    }
  });
  server.requestTimeout = timeout + 15000;
  server.headersTimeout = 10000;
  server.on("close", () => {
    for (const state of jobs.values()) {
      state.cancelled = true;
      void state.cancel?.();
    }
  });
  await new Promise((resolve) => server.listen(port, host, resolve));
  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  startCompiler({
    token: process.env.WORK_COMPILER_TOKEN,
    image: process.env.WORK_TEX_IMAGE,
    host: process.env.WORK_COMPILER_HOST || "127.0.0.1",
    port: Number(process.env.WORK_COMPILER_PORT || 8788),
    timeout: Number(process.env.WORK_COMPILE_TIMEOUT || 20000),
  })
    .then((server) => {
      process.stdout.write(
        `Work compiler listening on ${JSON.stringify(server.address())}\n`,
      );
      const stop = () => {
        server.closeAllConnections();
        server.close(() => process.exit(0));
      };
      process.on("SIGTERM", stop);
      process.on("SIGINT", stop);
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
