import { getSupabaseBrowserClient, isSupabaseConfigured } from './supabaseBrowser';
import type { PlanState } from '@/types/plan';

const DEMO_PLAN: PlanState = {
  plan:        'trial',
  trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  effective:   'pro',
  isPro:       true,
  daysLeft:    30,
  loaded:      true,
};

export async function fetchMyPlan(): Promise<PlanState> {
  if (!isSupabaseConfigured) return DEMO_PLAN;

  try {
    const supabase = getSupabaseBrowserClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { plan: 'free', trialEndsAt: null, effective: 'free', isPro: false, daysLeft: 0, loaded: true };

    const { data, error } = await supabase.rpc('get_my_plan');
    if (error || !data) return DEMO_PLAN;

    const raw = data as {
      plan:          string;
      trial_ends_at: string | null;
      effective:     string;
      is_pro:        boolean;
      days_left:     number;
    };

    return {
      plan:        raw.plan as PlanState['plan'],
      trialEndsAt: raw.trial_ends_at,
      effective:   raw.effective as PlanState['effective'],
      isPro:       raw.is_pro,
      daysLeft:    raw.days_left,
      loaded:      true,
    };
  } catch {
    return DEMO_PLAN;
  }
}
