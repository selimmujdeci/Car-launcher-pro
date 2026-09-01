/**
 * ARCH-03 read-only LAB adapter. It aggregates owner-local bounded evidence;
 * it does not publish, route, execute, retry, or retain a second history.
 */
import { getMediaCommandFlowEvidence } from '../media/authority/mediaCommandGateway';
import { getNavigationCommandFlowEvidence } from '../navigationService';
import { getDiagnosticCommandFlowEvidence } from '../obd/diagnosticTransaction';
import { runtimeRecoverySupervisor } from '../runtime/runtimeRecoverySupervisor';
import { getSettingsCommandFlowEvidence } from '../../store/useStore';
import { getPerformanceModeCommandFlowEvidence } from '../performanceMode';
import type { CommandMessage } from '../message';

export interface CommandEventFlowLabSnapshot {
  readonly readOnly: true;
  readonly flows: Readonly<Record<string, readonly CommandMessage[]>>;
}

export function readCommandEventFlowLabSnapshot(): CommandEventFlowLabSnapshot {
  const media = getMediaCommandFlowEvidence();
  return Object.freeze({
    readOnly: true,
    flows: Object.freeze({
      MEDIA: Object.freeze([media.command, media.result].filter((x): x is CommandMessage => x !== null)),
      NAVIGATION: getNavigationCommandFlowEvidence(),
      OBD: getDiagnosticCommandFlowEvidence(),
      RUNTIME: runtimeRecoverySupervisor.getCommandFlowEvidence(),
      SETTINGS: Object.freeze([...getSettingsCommandFlowEvidence(), ...getPerformanceModeCommandFlowEvidence()]),
    }),
  });
}
