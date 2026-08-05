// Everyone logs in with a plain username + password. Supabase Auth itself
// is email-based, so we deterministically map each username to a synthetic
// internal email address behind the scenes — users never see or type it.
const USERNAME_EMAIL_DOMAIN = "d88-mondial.internal";

// Must stay a valid email local-part once mapped through usernameToEmail --
// in particular no spaces, or Supabase Auth rejects the synthetic address
// with "Unable to validate email address: invalid format".
const USERNAME_PATTERN = /^[a-z0-9._-]+$/;

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${USERNAME_EMAIL_DOMAIN}`;
}

export function isValidUsername(username: string): boolean {
  return USERNAME_PATTERN.test(username.trim().toLowerCase());
}

export const USERNAME_FORMAT_HINT =
  "Username can only contain lowercase letters, numbers, dots, underscores, and hyphens (no spaces).";
