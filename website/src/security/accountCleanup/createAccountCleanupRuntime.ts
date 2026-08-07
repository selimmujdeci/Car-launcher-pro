import { usePinDialogStore } from '@/store/pinDialogStore';
import { useVehicleStore } from '@/store/vehicleStore';
import { CleanupParticipantRegistry } from './cleanupParticipantRegistry';
import {
  AccountScopedStorageVerificationParticipant,
  BrowserStorageAdapter,
  createProductionStorageRegistry,
} from './storage';
import {
  BrowserVehicleCleanupStorage,
  VehicleAuthorityVerificationParticipant,
  VehicleCredentialCleanupParticipant,
  VehicleIdentityStorageCleanupParticipant,
  VehicleMemoryAuthorityCleanupParticipant,
  type VehicleAuthorityMemoryAdapter,
} from './vehicleCleanupParticipants';
import {
  clearRegisteredCommandAuthority,
  verifyRegisteredCommandAuthorityEmpty,
} from './vehicleAuthorityRuntime';
import {
  createProductionOfflineAuthorityAdapters,
  OfflineAuthorityVerificationParticipant,
  OfflineQueueCleanupParticipant,
  OwnershipSnapshotCleanupParticipant,
  PendingPairingCleanupParticipant,
} from './offlineAuthorityCleanupParticipants';
import {
  ServerSessionRevokeParticipant,
  ServerSessionVerificationParticipant,
  SupabaseServerSessionCleanupAdapter,
  type ServerSessionCleanupAdapter,
} from './serverSessionCleanupParticipants';

export type VehicleCleanupComposition = {
  participantRegistry: CleanupParticipantRegistry;
  storageRegistry: ReturnType<typeof createProductionStorageRegistry>;
  memoryAdapter: VehicleAuthorityMemoryAdapter;
};

/**
 * Safe composition foundation only. It neither creates a coordinator nor wires
 * logout. Browser storage is resolved lazily when a participant actually runs.
 */
export function createVehicleCleanupComposition(
  getStorage: () => Storage = () => window.localStorage,
  serverSessionAdapter: ServerSessionCleanupAdapter =
    new SupabaseServerSessionCleanupAdapter(),
): VehicleCleanupComposition {
  const participantRegistry = new CleanupParticipantRegistry();
  const storageRegistry = createProductionStorageRegistry();
  const storage = new BrowserVehicleCleanupStorage(getStorage);
  const memoryAdapter: VehicleAuthorityMemoryAdapter = {
    clearVehicleAuthority: () => {
      useVehicleStore.getState().clearVehicleAuthority();
      usePinDialogStore.getState().clearAuthority();
      clearRegisteredCommandAuthority();
    },
    verifyVehicleAuthorityEmpty: () =>
      useVehicleStore.getState().isVehicleAuthorityEmpty() &&
      usePinDialogStore.getState().isAuthorityEmpty() &&
      verifyRegisteredCommandAuthorityEmpty(),
  };
  const offlineAuthority = createProductionOfflineAuthorityAdapters();

  participantRegistry.register(new VehicleCredentialCleanupParticipant(storage));
  participantRegistry.register(
    new VehicleIdentityStorageCleanupParticipant(storage),
  );
  participantRegistry.register(
    new VehicleMemoryAuthorityCleanupParticipant(memoryAdapter),
  );
  participantRegistry.register(
    new VehicleAuthorityVerificationParticipant(storage, memoryAdapter),
  );
  participantRegistry.register(
    new OfflineQueueCleanupParticipant(offlineAuthority.queue),
  );
  participantRegistry.register(
    new OwnershipSnapshotCleanupParticipant(offlineAuthority.ownership),
  );
  participantRegistry.register(
    new PendingPairingCleanupParticipant(offlineAuthority.pairing),
  );
  participantRegistry.register(
    new ServerSessionRevokeParticipant(serverSessionAdapter),
  );
  participantRegistry.register(
    new OfflineAuthorityVerificationParticipant(
      offlineAuthority.queue,
      offlineAuthority.ownership,
      offlineAuthority.pairing,
    ),
  );
  participantRegistry.register(
    new ServerSessionVerificationParticipant(serverSessionAdapter),
  );
  participantRegistry.register(
    new AccountScopedStorageVerificationParticipant(
      storageRegistry,
      [
        new BrowserStorageAdapter('LOCAL_STORAGE', getStorage),
      ],
      {
        'vehicle-zustand-store': () =>
          useVehicleStore.getState().isVehicleAuthorityEmpty(),
        'command-tracker-state': verifyRegisteredCommandAuthorityEmpty,
        'fleet-queue-singleton':
          offlineAuthority.queue.verifyEmpty,
      },
    ),
  );

  return { participantRegistry, storageRegistry, memoryAdapter };
}
