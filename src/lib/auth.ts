import { ApiError } from "./api";

// Authentication always reaches the server, including when leaving the demo.
export async function authRequest(path: string, body: Record<string, unknown>) {
  let response: Response;
  try {
    response = await fetch(`/api/auth${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      "Could not connect. Check your connection and try again.",
    );
  }
  const data = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    message?: string;
  };
  if (!response.ok) {
    const message =
      data.error?.message ||
      data.message ||
      "Something went wrong. Please try again.";
    throw new ApiError(message, response.status, data);
  }
  return data;
}
