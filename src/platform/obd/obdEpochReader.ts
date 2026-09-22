/**
 * Read-only epoch bridge used at the native PDU boundary.
 * `obdService` remains the sole session-epoch owner; this module stores only
 * its injected reader so the transport layer does not create an import cycle.
 */
let _read: (() => number) | null = null;

export function bindObdSessionEpochReader(read: () => number): void {
  _read = read;
}

/* Same pattern, opposite direction: the diagnostic layer reports "a response
   for session <epoch> arrived" and `obdService` (the link-liveness owner)
   decides what that proves. Unbound → no-op. */
let _diagnosticLinkActivity: ((sessionEpoch: number) => void) | null = null;

export function bindDiagnosticLinkActivitySink(sink: (sessionEpoch: number) => void): void {
  _diagnosticLinkActivity = sink;
}

export function noteDiagnosticLinkActivity(sessionEpoch: number): void {
  _diagnosticLinkActivity?.(sessionEpoch);
}

export function readObdSessionEpochForNativeBoundary(): number | null {
  try {
    const epoch = _read?.();
    return typeof epoch === 'number' && Number.isFinite(epoch) ? epoch : null;
  } catch {
    return null;
  }
}
