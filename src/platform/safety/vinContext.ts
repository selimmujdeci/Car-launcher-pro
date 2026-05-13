/**
 * OBD el sıkışmasından gelen son VIN — profil henüz güncellenmeden Safety Brain anahtarı için.
 */

let _handshakeVin: string | null = null;

export function setHandshakeVin(vin: string | null): void {
  _handshakeVin = vin?.trim().toUpperCase() ?? null;
}

export function getHandshakeVin(): string | null {
  return _handshakeVin;
}
