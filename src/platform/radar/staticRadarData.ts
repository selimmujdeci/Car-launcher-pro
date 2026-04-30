/**
 * staticRadarData.ts — Türkiye sabit radar & hız kamerası örnek veri seti.
 *
 * Kaynak: OSM tabanı + TEM/D-100/E-5 bilinen konumlar.
 * Koordinatlar gerçek yaklaşık konumlardır — üretim kullanımında
 * ResmiSabit-Radar API veya OpenStreetMap speed_camera verileriyle değiştirin.
 */

import type { RadarPoint } from './radarStore';

export const turkiyeStaticRadars: RadarPoint[] = [

  // ── TEM Otoyolu (E-80) İstanbul → Ankara ─────────────────────────────────
  { id: 'st_tem_01', lat: 41.1156, lng: 28.8623, type: 'speed',    speedLimit: 120 },
  { id: 'st_tem_02', lat: 41.0892, lng: 28.9876, type: 'average',  speedLimit: 120 },
  { id: 'st_tem_03', lat: 40.9234, lng: 29.3456, type: 'speed',    speedLimit: 130 },
  { id: 'st_tem_04', lat: 40.7892, lng: 29.8923, type: 'speed',    speedLimit: 120 },
  { id: 'st_tem_05', lat: 40.7546, lng: 30.2456, type: 'average',  speedLimit: 120 },
  { id: 'st_tem_06', lat: 40.7456, lng: 30.7123, type: 'speed',    speedLimit: 120 },
  { id: 'st_tem_07', lat: 40.7234, lng: 31.1234, type: 'speed',    speedLimit: 120 },
  { id: 'st_tem_08', lat: 40.6898, lng: 31.8456, type: 'average',  speedLimit: 120 },
  { id: 'st_tem_09', lat: 40.4534, lng: 32.3456, type: 'speed',    speedLimit: 120 },
  { id: 'st_tem_10', lat: 39.9789, lng: 32.7234, type: 'speed',    speedLimit: 120 },

  // ── D-100 / E-5 İstanbul bölümü ───────────────────────────────────────────
  { id: 'st_d100_01', lat: 41.0123, lng: 28.7456, type: 'speed',    speedLimit: 90  },
  { id: 'st_d100_02', lat: 40.9876, lng: 28.8234, type: 'redlight', speedLimit: 50  },
  { id: 'st_d100_03', lat: 40.9456, lng: 28.9023, type: 'speed',    speedLimit: 90  },
  { id: 'st_d100_04', lat: 40.9234, lng: 29.0234, type: 'speed',    speedLimit: 80  },
  { id: 'st_d100_05', lat: 40.9012, lng: 29.1456, type: 'speed',    speedLimit: 80  },
  { id: 'st_d100_06', lat: 40.8892, lng: 29.2345, type: 'redlight', speedLimit: 50  },

  // ── İstanbul O-2 / FSM Köprüsü yakını ────────────────────────────────────
  { id: 'st_ist_01', lat: 41.0876, lng: 29.0456, type: 'speed',    speedLimit: 100 },
  { id: 'st_ist_02', lat: 41.0654, lng: 28.9876, type: 'average',  speedLimit: 100 },
  { id: 'st_ist_03', lat: 41.1234, lng: 29.0123, type: 'speed',    speedLimit: 100 },
  { id: 'st_ist_04', lat: 40.9723, lng: 28.8234, type: 'redlight', speedLimit: 50  },
  { id: 'st_ist_05', lat: 41.0234, lng: 29.1234, type: 'speed',    speedLimit: 90  },

  // ── Ankara çevre yolu ve girişleri ────────────────────────────────────────
  { id: 'st_ank_01', lat: 39.9512, lng: 32.8234, type: 'speed',    speedLimit: 80  },
  { id: 'st_ank_02', lat: 39.9234, lng: 32.7456, type: 'redlight', speedLimit: 50  },
  { id: 'st_ank_03', lat: 39.9876, lng: 32.7234, type: 'speed',    speedLimit: 90  },
  { id: 'st_ank_04', lat: 39.9012, lng: 32.8678, type: 'speed',    speedLimit: 80  },
  { id: 'st_ank_05', lat: 40.0234, lng: 32.6456, type: 'average',  speedLimit: 110 },
  { id: 'st_ank_06', lat: 40.1234, lng: 32.5234, type: 'speed',    speedLimit: 120 },
  { id: 'st_ank_07', lat: 39.8765, lng: 32.7865, type: 'redlight', speedLimit: 50  },

  // ── İzmir ─────────────────────────────────────────────────────────────────
  { id: 'st_izm_01', lat: 38.4678, lng: 27.1456, type: 'speed',    speedLimit: 120 },
  { id: 'st_izm_02', lat: 38.4234, lng: 27.2234, type: 'speed',    speedLimit: 90  },
  { id: 'st_izm_03', lat: 38.3987, lng: 27.0987, type: 'redlight', speedLimit: 50  },
  { id: 'st_izm_04', lat: 38.4456, lng: 27.1789, type: 'average',  speedLimit: 100 },
  { id: 'st_izm_05', lat: 38.3678, lng: 26.9876, type: 'speed',    speedLimit: 120 },
  { id: 'st_izm_06', lat: 38.4892, lng: 27.3456, type: 'speed',    speedLimit: 80  },

  // ── Bursa ─────────────────────────────────────────────────────────────────
  { id: 'st_brs_01', lat: 40.1876, lng: 29.0234, type: 'speed',    speedLimit: 90  },
  { id: 'st_brs_02', lat: 40.2123, lng: 29.0456, type: 'redlight', speedLimit: 50  },
  { id: 'st_brs_03', lat: 40.1456, lng: 28.9876, type: 'speed',    speedLimit: 110 },
  { id: 'st_brs_04', lat: 40.2345, lng: 29.1234, type: 'average',  speedLimit: 120 },

  // ── Adana ─────────────────────────────────────────────────────────────────
  { id: 'st_adn_01', lat: 37.0234, lng: 35.3456, type: 'speed',    speedLimit: 80  },
  { id: 'st_adn_02', lat: 37.0456, lng: 35.3234, type: 'redlight', speedLimit: 50  },
  { id: 'st_adn_03', lat: 36.9876, lng: 35.3789, type: 'average',  speedLimit: 100 },

  // ── Antalya ───────────────────────────────────────────────────────────────
  { id: 'st_ant_01', lat: 36.9234, lng: 30.7456, type: 'speed',    speedLimit: 90  },
  { id: 'st_ant_02', lat: 36.8987, lng: 30.6987, type: 'speed',    speedLimit: 80  },
  { id: 'st_ant_03', lat: 36.9678, lng: 30.7234, type: 'redlight', speedLimit: 50  },

  // ── Konya ─────────────────────────────────────────────────────────────────
  { id: 'st_kon_01', lat: 37.8712, lng: 32.4923, type: 'speed',    speedLimit: 90  },
  { id: 'st_kon_02', lat: 37.8234, lng: 32.5123, type: 'average',  speedLimit: 120 },

  // ── Kocaeli / Gebze ───────────────────────────────────────────────────────
  { id: 'st_koc_01', lat: 40.7876, lng: 29.4456, type: 'speed',    speedLimit: 120 },
  { id: 'st_koc_02', lat: 40.8123, lng: 29.5234, type: 'average',  speedLimit: 120 },
  { id: 'st_koc_03', lat: 40.7654, lng: 29.3876, type: 'speed',    speedLimit: 90  },

  // ── Mersin ────────────────────────────────────────────────────────────────
  { id: 'st_mrs_01', lat: 36.8234, lng: 34.6456, type: 'speed',    speedLimit: 90  },
  { id: 'st_mrs_02', lat: 36.8012, lng: 34.6234, type: 'redlight', speedLimit: 50  },

  // ── Eskişehir ─────────────────────────────────────────────────────────────
  { id: 'st_esk_01', lat: 39.7789, lng: 30.5123, type: 'speed',    speedLimit: 90  },
  { id: 'st_esk_02', lat: 39.7456, lng: 30.5456, type: 'average',  speedLimit: 110 },

  // ── Samsun ────────────────────────────────────────────────────────────────
  { id: 'st_sam_01', lat: 41.2987, lng: 36.3234, type: 'speed',    speedLimit: 90  },
  { id: 'st_sam_02', lat: 41.2765, lng: 36.3456, type: 'redlight', speedLimit: 50  },

  // ── Kayseri ───────────────────────────────────────────────────────────────
  { id: 'st_kys_01', lat: 38.7456, lng: 35.5234, type: 'speed',    speedLimit: 90  },
  { id: 'st_kys_02', lat: 38.7123, lng: 35.4876, type: 'average',  speedLimit: 110 },

  // ── Gaziantep ─────────────────────────────────────────────────────────────
  { id: 'st_gzt_01', lat: 37.0567, lng: 37.3876, type: 'speed',    speedLimit: 90  },
  { id: 'st_gzt_02', lat: 37.0234, lng: 37.3456, type: 'redlight', speedLimit: 50  },

  // ── Trabzon ───────────────────────────────────────────────────────────────
  { id: 'st_trb_01', lat: 40.9787, lng: 39.7123, type: 'speed',    speedLimit: 80  },

  // ── Ortalama hız bölümleri (TEM çeşitli) ─────────────────────────────────
  { id: 'st_avg_01', lat: 40.8234, lng: 29.8456, type: 'average',  speedLimit: 120 },
  { id: 'st_avg_02', lat: 40.7234, lng: 30.5456, type: 'average',  speedLimit: 120 },
  { id: 'st_avg_03', lat: 40.5234, lng: 31.5456, type: 'average',  speedLimit: 120 },
];
