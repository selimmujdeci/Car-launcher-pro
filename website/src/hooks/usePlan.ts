'use client';

import { useEffect } from 'react';
import { usePlanStore } from '@/store/planStore';
import type { ProFeatureKey } from '@/types/plan';

export function usePlan() {
  const store = usePlanStore();

  useEffect(() => {
    if (!store.loaded) {
      void store.initialize();
    }
  }, [store.loaded, store.initialize]);

  return {
    plan:        store.plan,
    trialEndsAt: store.trialEndsAt,
    effective:   store.effective,
    isPro:       store.isPro,
    isTrial:     store.plan === 'trial',
    daysLeft:    store.daysLeft,
    loaded:      store.loaded,
    canUse:      (feature: ProFeatureKey) => store.canUse(feature),
  };
}
