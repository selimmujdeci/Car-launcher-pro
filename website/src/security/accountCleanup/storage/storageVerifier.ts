import type {
  AccountCleanupParticipant,
  CleanupContext,
  CleanupParticipantResult,
} from '../cleanupTypes';
import type { AccountScopedStorageRegistry } from './storageRegistry';
import { scanKnownClientStorage } from './storageScanner';
import type {
  EnumerableStorageAdapter,
  StorageVerifyEmptyResult,
} from './storageTypes';
import type { CarosEnvironment } from './storageNamespace';

export type CustomStorageVerifier = () => boolean | Promise<boolean>;

export async function verifyAccountScopedStorageEmpty(input: {
  registry: AccountScopedStorageRegistry;
  adapters: readonly EnumerableStorageAdapter[];
  customVerifiers?: Readonly<Record<string, CustomStorageVerifier>>;
  previousAccountId?: string;
  environment?: CarosEnvironment;
}): Promise<StorageVerifyEmptyResult> {
  const validation = input.registry.validateStorageRegistry();
  if (!validation.ok || validation.descriptorCount === 0) {
    return { ok: false, failureCode: 'REGISTRY_INVALID' };
  }

  const cleanupDescriptors = input.registry
    .listStorageDescriptors()
    .filter((descriptor) =>
      descriptor.scope !== 'GLOBAL_DEVICE' &&
      descriptor.scope !== 'SECURITY_SYSTEM');

  for (const descriptor of cleanupDescriptors) {
    if (descriptor.verifyStrategy !== 'CUSTOM') continue;
    const verifier = descriptor.customVerifierId
      ? input.customVerifiers?.[descriptor.customVerifierId]
      : undefined;
    if (!verifier) {
      return {
        ok: false,
        failureCode: 'REGISTRY_INVALID',
        descriptorIds: [descriptor.id],
      };
    }
    let empty = false;
    try {
      empty = await verifier();
    } catch {
      empty = false;
    }
    if (!empty) {
      return {
        ok: false,
        failureCode: 'REGISTERED_STORAGE_NOT_EMPTY',
        descriptorIds: [descriptor.id],
      };
    }
  }

  const scan = scanKnownClientStorage({
    registry: input.registry,
    adapters: input.adapters,
    activeAccountId: input.previousAccountId,
    environment: input.environment,
  });
  if (scan.failureCode) {
    return { ok: false, failureCode: 'STORAGE_UNAVAILABLE' };
  }
  if (scan.corruptedEntries.length) {
    return {
      ok: false,
      failureCode: 'STORAGE_CORRUPTED',
      descriptorIds: ids(scan.corruptedEntries),
      physicalKeys: keys(scan.corruptedEntries),
    };
  }
  if (scan.namespaceMismatches.length) {
    return {
      ok: false,
      failureCode: 'NAMESPACE_MISMATCH',
      descriptorIds: ids(scan.namespaceMismatches),
      physicalKeys: keys(scan.namespaceMismatches),
    };
  }
  if (scan.unregisteredKnownEntries.length || scan.suspiciousEntries.length) {
    const entries = [
      ...scan.unregisteredKnownEntries,
      ...scan.suspiciousEntries,
    ];
    return {
      ok: false,
      failureCode: 'UNREGISTERED_ACCOUNT_STORAGE_FOUND',
      descriptorIds: ids(entries),
      physicalKeys: keys(entries),
    };
  }

  const nonEmpty = scan.registeredEntries.filter((entry) => {
    const descriptor = entry.descriptorId
      ? input.registry.getStorageDescriptor(entry.descriptorId)
      : null;
    return descriptor &&
      descriptor.scope !== 'GLOBAL_DEVICE' &&
      descriptor.scope !== 'SECURITY_SYSTEM';
  });
  if (nonEmpty.length) {
    return {
      ok: false,
      failureCode: 'REGISTERED_STORAGE_NOT_EMPTY',
      descriptorIds: ids(nonEmpty),
      physicalKeys: keys(nonEmpty),
    };
  }
  return {
    ok: true,
    checkedDescriptorIds: cleanupDescriptors.map(({ id }) => id),
  };
}

export class AccountScopedStorageVerificationParticipant
implements AccountCleanupParticipant {
  readonly id = 'account-scoped-storage-verification';
  readonly phase = 'VERIFY_EMPTY' as const;
  readonly priority = 100;
  private lastResult: StorageVerifyEmptyResult | null = null;

  constructor(
    private readonly registry: AccountScopedStorageRegistry,
    private readonly adapters: readonly EnumerableStorageAdapter[],
    private readonly customVerifiers: Readonly<
      Record<string, CustomStorageVerifier>
    > = {},
    private readonly environment?: CarosEnvironment,
  ) {}

  async clear(context: CleanupContext): Promise<CleanupParticipantResult> {
    this.lastResult = await verifyAccountScopedStorageEmpty({
      registry: this.registry,
      adapters: this.adapters,
      customVerifiers: this.customVerifiers,
      previousAccountId: context.previousAccountHash,
      environment: this.environment,
    });
    return this.lastResult.ok
      ? { ok: true, code: 'ALREADY_EMPTY' }
      : {
          ok: false,
          retryable: this.lastResult.failureCode === 'STORAGE_UNAVAILABLE',
          failureCode: this.lastResult.failureCode,
        };
  }

  async verifyEmpty(_context: CleanupContext): Promise<boolean> {
    return this.lastResult?.ok === true;
  }

  getLastResult(): StorageVerifyEmptyResult | null {
    return this.lastResult;
  }
}

function ids(entries: readonly { descriptorId?: string }[]): string[] {
  return Array.from(new Set(entries.flatMap((entry) =>
    entry.descriptorId ? [entry.descriptorId] : [])));
}

function keys(entries: readonly { key: string }[]): string[] {
  return Array.from(new Set(entries.map(({ key }) => key)));
}
