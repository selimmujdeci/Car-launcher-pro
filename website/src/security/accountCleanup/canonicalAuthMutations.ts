import type { SupabaseClient } from '@supabase/supabase-js';
import { withAuthSessionMutationLock } from './authSessionMutationLock';

type AuthClient = SupabaseClient['auth'];

/** Uygulama-kaynaklı bütün auth session yazımlarının tek otoritesi. */
export function runCanonicalAuthMutation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  return withAuthSessionMutationLock(operation);
}

export function canonicalSignInWithPassword(
  client: SupabaseClient,
  value: Parameters<AuthClient['signInWithPassword']>[0],
): ReturnType<AuthClient['signInWithPassword']> {
  return runCanonicalAuthMutation(() => client.auth.signInWithPassword(value));
}

export function canonicalSignUp(
  client: SupabaseClient,
  value: Parameters<AuthClient['signUp']>[0],
): ReturnType<AuthClient['signUp']> {
  return runCanonicalAuthMutation(() => client.auth.signUp(value));
}

export function canonicalSignInWithOAuth(
  client: SupabaseClient,
  value: Parameters<AuthClient['signInWithOAuth']>[0],
): ReturnType<AuthClient['signInWithOAuth']> {
  return runCanonicalAuthMutation(() => client.auth.signInWithOAuth(value));
}

export function canonicalVerifyOtp(
  client: SupabaseClient,
  value: Parameters<AuthClient['verifyOtp']>[0],
): ReturnType<AuthClient['verifyOtp']> {
  return runCanonicalAuthMutation(() => client.auth.verifyOtp(value));
}

export function canonicalSetSession(
  client: SupabaseClient,
  value: Parameters<AuthClient['setSession']>[0],
): ReturnType<AuthClient['setSession']> {
  return runCanonicalAuthMutation(() => client.auth.setSession(value));
}

export function canonicalUpdateUser(
  client: SupabaseClient,
  value: Parameters<AuthClient['updateUser']>[0],
): ReturnType<AuthClient['updateUser']> {
  return runCanonicalAuthMutation(() => client.auth.updateUser(value));
}

export function canonicalSignInAnonymously(
  client: SupabaseClient,
  value?: Parameters<AuthClient['signInAnonymously']>[0],
): ReturnType<AuthClient['signInAnonymously']> {
  return runCanonicalAuthMutation(() => client.auth.signInAnonymously(value));
}

export function canonicalExchangeCodeForSession(
  client: SupabaseClient,
  code: Parameters<AuthClient['exchangeCodeForSession']>[0],
): ReturnType<AuthClient['exchangeCodeForSession']> {
  return runCanonicalAuthMutation(
    () => client.auth.exchangeCodeForSession(code),
  );
}
