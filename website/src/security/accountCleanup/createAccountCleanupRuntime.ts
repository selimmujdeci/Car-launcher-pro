import { useNotificationStore } from '@/store/notificationStore';
import { usePinDialogStore } from '@/store/pinDialogStore';
import { useVehicleStore } from '@/store/vehicleStore';
import { peekRealtimeRuntime, stopRealtimeRuntime } from '@/lib/realtime/realtimeSyncRuntime';
import { CleanupParticipantRegistry } from './cleanupParticipantRegistry';
import {
  DevicePushRevokeParticipant,
  productionDevicePushAdapter,
} from './devicePushCleanupParticipants';
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
      /* ── ÖLÇÜLEN KUSUR (production, 2026-09-18) ──────────────────────
         Depo kaydında `PURGE_ON_LOGOUT` işaretli oldukları hâlde bu iki
         bellek bağlamını temizleyen kimse YOKTU; çıkış doğrulaması
         `account-scoped-storage-verification:REGISTRY_INVALID` ile
         düşüyordu (kullanıcının telefonunda ölçüldü). İkisi de ÖNCEKİ
         hesabın verisidir: bildirimler araç bağlamı/derin bağlantı
         taşır, realtime aboneliği hesap kuşağına bağlıdır. */
      useNotificationStore.getState().clearAuthority();
      stopRealtimeRuntime();
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
  /* DEVICE_AND_PUSH_REVOKE fazı katılımcısız kalırsa koordinatör o faza
     gelince `MISSING_PHASE_PARTICIPANT` ile DURUR ve çıkış hiçbir zaman
     tamamlanamaz (production'da ölçüldü). */
  participantRegistry.register(
    new DevicePushRevokeParticipant(productionDevicePushAdapter),
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
      /* KAYITLI HER `CUSTOM` TANIM İÇİN DOĞRULAYICI ZORUNLUDUR.
         `verifyAccountScopedStorageEmpty`, `GLOBAL_DEVICE` ve
         `SECURITY_SYSTEM` dışındaki her CUSTOM tanım için doğrulayıcı arar;
         biri eksikse `REGISTRY_INVALID` döner ve ÇIKIŞ TAMAMLANAMAZ.
         Üçü eksikti (notification · realtime · mavi) — production'da
         ölçüldü. */
      {
        'vehicle-zustand-store': () =>
          useVehicleStore.getState().isVehicleAuthorityEmpty(),
        'command-tracker-state': verifyRegisteredCommandAuthorityEmpty,
        'fleet-queue-singleton':
          offlineAuthority.queue.verifyEmpty,
        'notification-zustand-store': () =>
          useNotificationStore.getState().isAuthorityEmpty(),
        /* Runtime yoksa aktif abonelik ve hesap kuşağı bağlamı da yoktur. */
        'realtime-subscription-context': () => peekRealtimeRuntime() === null,
        /* Tanımın kendi açıklaması: "Required registry slot; no current
           persistent mobile Mavi store found." Mobil yüzeyde Mavi deposu
           YOKTUR (kaynak taramasıyla doğrulandı: yalnız filo/dashboard
           yüzeyinde geçer), bu yüzden doğrulanacak bir durum da yoktur.
           Mobil Mavi deposu eklenirse bu doğrulayıcı GERÇEK kontrole
           bağlanmalıdır. */
        'mavi-context-future-adapter': () => true,
      },
    ),
  );

  return { participantRegistry, storageRegistry, memoryAdapter };
}
