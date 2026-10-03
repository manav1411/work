import type { WorkUser } from "../shared/model";

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ENVIRONMENT: "local" | "staging" | "production";
  LOCAL_DEV_AUTH?: string;
  BETTER_AUTH_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  OWNER_GITHUB_LOGIN: string;
  OWNER_GITHUB_ID?: string;
  APP_ORIGIN: string;
  ASSETS?: Fetcher;
}

export interface Variables {
  user: WorkUser;
  local: boolean;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const now = () => new Date().toISOString();
export const id = () => crypto.randomUUID();
