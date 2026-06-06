# ADR 0003 — BLE OBD Transport Mimarisi

## Status

Kabul edildi (commit `04d0ef2` — "feat(obd): add BLE GATT transport support").
**Durum: SAHA TESTİ BEKLİYOR** — kod hazır, gerçek araç + adaptörde doğrulanmadı
(`PROJECT_STATE.md`, `HANDOFF.md` §5).

## Context

ELM327 OBD-II adaptörleri iki farklı Bluetooth transport'u kullanır: **Classic
(RFCOMM/SPP)** ve **BLE (GATT)**. Önceden yalnızca Classic destekleniyordu; BLE-only
adaptörler bağlanamıyordu. Ek olarak iki sorun vardı:

1. **Bonded DUAL cihaz belirsizliği:** Eşli (bonded) cihazlar Android'de 'classic'
   görünebildiğinden transport seçimi kesin değil → yanlış yola tam timeout verilmezse
   doğru BLE yolu açlığa uğruyordu.
2. **Protokol zorlaması:** Eski araçlar (örn. Fiat Doblo 1.4 8v = KWP2000) CAN değil
   KWP/ISO9141 kullanır. Uygulama 2. denemeden sonra CAN'a zorluyordu → ECU init
   sonsuza dek başarısız ("Car Scanner bağlanıyor, biz bağlanmıyoruz" döngüsü).

## Decision

**Transport-agnostik kanal, paylaşılan protokol mantığı:**

- `OBDManager.java` — Classic Bluetooth. 3 katmanlı RFCOMM bağlantı: secure SPP UUID
  → insecure RFCOMM → reflection `createRfcommSocket(channel 1)` son çare
  (`OBDManager.java:127-163`).
- `BleObdManager.java` — BLE GATT. `device.connectGatt(ctx, false, cb,
  TRANSPORT_LE)`, GATT 133 için retry (`BleObdManager.java:151-164`). Notify/write
  characteristic üzerinden ELM327.
- İki transport RFCOMM-benzeri kanala sarmalanır; protokol mantığı paylaşılır.

**Transport seçimi + persist (`obdService.ts:109-126`):** Son kullanılan taşıma
(`'classic' | 'ble'`) MAC adresiyle persist edilir (`_lastKnownTransport`).
`_transportConfirmed` yalnızca önceki BAŞARILI bağlantıdan true olur. Doğrulanmamış
tahmin için fallback'e **tam timeout** verilir (yoksa doğru BLE yolu 3s'e açlık çeker).

**Protokol cycle (`obdService.ts:606-609`):** ELM327 ATSP numaraları reconnect
denemesine göre döndürülür: `PROTOCOL_CYCLE = [undefined, '6', '5', '4', '3', '7']`
(otomatik / CAN 11-500 / KWP hızlı / KWP 5-baud / ISO9141-2 / CAN 29-500).
`forcedProtocol = PROTOCOL_CYCLE[_reconnectAttempts % length]`. CAN'a zorlama kaldırıldı.

## Consequences

- (+) BLE-only ELM327 adaptörler artık bağlanabilir.
- (+) KWP2000/ISO9141 araçlar (Fiat Doblo senaryosu) protokol döngüsüyle bağlanabilir.
- (+) Transport persist → doğru yolla hızlı reconnect; yanlış tahminde graceful timeout.
- (−) Bonded DUAL cihazda transport hâlâ TAHMİN — yanlış tahminde ilk bağlantı daha
  yavaş (tam timeout). Kabul edilen ödünleşim.
- (!) Tüm zincir **cihazda doğrulanmadı**; "düzeltildi" hipotezi (Car Scanner
  bağlanıyor ama biz bağlanmıyoruz → protokol zorlamasıydı) saha testinde teyit edilmeli.
- **BLE OBD için derleme-zamanı feature flag YOK** — transport runtime'da seçilir
  (`_lastKnownTransport`). Bkz. `docs/FEATURE_FLAGS.md`.

## Links & affected files

- Commit: `04d0ef2`
- `android/app/src/main/java/com/cockpitos/pro/obd/BleObdManager.java:151-164`
- `android/app/src/main/java/com/cockpitos/pro/obd/OBDManager.java:32, 56, 127-163`
- `src/platform/obdService.ts:109-126` (transport persist), `:606-609` (PROTOCOL_CYCLE)
- `ARCHITECTURE_DATAFLOW.md` §2 (OBD / BLE mimarisi)
