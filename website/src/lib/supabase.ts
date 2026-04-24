import { getSupabaseBrowserClient, isSupabaseConfigured } from './supabaseBrowser';

export { isSupabaseConfigured };
export const supabaseBrowser = isSupabaseConfigured ? getSupabaseBrowserClient() : null;
