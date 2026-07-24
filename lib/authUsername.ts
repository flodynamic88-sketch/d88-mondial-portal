// Everyone logs in with a plain username + password. Supabase Auth itself
// is email-based, so we deterministically map each username to a synthetic
// internal email address behind the scenes — users never see or type it.
const USERNAME_EMAIL_DOMAIN = "d88-mondial.internal";

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${USERNAME_EMAIL_DOMAIN}`;
}
