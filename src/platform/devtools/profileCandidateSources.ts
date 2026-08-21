/**
 * profileCandidateSources — Üretici Profil Adayları ekranının TEK OKUMA KATMANI.
 *
 * NEDEN VAR (V-04/6): `manufacturerProfileBuilder` "manuel onaya HAZIR adaylar üretir"
 * diye yazılmıştı ama **onaya bakacak kimse yoktu** — üretilen aday hiçbir yerde
 * görünmüyordu. Builder'ın var oluş sebebi bir İNCELEME yüzeyidir; bu katman onu besler.
 *
 * ⚠️ HİÇBİR ŞEY YAZMAZ: profil dosyası, registry, VKB, Supabase — hiçbiri DEĞİŞMEZ.
 * Aday üretimi salt-okunur bir türetmedir (builder'ın kendi sözleşmesi).
 * Timer/abonelik/polling YOKTUR — açılışta tek okuma + elle YENİLE.
 */
import { getManufacturerIntelligence } from '../manufacturerIntelligenceEngine';
import { buildProfileCandidates, type ProfileCandidate } from '../manufacturerProfileBuilder';

/**
 * Ekrana alınacak aday tavanı. Sessiz kırpma YASAK — kırpılan sayı snapshot'ta taşınır
 * ve ekranda yazılır.
 */
export const CANDIDATE_ROW_CAP = 40;

export interface ProfileCandidateSnapshot {
  readonly readAt: number;
  /** Marka zekâsında kaç marka kaydı bulundu (aday üretiminden ÖNCE). */
  readonly manufacturerCount: number;
  /** Üretilen toplam aday (kırpmadan ÖNCE). */
  readonly totalCandidates: number;
  readonly trimmed: number;
  readonly rows: readonly ProfileCandidate[];
  readonly error: string | null;
}

/**
 * Tek seferlik senkron okuma.
 *
 * `minStatus` builder varsayılanında bırakılır (`strong`): zayıf adayı incelemeye
 * sokmak, insanı gürültüde boğar ve "onaylandı" damgasının değerini düşürür.
 */
export function readProfileCandidateSnapshot(): ProfileCandidateSnapshot {
  const readAt = Date.now();
  try {
    const knowledge = getManufacturerIntelligence();
    const all = buildProfileCandidates(knowledge);
    return {
      readAt,
      manufacturerCount: knowledge.length,
      totalCandidates: all.length,
      trimmed: Math.max(0, all.length - CANDIDATE_ROW_CAP),
      rows: all.slice(0, CANDIDATE_ROW_CAP),
      error: null,
    };
  } catch (e) {
    return {
      readAt,
      manufacturerCount: 0,
      totalCandidates: 0,
      trimmed: 0,
      rows: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
