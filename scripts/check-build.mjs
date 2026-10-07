import { readFileSync } from "node:fs";

const environment = process.argv[2] || "production";
if (!["production", "staging"].includes(environment))
  throw new Error("Specify production or staging.");
const config = JSON.parse(readFileSync("dist/work/wrangler.json", "utf8"));
const expected =
  environment === "production"
    ? {
        name: "work",
        database: "9fe1b5fe-24fe-4b43-9667-ad7967b739e1",
        bucket: "work-files-prod",
        origin: "https://work.manavdodia.com",
      }
    : {
        name: "work-staging",
        database: "e7b6920e-f704-499f-be7c-539263cc78b7",
        bucket: "work-files-staging",
        origin: "https://work-staging.manavbdodia.workers.dev",
      };
if (
  config.name !== expected.name ||
  config.vars?.ENVIRONMENT !== environment ||
  config.vars?.APP_ORIGIN !== expected.origin
)
  throw new Error(
    "The built Worker does not match the intended release environment.",
  );
if (
  config.d1_databases?.[0]?.database_id !== expected.database ||
  config.r2_buckets?.[0]?.bucket_name !== expected.bucket
)
  throw new Error(
    "The built storage bindings do not match the intended release environment.",
  );
if (config.vars?.LOCAL_DEV_AUTH)
  throw new Error(
    "Local fixture authentication must never be in a deployed configuration.",
  );
if (
  ["ALLOWED_GITHUB_USERS", "OWNER_GITHUB_LOGIN", "OWNER_GITHUB_ID"].some(
    (name) => Object.hasOwn(config.vars ?? {}, name),
  )
)
  throw new Error(
    "The GitHub allowlist must be a runtime secret, not build vars.",
  );
if (environment === "staging" && config.routes?.length)
  throw new Error("Staging must not attach production domain routes.");
if (
  environment === "production" &&
  !config.routes?.some(
    (route) => route.pattern === "work.manavdodia.com" && route.custom_domain,
  )
)
  throw new Error("The production custom domain is absent.");
console.log(
  `Verified ${environment} build: ${expected.name}, isolated D1/R2, no fixture sign-in.`,
);
