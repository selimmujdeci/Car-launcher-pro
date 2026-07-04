/**
 * boxProtocol — Aftermarket dekoder-kutusu (Raise/Hiworld) UART protokol çözücü.
 * §HEAD_UNIT_MATRIX §5. Transport'tan bağımsız saf çözücü kütüphanesi.
 */
export {
  BoxFrameParser, raiseChecksum, hiworldChecksum,
  type BoxFrame, type BoxFramingConfig, type BoxByteOrder,
} from './BoxFrameParser';
export {
  BoxCanDecoder, BOX_PROTOCOLS, listBoxProtocols,
  type BoxProtocolId, type BoxProtocolDef,
} from './boxProtocols';
