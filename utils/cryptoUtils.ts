import CryptoJS from 'crypto-js';

// The key must match the backend ENCRYPTION_KEY exactly for AES to work.
const SECRET_KEY = import.meta.env.VITE_AES_SECRET || "d3377d4ddc5d3f33c6a9100d28993874";

export function decryptData(encryptedPayload: { iv: string; payload: string }): any {
  const key = CryptoJS.enc.Utf8.parse(SECRET_KEY);
  const iv = CryptoJS.enc.Base64.parse(encryptedPayload.iv);

  const decrypted = CryptoJS.AES.decrypt(
    encryptedPayload.payload,
    key,
    {
      iv: iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    }
  );

  const jsonString = decrypted.toString(CryptoJS.enc.Utf8);
  if (!jsonString) {
      throw new Error("Failed to decrypt AES payload. Incorrect key or invalid data.");
  }
  return JSON.parse(jsonString);
}
