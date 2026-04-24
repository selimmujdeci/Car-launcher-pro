import { create } from 'zustand';
import { fetchMyPlan } from '@/lib/planService';
import type { PlanState, ProFeatureKey } from '@/types/plan';

interface PlanStore extends PlanState {
  initialize: () => Promise<void>;
  canUse: (feature: ProFeatureKey) => boolean;
}

export const usePlanStore = create<PlanStore>((set, get) => ({
  plan:        'trial',
  trialEndsAt: null,
  effective:   'pro',
  isPro:       true,
  daysLeft:    30,
  loaded:      false,

  initialize: async () => {
    const state = await fetchMyPlan();
    set(state);
  },

  // Tüm PRO özellikler aynı kontrol: isPro ise açık, değilse kilitli
  canUse: (_feature: ProFeatureKey) => get().isPro,
}));
