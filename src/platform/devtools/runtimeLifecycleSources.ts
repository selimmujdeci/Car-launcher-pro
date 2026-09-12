/** CAROS LAB F1 source: one synchronous, read-only existing diagnostic read. */
import { systemBoot } from '../system/SystemBoot';
import { adaptSystemBootLifecycle, type SystemBootLifecyclePilot } from '../runtime/systemBootLifecycleAdapter';

export function readSystemBootLifecyclePilot(): SystemBootLifecyclePilot | null {
  try { return adaptSystemBootLifecycle(systemBoot.getLifecycleDiagnostics()); }
  catch { return null; }
}
