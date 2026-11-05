
// Prototype key vault: the private RSA key is encrypted with a user passphrase
// before being stored in IndexedDB. The passphrase is never sent to Supabase.
// A production app should add independently tested recovery and key-rotation flows.
type VaultRecord = { userId: string; salt: string; iv: string; encryptedPrivateJwk: string; publicJwk: JsonWebKey };
type UnlockedKeys = { privateKey: CryptoKey; publicJwk: JsonWebKey; created: boolean };

const DB_NAME = 'saferoute-private-key-vault';
const STORE_NAME = 'keys';

function openVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'userId' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local key vault.'));
  });
}

async function readVault(userId: string): Promise<VaultRecord | undefined> {
  const db = await openVault();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(userId);
    request.onsuccess = () => { db.close(); resolve(request.result as VaultRecord | undefined); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

async function writeVault(record: VaultRecord): Promise<void> {
  const db = await openVault();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}
function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function derivePassphraseKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 250_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function unlockOrCreateKeys(userId: string, passphrase: string): Promise<UnlockedKeys> {
  if (passphrase.length < 10) throw new Error('Use a passphrase with at least 10 characters.');
  const existing = await readVault(userId);
  if (existing) {
    const wrappingKey = await derivePassphraseKey(passphrase, fromBase64(existing.salt));
    let privateJwkText: ArrayBuffer;
    try {
      privateJwkText = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64(existing.iv) }, wrappingKey, fromBase64(existing.encryptedPrivateJwk),
      );
    } catch {
      throw new Error('Incorrect passphrase. Your private key was not unlocked.');
    }
    const privateJwk = JSON.parse(new TextDecoder().decode(privateJwkText)) as JsonWebKey;
    const privateKey = await crypto.subtle.importKey(
      'jwk', privateJwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt'],
    );
    return { privateKey, publicJwk: existing.publicJwk, created: false };
  }

  const pair = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt'],
  );
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey) as JsonWebKey;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrappingKey = await derivePassphraseKey(passphrase, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, wrappingKey, new TextEncoder().encode(JSON.stringify(privateJwk)),
  );
  await writeVault({
    userId,
    salt: toBase64(salt),
    iv: toBase64(iv),
    encryptedPrivateJwk: toBase64(new Uint8Array(encrypted)),
    publicJwk,
  });
  const privateKey = await crypto.subtle.importKey(
    'jwk', privateJwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt'],
  );
  return { privateKey, publicJwk, created: true };
}

export type EncryptedPayload = { ciphertext: string; iv: string; wrapped_keys: Record<string, string> };

export async function encryptForParticipants(
  message: string,
  senderId: string,
  recipientId: string,
  senderJwk: JsonWebKey,
  recipientJwk: JsonWebKey,
): Promise<EncryptedPayload> {
  const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, new TextEncoder().encode(message));
  const rawAes = await crypto.subtle.exportKey('raw', aesKey);
  const senderPublic = await crypto.subtle.importKey('jwk', senderJwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const recipientPublic = await crypto.subtle.importKey('jwk', recipientJwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const [wrappedSender, wrappedRecipient] = await Promise.all([
    crypto.subtle.encrypt({ name: 'RSA-OAEP' }, senderPublic, rawAes),
    crypto.subtle.encrypt({ name: 'RSA-OAEP' }, recipientPublic, rawAes),
  ]);
  return {
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    iv: toBase64(iv),
    wrapped_keys: { [senderId]: toBase64(new Uint8Array(wrappedSender)), [recipientId]: toBase64(new Uint8Array(wrappedRecipient)) },
  };
}

export async function decryptForUser(
  payload: EncryptedPayload,
  userId: string,
  privateKey: CryptoKey,
): Promise<string> {
  const wrapped = payload.wrapped_keys[userId];
  if (!wrapped) throw new Error('This message does not contain a key for this account.');
  const rawAes = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, fromBase64(wrapped));
  const aesKey = await crypto.subtle.importKey('raw', rawAes, { name: 'AES-GCM' }, false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(payload.iv) }, aesKey, fromBase64(payload.ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}
