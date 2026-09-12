export type CarosEnvironment = 'production' | 'development' | 'test';

type NamespaceInput = {
  environment: CarosEnvironment;
  /** A deterministic opaque account hash, never an email or raw account ID. */
  accountId: string;
  domain: string;
  schemaVersion: number;
};

type AccountVehicleNamespaceInput = NamespaceInput & { vehicleId: string };

export type ParsedNamespace = {
  environment: CarosEnvironment;
  accountId?: string;
  vehicleId?: string;
  installationId?: string;
  domain: string;
  schemaVersion: number;
};

const SEGMENT = /^[a-zA-Z0-9_-]{1,96}$/;
const DOMAIN = /^[a-z][a-z0-9-]{0,47}$/;
const INVALID_OWNER = new Set(['null', 'undefined', 'anonymous']);

export function buildAccountNamespace(input: NamespaceInput): string {
  validateOwner(input.accountId, 'ACCOUNT_ID');
  validateDomainAndVersion(input.domain, input.schemaVersion);
  return `caros:${input.environment}:${input.accountId}:${input.domain}:v${input.schemaVersion}`;
}

export function buildAccountVehicleNamespace(
  input: AccountVehicleNamespaceInput,
): string {
  validateOwner(input.accountId, 'ACCOUNT_ID');
  validateOwner(input.vehicleId, 'VEHICLE_ID');
  validateDomainAndVersion(input.domain, input.schemaVersion);
  return `caros:${input.environment}:${input.accountId}:${input.vehicleId}:${input.domain}:v${input.schemaVersion}`;
}

export function buildAnonymousNamespace(input: {
  environment: CarosEnvironment;
  installationId: string;
  domain: string;
  schemaVersion: number;
}): string {
  validateOwner(input.installationId, 'INSTALLATION_ID');
  validateDomainAndVersion(input.domain, input.schemaVersion);
  return `caros:${input.environment}:anonymous:${input.installationId}:${input.domain}:v${input.schemaVersion}`;
}

export function parseCarosNamespace(key: string): ParsedNamespace | null {
  const parts = key.split(':');
  if (parts[0] !== 'caros' || !isEnvironment(parts[1])) return null;
  const version = parts.at(-1);
  if (!version || !/^v[1-9]\d*$/.test(version)) return null;
  const schemaVersion = Number(version.slice(1));
  if (parts.length === 5) {
    const [, environment, accountId, domain] = parts;
    if (!isOwner(accountId) || !DOMAIN.test(domain)) return null;
    return { environment, accountId, domain, schemaVersion };
  }
  if (parts.length === 6) {
    const [, environment, accountId, vehicleId, domain] = parts;
    if (accountId === 'anonymous') {
      if (!isOwner(vehicleId) || !DOMAIN.test(domain)) return null;
      return {
        environment,
        installationId: vehicleId,
        domain,
        schemaVersion,
      };
    }
    if (!isOwner(accountId) || !isOwner(vehicleId) || !DOMAIN.test(domain)) {
      return null;
    }
    return { environment, accountId, vehicleId, domain, schemaVersion };
  }
  return null;
}

export function validateNamespaceOwnership(
  key: string,
  activeAccountId: string,
  activeVehicleId?: string,
  expectedEnvironment?: CarosEnvironment,
): boolean {
  if (!isOwner(activeAccountId)) return false;
  const parsed = parseCarosNamespace(key);
  if (!parsed || parsed.accountId !== activeAccountId) return false;
  if (expectedEnvironment && parsed.environment !== expectedEnvironment) return false;
  if (activeVehicleId !== undefined) {
    return isOwner(activeVehicleId) && parsed.vehicleId === activeVehicleId;
  }
  return true;
}

function validateOwner(value: string, label: string): void {
  if (!isOwner(value)) throw new Error(`${label}_INVALID`);
}

function isOwner(value: string | undefined): value is string {
  return Boolean(value && value.trim() === value && SEGMENT.test(value) &&
    !INVALID_OWNER.has(value.toLowerCase()));
}

function validateDomainAndVersion(domain: string, version: number): void {
  if (!DOMAIN.test(domain)) throw new Error('DOMAIN_INVALID');
  if (!Number.isInteger(version) || version <= 0) {
    throw new Error('SCHEMA_VERSION_INVALID');
  }
}

function isEnvironment(value: string | undefined): value is CarosEnvironment {
  return value === 'production' || value === 'development' || value === 'test';
}
