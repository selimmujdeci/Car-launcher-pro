/**
 * observationAdapters.ts — **MAVİ F7 · ALAN GÖZLEM ADAPTÖRLERİ.**
 *
 * ── NE YAPAR ────────────────────────────────────────────────────────────────
 * Her alanın KENDİ gerçeklik kaynağını OKUR ve ortak `DomainEvidence` zarfına
 * çevirir. Okur — yazmaz, tetiklemez, karar vermez.
 *
 *   navigation → `destinationOwnershipModel` hedef sahiplik defteri
 *   media      → `mediaAuthorityEvidence` (→ `playbackTruth` komut kaydı)
 *   settings   → `applySetting` port kanıtı (depodan GERİ OKUMA)
 *   vehicle/diagnostics/phone/surface → bağımsız kaynak YOK → `NONE`
 *
 * ── NEDEN PARALEL DURUM KURULMADI ───────────────────────────────────────────
 * Medya için `playbackTruth` TEK gerçektir; buraya "Mavi medya durumu" diye
 * ikinci bir defter açmak, sahada tam olarak düzelttiğimiz kusuru (iki otorite
 * ayrışması) geri getirirdi. Navigasyonda da `navigationService`in kendi
 * sahiplik defteri kullanılır — yeni bir rota durumu TÜRETİLMEZ.
 *
 * ── GİZLİLİK (sert) ─────────────────────────────────────────────────────────
 * Hedef ADI · adres · kişi adı · parça adı · sensör değeri · transkript bu
 * katmandan GEÇMEZ. Yalnız zaman damgası, bounded enum ve ADET okunur.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 * Her genel API try/catch'lidir ve ASLA throw etmez. Timer KURMAZ, abonelik
 * AÇMAZ (sıfır sızıntı). Zaman değerleri dışarıdan girer.
 */

import { getDestinationChangeLog, isUserSource } from '../../navigation/core/destinationOwnershipModel';
import { getMediaAuthorityEvidence } from '../../media/authority/mediaAuthorityEvidence';
import type { CapabilityOperationDef, FabricDomain } from '../fabric/capabilityContract';
import {
  NO_EVIDENCE, evidenceOf, freshnessOf,
  type DomainEvidence,
} from './observationContract';

/* ══════════════════════════════════════════════════════════════════════════
 * Taban (baseline) — istek ANINDA alınır
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Yürütmeden ÖNCE alınan alan tabanı.
 *
 * **NEDEN GEREKLİ:** "defterde bir kayıt var" bilgisi tek başına hiçbir şey
 * kanıtlamaz — o kayıt önceki turdan kalmış olabilir. Kanıt yalnız TABANIN
 * ÜSTÜNE eklenen ve isteğin damgasından SONRA üretilen kayıtlardan okunur.
 */
export interface ObservationBaseline {
  readonly atMs: number;
  /** Hedef sahiplik defterindeki kayıt adedi (istek anında). */
  readonly navChangeCount: number;
  /** `playbackTruth` üzerinden geçen toplam komut adedi (istek anında). */
  readonly mediaCommandCount: number;
}

/** Okunamayan alan için dürüst taban — kanıt kapısı KAPALI kalır. */
const UNREADABLE_BASELINE_MARK = -1;

