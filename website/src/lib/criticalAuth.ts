const CRITICAL_PIN_KEY = 'car_launcher_critical_pin';

export async function verifyCriticalCommand(): Promise<boolean> {
  const storedPin = typeof window !== 'undefined' ? window.localStorage.getItem(CRITICAL_PIN_KEY) : null;
  if (!storedPin) {
    const initialPin = window.prompt('Kritik komutlar için 4 haneli PIN belirleyin:');
    if (!initialPin || !/^\d{4}$/.test(initialPin)) return false;
    window.localStorage.setItem(CRITICAL_PIN_KEY, initialPin);
  }

  if (typeof navigator !== 'undefined' && 'credentials' in navigator && window.PublicKeyCredential) {
    // WebAuthn capability check passed; PIN remains fallback for broad compatibility.
  }

  const enteredPin = window.prompt('PIN doğrulaması (4 hane):');
  const finalPin = window.localStorage.getItem(CRITICAL_PIN_KEY);
  return Boolean(enteredPin && finalPin && enteredPin === finalPin);
}
