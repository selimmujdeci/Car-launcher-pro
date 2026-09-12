/**
 * diagnosticSessionEvidence — P0-VDK-F1B · OTURUM/KEEPALIVE KANIT DEFTERİ.
 *
 * Süreç-ömürlü, sınırlı halka defter. Timer YOK, I/O YOK, karar YOK — yalnız
 * KAYIT. Her satır `evidenceCorrelationId` ile kanonik tanı işlemine bağlanır
 * (`DiagnosticTransaction.evidenceCorrelationId`), böylece "hangi tarama
 * sırasında hangi ECU'da oturum açıldı ve kaç keepalive gitti" sorusu tek
 * yerden yanıtlanabilir.
 *
 * ── NEDEN AYRI DEFTER ─────────────────────────────────────────────────────
 * `advancedDtcEvidence` DTC okumalarının kanıtıdır; oturum ömrü AYRI bir
 * gerçektir ve onu oraya karıştırmak iki farklı zaman ölçeğini (istek vs
 * oturum) tek satıra sıkıştırırdı. `dtcPipelineAccounting` ile de karışmaz:
 * keepalive hiçbir DTC üretmez, sayım zincirine GİRMEZ.
 */

/** Oturum yaşam döngüsünün ÖLÇÜLEBİLİR olayları. */
export type SessionEvidenceKind =
  /** Kira açıldı — oturum henüz kanıtlanmadı. */
  | 'SESSION_OPEN_ATTEMPT'
  /** Native varsayılan dışı oturum AÇTI (kanıt: komut). */
  | 'SESSION_OPEN_POSITIVE'
  /** Oturum açılmadı/gerekmedi → varsayılan oturum, keepalive YOK. */
  | 'SESSION_OPEN_NOT_REQUIRED'
  /** Oturum açılışı açıkça reddedildi. */
  | 'SESSION_OPEN_NEGATIVE'
  /** Oturum açılışına yanıt gelmedi. */
  | 'SESSION_OPEN_NO_RESPONSE'
  /** `3E 00` hatta çıktı. */
  | 'KEEPALIVE_SENT'
  /** `7E 00` geldi — oturum canlı, KANITLI. */
  | 'KEEPALIVE_POSITIVE'
  /** Negatif yanıt (NRC provenance korunur). */
  | 'KEEPALIVE_NEGATIVE'
  /** ECU sustu — oturum öldü DEMEK DEĞİL, ölçüm YOK. */
  | 'KEEPALIVE_NO_RESPONSE'
  /** Oturum penceresi doldu / mühür bozuldu. */
  | 'SESSION_EXPIRED'
  /** Kira normal kapandı. */
  | 'SESSION_CLOSED';

export const SESSION_EVIDENCE_LABEL: Readonly<Record<SessionEvidenceKind, string>> = {
  SESSION_OPEN_ATTEMPT:      'oturum kirası açıldı',
  SESSION_OPEN_POSITIVE:     'OTURUM AÇILDI (kanıtlı)',
  SESSION_OPEN_NOT_REQUIRED: 'varsayılan oturum — keepalive GEREKMEZ',
  SESSION_OPEN_NEGATIVE:     'oturum açılışı REDDEDİLDİ',
  SESSION_OPEN_NO_RESPONSE:  'oturum açılışına yanıt YOK',
  KEEPALIVE_SENT:            'keepalive gönderildi (3E 00)',
  KEEPALIVE_POSITIVE:        'keepalive OK (7E 00)',
  KEEPALIVE_NEGATIVE:        'keepalive NEGATİF (NRC)',
  KEEPALIVE_NO_RESPONSE:     'keepalive YANITSIZ',
  SESSION_EXPIRED:           'OTURUM DÜŞTÜ / mühür bozuldu',
  SESSION_CLOSED:            'oturum kirası kapandı',
} as const;

export interface SessionEvidenceEntry {
  readonly kind: SessionEvidenceKind;
  readonly leaseId: string;
  readonly transactionId: string;
  /** Kanonik işleme bağlayan kimlik. */
  readonly evidenceCorrelationId: string;
  readonly rxHeader: string | null;
  readonly txHeader: string | null;
  readonly protocol: string | null;
  readonly sessionEpoch: number;
  readonly atMs: number;
  readonly nrc?: number | null;
  readonly detail: string;
}

/** Tavan — 8 ECU × (açılış + birkaç keepalive) iki tur geçmişi. */
export const SESSION_EVIDENCE_MAX = 96;

let _entries: SessionEvidenceEntry[] = [];

/** Kanıt yazar. ASLA throw etmez — defter ürünü düşüremez. */
export function recordSessionEvidence(e: SessionEvidenceEntry): void {
  try {
    _entries.push(e);
    if (_entries.length > SESSION_EVIDENCE_MAX) {
      _entries = _entries.slice(-SESSION_EVIDENCE_MAX);
    }
  } catch { /* kanıt kaydı taramayı DÜŞÜRMEZ */ }
}

export function getSessionEvidence(): readonly SessionEvidenceEntry[] { return [..._entries]; }

/** Test kancası — üretim yolunda ÇAĞRILMAZ. */
export function _resetSessionEvidenceForTest(): void { _entries = []; }

export interface SessionEvidenceSummary {
  readonly total: number;
  readonly sessionsOpened: number;
  readonly keepAliveSent: number;
  readonly keepAlivePositive: number;
  readonly keepAliveFailed: number;
  readonly expired: number;
  /** Keepalive başarı oranı; hiç gönderilmediyse `null` (sahte %100 YASAK). */
  readonly successRate: number | null;
}

export function summarizeSessionEvidence(
  entries: readonly SessionEvidenceEntry[],
  correlationId: string | null = null,
): SessionEvidenceSummary {
  const scoped = correlationId === null
    ? entries
    : entries.filter((e) => e.evidenceCorrelationId === correlationId);
  const sent = scoped.filter((e) => e.kind === 'KEEPALIVE_SENT').length;
  const pos = scoped.filter((e) => e.kind === 'KEEPALIVE_POSITIVE').length;
  const bad = scoped.filter((e) =>
    e.kind === 'KEEPALIVE_NEGATIVE' || e.kind === 'KEEPALIVE_NO_RESPONSE').length;
  return {
    total: scoped.length,
    sessionsOpened: scoped.filter((e) => e.kind === 'SESSION_OPEN_POSITIVE').length,
    keepAliveSent: sent,
    keepAlivePositive: pos,
    keepAliveFailed: bad,
    expired: scoped.filter((e) => e.kind === 'SESSION_EXPIRED').length,
    successRate: sent === 0 ? null : pos / sent,
  };
}
