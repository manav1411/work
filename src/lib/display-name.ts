import type { UserPreferences, WorkUser } from "../../shared/model";
export function displayName(
  preferences: Pick<UserPreferences, "displayName">,
  user: WorkUser | null,
) {
  return (
    preferences.displayName.trim() ||
    user?.name?.trim() ||
    user?.email ||
    "Account"
  );
}
