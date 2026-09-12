export type AuthCleanupTarget = Readonly<{
  accountId: string;
  sessionFingerprint: string;
}>;

let currentTarget: AuthCleanupTarget | null = null;
let observation = 0;

export async function observeAuthCleanupTarget(
  session: { access_token?: string; user?: { id?: string } } | null,
): Promise<void> {
  const sequence = ++observation;
  if (!session?.access_token || !session.user?.id) {
    currentTarget = null;
    return;
  }
  const sessionFingerprint = await hashSecret(session.access_token);
  if (sequence !== observation) return;
  currentTarget = Object.freeze({
    accountId: session.user.id,
    sessionFingerprint,
  });
}

export function captureAuthCleanupTarget(): AuthCleanupTarget | null {
  return currentTarget ? Object.freeze({ ...currentTarget }) : null;
}

export function resetAuthCleanupTargetForTests(): void {
  observation += 1;
  currentTarget = null;
}

async function hashSecret(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