export function captureObservationBaseline(nowMs: number): ObservationBaseline {
  let navChangeCount = UNREADABLE_BASELINE_MARK;
  try { navChangeCount = getDestinationChangeLog().history.length; } catch { /* fail-soft */ }

  let mediaCommandCount = UNREADABLE_BASELINE_MARK;
  try { mediaCommandCount = getMediaAuthorityEvidence().counters.commandsTotal; } catch { /* fail-soft */ }

  return Object.freeze({ atMs: nowMs, navChangeCount, mediaCommandCount });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Medya — `playbackTruth` TEK gerçek kaynağıdır
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * `CommandTruth.outcome` → gözlem seviyesi.
 *
 * `VERIFIED` `OBSERVED` sayılır çünkü `finishTruth` kanıt düzeyi
 * `TRANSPORT_ACK` ve altındayken `VERIFIED` ÜRETMEZ (dürüstlük kapısı orada
 * zaten uygulanmıştır) — burada ikinci kez yorumlanmaz.
 */
function levelOfMediaOutcome(o: string): DomainEvidence {
  switch (o) {
    case 'VERIFIED':
      return evidenceOf('PLAYBACK_TRUTH', 'OBSERVED', 'FRESH');
    case 'ACCEPTED_UNVERIFIED':
      return evidenceOf('PLAYBACK_TRUTH', 'ACCEPTED', 'FRESH');
    case 'FAILED':
    case 'REJECTED':
      return evidenceOf('PLAYBACK_TRUTH', 'FAILED', 'FRESH', 'EXECUTION_FAILED');
    case 'TIMED_OUT':
      /* ZAMAN AŞIMI BAŞARI DEĞİLDİR — bounded hata sınıfıyla kapanır. */
      return evidenceOf('PLAYBACK_TRUTH', 'FAILED', 'FRESH', 'TIMEOUT');
    case 'CANCELLED':
    case 'SUPERSEDED':
      return evidenceOf('PLAYBACK_TRUTH', 'CANCELLED', 'FRESH', 'CANCELLED');
    default:
      return NO_EVIDENCE;
  }
}

/**
 * Medya kanıtı — yalnız TABANIN ÜSTÜNE eklenmiş ve isteğin ARDINDAN üretilmiş
 * komut kaydı okunur. Yeni kayıt yoksa kanıt YOK (iddia üretilmez).
 */
export function readMediaEvidence(base: ObservationBaseline): DomainEvidence {
  try {
    if (base.mediaCommandCount === UNREADABLE_BASELINE_MARK) return NO_EVIDENCE;
    const snap = getMediaAuthorityEvidence();
    if (snap.counters.commandsTotal <= base.mediaCommandCount) return NO_EVIDENCE;
    const last = snap.recentCommands[snap.recentCommands.length - 1];
    if (!last) return NO_EVIDENCE;
    const fresh = freshnessOf(typeof last.atMs === 'number' ? last.atMs : null, base.atMs);
    if (fresh !== 'FRESH') return evidenceOf('PLAYBACK_TRUTH', null, fresh);
    return levelOfMediaOutcome(String(last.outcome));
  } catch {
    return NO_EVIDENCE;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Navigasyon — hedef sahiplik defteri
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Navigasyon kanıtı.
 *
 * **NE KANITLAR:** rota hedefinin `navigationService`e GERÇEKTEN işlendiğini
 * (`ALLOW`) ya da bütünlük/sahiplik kapısında REDDEDİLDİĞİNİ (`BLOCK`).
 * **NE KANITLAMAZ:** rehberliğin başladığını — bu yüzden en yüksek seviye
 * `EXECUTED`tir, `OBSERVED` DEĞİL (rota geometrisi ayrı bir gerçektir).
 *
 * **BAĞLAMA:** yalnız taban indeksinin ÜSTÜNDEKİ ve `tsMs >= requestedAtMs`
 * olan kayıtlar okunur → önceki turun hedefi bu tura bağlanamaz. Kaynak
 * kullanıcı iradesi taşımalıdır (`isUserSource`); sistem kaynaklı bir hedef
 * değişimi sesli komutun kanıtı SAYILMAZ.
 *
 * **GİZLİLİK:** `toName`/`fromName` OKUNMAZ (hedef adı = kullanıcı verisi).
 */
export function readNavigationEvidence(
  base: ObservationBaseline, requestedAtMs: number,
): DomainEvidence {
  try {
    if (base.navChangeCount === UNREADABLE_BASELINE_MARK) return NO_EVIDENCE;
    const log = getDestinationChangeLog();
    const history = log.history;
    if (history.length <= base.navChangeCount) return NO_EVIDENCE;

    /* Defter bounded bir halkadır: taşma olduysa indeks kayar. Bu yüzden
     * indeks DEĞİL, zaman damgası birincil bağlama ölçütüdür. */
    const start = Math.max(0, Math.min(base.navChangeCount, history.length));
    let blocked: DomainEvidence | null = null;
    for (let i = start; i < history.length; i += 1) {
      const c = history[i];
      if (!c) continue;
      if (freshnessOf(typeof c.tsMs === 'number' ? c.tsMs : null, requestedAtMs) !== 'FRESH') continue;
      if (!isUserSource(c.source)) continue;
      if (c.decision === 'ALLOW') {
        return evidenceOf('NAV_DESTINATION', 'EXECUTED', 'FRESH');
      }
      blocked = evidenceOf('NAV_DESTINATION', 'FAILED', 'FRESH', 'EXECUTION_FAILED');
    }
    return blocked ?? NO_EVIDENCE;
  } catch {
    return NO_EVIDENCE;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Alan yönlendirmesi
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Bir alanın **yürütme anında** (senkron) okunabilir bağımsız kanıtı var mı.
 *
 * Navigasyon burada YOKTUR: rota isteği asenkrondur ve yürütücü döndüğünde
 * defterde henüz kayıt olmaz. Navigasyon kanıtı BEKLEYEN gözlemle toplanır
 * (`observationLedger`) — sahte bir "hemen doğrulandı" üretmemek için.
 */
const IMMEDIATE_EVIDENCE_DOMAINS: ReadonlySet<FabricDomain> = new Set<FabricDomain>(['media']);

/** Kanıtı ANCAK gecikmeli gelebilen alanlar. */
const DEFERRED_EVIDENCE_DOMAINS: ReadonlySet<FabricDomain> = new Set<FabricDomain>(['navigation']);

export function hasDeferredEvidence(domain: FabricDomain): boolean {
  return DEFERRED_EVIDENCE_DOMAINS.has(domain);
}

/**
 * Yürütmenin hemen ardından okunabilen kanıt.
 *
 * `settingEvidence` çağıran tarafından taşınır (port kanıtı) — bu katman
 * ayar deposunu KENDİSİ okumaz; okusaydı ayarın hangi turda yazıldığını
 * bilemez ve bayat bir değeri bu tura bağlardı.
 */
export function readImmediateEvidence(
  def: CapabilityOperationDef,
  base: ObservationBaseline,
  settingEvidence: DomainEvidence | null,
): DomainEvidence {
  try {
    if (settingEvidence) return settingEvidence;
    if (!IMMEDIATE_EVIDENCE_DOMAINS.has(def.domain)) return NO_EVIDENCE;
    return readMediaEvidence(base);
  } catch {
    return NO_EVIDENCE;
  }
}
