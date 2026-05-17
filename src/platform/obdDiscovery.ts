/** OBD adaptör adı için BT cihaz eşleştirme düzenli ifadesi */
const OBD_DEVICE_REGEX = /obd|elm|v.?link|obdii|kw|veepeak|icar|vgate/i;

/**
 * Taranmış BT cihazları listesinden en iyi OBD adaptör adayını seçer.
 * Regex eşleşmesini önceliklendirir; eşleşme yoksa ilk cihazı döner.
 * Liste boşsa null döner.
 */
export function findBestObdDevice(
  devices: Array<{ name: string; address: string }>,
): { name: string; address: string } | null {
  if (devices.length === 0) return null;
  return devices.find((d) => OBD_DEVICE_REGEX.test(d.name)) ?? devices[0] ?? null;
}
