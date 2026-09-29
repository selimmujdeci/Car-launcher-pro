export type EvidenceResult = 'gecti' | 'dustu';

export interface DeviceInfo { model?: string; android?: string; webview?: string }

export declare const SECTION: Record<EvidenceResult, string>;
export declare function maxEntryNumber(text: string): number;
export declare function cell(s: unknown): string;
export declare function provenance(p: {
  date: string; source: string; commit?: string; version?: string; device?: DeviceInfo;
}): string;
export declare function buildRow(p: {
  no: number; result: EvidenceResult; area: string; note: string; closes?: number[]; prov: string; date: string;
}): string;
export declare function moveEntry(text: string, no: number, p: { result: EvidenceResult; prov: string; date: string }): string;
export declare function insertAtTop(text: string, result: EvidenceResult, row: string): string;
export declare function applyEvidence(text: string, p: {
  result: string | undefined; area: string | undefined; note: string | undefined;
  closes?: number[]; prov: string; date: string;
}): { text: string; no: number };
