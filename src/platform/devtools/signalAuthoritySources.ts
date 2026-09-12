/**
 * signalAuthoritySources — Sinyal Otoritesi ekranının TEK OKUMA KATMANI (senkron, saf-dışı).
 *
 * NEDEN VAR (V-04): `signalHub` yazılmıştı ama ürün yolunda **sıfır tüketicisi** vardı —
 * yani "tek otoriter sinyal yüzeyimiz var" sanılıyor, gerçekte hiç çalışmıyordu. Bu dosya
 * onu gerçek bir okuyucuya bağlar.
 *
 * ⚠️ İKİNCİ MOTOR KURULMAZ: burada poll, timer, abonelik YOKTUR. `signalHub.readSignal`
 * PULL tabanlıdır (boşta sıfır maliyet); ekran açılışta bir kez ve elle YENİLE'de okur.
 * Hiçbir yeni ECU trafiği doğmaz — mevcut depolardan okunur, o kadar.
 *
 * ⚠️ ZARF DEĞİŞTİRİLMEZ: `SignalEnvelope` olduğu gibi taşınır. Burada yeniden
 * sınıflandırma, yeniden güven hesabı veya "birleşik hüküm" ÜRETİLMEZ — o iş hub'ındır.
 * Paralel otorite kurmamak bu ekranın varlık sebebiyle çelişmez, tam tersi onu korur.
 */
import { readSignal, coreSignalIds } from '../obd/signalHub';
import type { SignalEnvelope } from '../obd/signalEnvelope';
import { isPidSupported } from '../obd/extendedPidService';
import { STANDARD_PIDS } from '../obd/StandardPidRegistry';

/** Tek satırlık ham okuma — kimlik + zarf. Zarf HUB'ın ürettiğidir, dokunulmaz. */
export interface SignalRow {
  readonly id:   string;
  readonly kind: 'core' | 'pid';
  /** İnsan-okunur ad; `pid:` satırlarında registry adı, core'da kimliğin kendisi. */
  readonly name: string;
  readonly env:  SignalEnvelope;
}

export interface SignalAuthoritySnapshot {
  readonly readAt: number;
  readonly rows:   readonly SignalRow[];
  /** Araç desteğini KANITLAMIŞ extended PID sayısı (kırpmadan ÖNCE). */
  readonly supportedPidCount: number;
  /** Kaç desteklenen PID ekrana sığmadığı için kırpıldı. 0 = kırpma YOK. */
  readonly trimmedPidCount: number;
  /** Okuma sırasında hata olduysa ham mesaj — sessizce yutulmaz. */
  readonly error:  string | null;
}

/**
 * Gösterilecek extended PID tavanı.
 *
 * NEDEN SINIR VAR ve NEDEN GÖRÜNÜR: 101 PID'in tamamını listelemek ekranı okunmaz
 * yapardı. Ama sessiz kırpma, "hepsi bu" yanılsaması üretir (CLAUDE.md: kapsam
 * daraltılıyorsa GÖRÜNÜR olmalı) — bu yüzden kırpma bilgisi snapshot'ta taşınır ve
 * ekranda yazılır.
 */
export const PID_ROW_CAP = 24;

function _safeRead(id: string, nowMs: number): SignalEnvelope | null {
  try { return readSignal(id, nowMs); } catch { return null; }
}

/**
 * Tek seferlik senkron okuma.
 *
 * Hangi satırlar: TÜM core sinyaller + araç desteğini KANITLAMIŞ extended PID'ler.
 * `isPidSupported(pid) === true` şartı bilinçlidir — bitmask'te olmayan PID'i listelemek
 * "sorduk ama yok" ile "hiç sormadık"ı karıştırırdı; hub zaten `unsupported` döndürürdü
 * ama ekran 100 satır boş kutuyla dolardı.
 */
export function readSignalAuthoritySnapshot(): SignalAuthoritySnapshot {
  const readAt = Date.now();
  const rows: SignalRow[] = [];
  let supportedPidCount = 0;
  let trimmedPidCount = 0;
  let error: string | null = null;

  try {
    for (const id of coreSignalIds()) {
      const env = _safeRead(id, readAt);
      if (env) rows.push({ id, kind: 'core', name: id, env });
    }

    const supported = STANDARD_PIDS.filter((d) => {
      try { return isPidSupported(d.pid) === true; } catch { return false; }
    });
    supportedPidCount = supported.length;
    trimmedPidCount = Math.max(0, supported.length - PID_ROW_CAP);

    for (const def of supported.slice(0, PID_ROW_CAP)) {
      const env = _safeRead(`pid:${def.pid}`, readAt);
      if (env) rows.push({ id: `pid:${def.pid}`, kind: 'pid', name: def.name, env });
    }
  } catch (e) {
    /* Okuma patlarsa ekran boş kalmaz: o ana kadar toplananlar + AÇIK hata mesajı.
       Sessiz boş liste, "hiç sinyal yok" yalanını söylerdi. */
    error = e instanceof Error ? e.message : String(e);
  }

  return { readAt, rows, supportedPidCount, trimmedPidCount, error };
}
