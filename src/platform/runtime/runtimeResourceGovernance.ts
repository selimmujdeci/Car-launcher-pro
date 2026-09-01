/** ARCH-01/F7 — SAF resource policy projection; AdaptiveRuntimeManager remains executor. */
export type ResourceClass = 'SAFETY_CRITICAL' | 'VEHICLE_REALTIME' | 'USER_INTERACTIVE' | 'BACKGROUND_HIGH' | 'BACKGROUND_LOW' | 'MAINTENANCE' | 'BEST_EFFORT' | 'UNKNOWN';
export type ResourceDimension = 'CPU' | 'MEMORY' | 'THERMAL' | 'IO' | 'NETWORK' | 'POLLING' | 'WORKER_SLOT';
export type ResourceDecision = 'RUN' | 'DEFER' | 'THROTTLE' | 'DROP_STALE' | 'DELEGATE_DOMAIN' | 'DENY' | 'UNKNOWN';
export type CadenceDecision = 'NORMAL' | 'REDUCED' | 'MINIMAL' | 'PAUSED' | 'DELEGATE_DOMAIN_CADENCE' | 'UNKNOWN';
export interface ResourceTaskEvidence { readonly taskId: string; readonly resourceClass: ResourceClass; readonly dimensions: readonly ResourceDimension[]; readonly requestedBudget: number | null; readonly grantedBudget: number | null; readonly pressure: Readonly<Partial<Record<ResourceDimension, number | 'UNKNOWN'>>>; readonly preemptible: boolean | null; readonly resumable: boolean | null; readonly decision: ResourceDecision; readonly deferCount: number; readonly starvationRisk: boolean | null; readonly reason: string; readonly provenance: readonly string[]; }
export function decideResourceTask(task: Pick<ResourceTaskEvidence, 'resourceClass' | 'preemptible' | 'pressure'> & { readonly stale?: boolean; readonly domainManagedCadence?: boolean; }): ResourceDecision {
  if (task.domainManagedCadence) return 'DELEGATE_DOMAIN';
  if (task.stale && (task.resourceClass === 'BEST_EFFORT' || task.resourceClass === 'BACKGROUND_LOW')) return 'DROP_STALE';
  const thermal = task.pressure.THERMAL; const memory = task.pressure.MEMORY;
  if (thermal === 'UNKNOWN' || memory === 'UNKNOWN') return task.resourceClass === 'UNKNOWN' ? 'UNKNOWN' : 'RUN';
  if (typeof thermal === 'number' && thermal >= 3) return task.resourceClass === 'BEST_EFFORT' || task.resourceClass === 'BACKGROUND_LOW' ? 'DENY' : task.resourceClass === 'MAINTENANCE' || task.resourceClass === 'BACKGROUND_HIGH' ? 'THROTTLE' : 'RUN';
  if (typeof memory === 'number' && memory >= 3) return task.resourceClass === 'BEST_EFFORT' ? 'DENY' : task.resourceClass === 'BACKGROUND_LOW' ? 'DEFER' : 'RUN';
  return 'RUN';
}
export function cadenceForDomain(domain: 'OBD' | 'UNKNOWN', pressure: number | 'UNKNOWN'): CadenceDecision { if (domain === 'OBD') return 'DELEGATE_DOMAIN_CADENCE'; if (pressure === 'UNKNOWN') return 'UNKNOWN'; return pressure >= 3 ? 'MINIMAL' : pressure >= 2 ? 'REDUCED' : 'NORMAL'; }
