/**
 * Read-only epoch bridge used at the native PDU boundary.
 * `obdService` remains the sole session-epoch owner; this module stores only
 * its injected reader so the transport layer does not create an import cycle.
 */
let _read: (() => number) | null = null;

export function bindObdSessionEpochReader(read: () => number): void {
  _read = read;
}

export function readObdSessionEpochForNativeBoundary(): number | null {
  try {
    const epoch = _read?.();
    return typeof epoch === 'number' && Number.isFinite(epoch) ? epoch : null;
  } catch {
    return null;
  }
}
