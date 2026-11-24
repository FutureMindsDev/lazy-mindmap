export interface EncryptedSecret {
  v: number;
  iv: string;
  authTag: string;
  ciphertext: string;
}

export function getEncryptionKey(): Buffer;
export function encryptSecret(plaintext: string, aad?: string): EncryptedSecret;
export function decryptSecret(payload: EncryptedSecret, aad?: string): string;
export function maskApiKey(key: string): string;
export function hmacHash(value: string, purpose?: string): string;
export function normalizeEmailForAntiAbuse(email: string): string;
export function isDisposableEmail(email: string): boolean;
export function validateExternalBaseUrl(rawUrl: string): string;
export const DEVICE_COOKIE_NAME: string;
export function signDeviceCookie(deviceId: string): string;
export function verifyDeviceCookie(cookieValue: string): string | null;
export function generatePaymentRefCode(uid: string): string;
