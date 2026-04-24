export type UserPlan = 'free' | 'trial' | 'pro';

/** Efektif plan: trial aktifken 'pro' döner */
export type EffectivePlan = 'free' | 'pro';

export type ProFeatureKey =
  | 'remote_commands'
  | 'route_send'
  | 'live_location'
  | 'telemetry'
  | 'notifications'
  | 'theme_sync'
  | 'diagnostic_ai'
  | 'vehicle_history'
  | 'geofence_alerts';

export const PRO_FEATURE_LABELS: Record<ProFeatureKey, string> = {
  remote_commands:  'Uzaktan Komut',
  route_send:       'Rota Gönderme',
  live_location:    'Canlı Konum',
  telemetry:        'Telemetri',
  notifications:    'Bildirimler',
  theme_sync:       'Tema Senkronizasyonu',
  diagnostic_ai:    'Diagnostic AI',
  vehicle_history:  'Araç Geçmişi',
  geofence_alerts:  'Geofence Uyarıları',
};

export interface PlanState {
  plan:         UserPlan;
  trialEndsAt:  string | null; // ISO string
  effective:    EffectivePlan;
  isPro:        boolean;
  daysLeft:     number;
  loaded:       boolean;
}
