import { describe, expect, it } from 'vitest';
import { normalizeTurkishAddressText, resolveNearestDrivablePoint } from '../platform/mapdata/addressModel';

describe('Turkey address model', () => {
  it('normalizes Turkish road abbreviations for search only', () => {
    expect(normalizeTurkishAddressText('Gazipaşa Blv.')).toBe('gazipasa bulvar');
    expect(normalizeTurkishAddressText('İstiklal Cd.')).toBe('istiklal cadde');
    expect(normalizeTurkishAddressText('Bağlar Mahallesi')).toBe('baglar mahalle');
  });

  it('rejects an access-forbidden nearest edge', () => {
    const result = resolveNearestDrivablePoint({
      address: [34.86, 36.91], roadNameAgreement: true, maxDistanceM: 100,
      candidates: [{ ordinal: 4, perpDistM: 3, snappedLat: 36.91, snappedLon: 34.86, alongEdgeM: 2, bearingDeg: 90 }],
      rejectedAccessEdgeOrdinals: [4],
    });
    expect(result).toEqual({ ok: false, failure: 'ACCESS_REJECTED' });
  });

  it('fails closed on a distant name-conflicting edge', () => {
    const result = resolveNearestDrivablePoint({
      address: [34.86, 36.91], roadNameAgreement: false, maxDistanceM: 100,
      candidates: [{ ordinal: 1, perpDistM: 30, snappedLat: 36.91, snappedLon: 34.86, alongEdgeM: 2, bearingDeg: 90 }],
    });
    expect(result).toEqual({ ok: false, failure: 'NAME_CONFLICT' });
  });
});
