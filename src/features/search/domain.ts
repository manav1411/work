export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Could not save. Please try again.";
