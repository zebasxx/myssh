const { deriveUserKey, encrypt, decrypt, generateSalt } = require("./crypto/encryption");

console.log("Testing encryption module...\n");

// Test data
const entraId = "test-user-12345678-1234-1234-1234-123456789012";
const salt = generateSalt();
const secretData = "-----BEGIN OPENSSH PRIVATE KEY-----\ntest-key-content-here\n-----END OPENSSH PRIVATE KEY-----";

console.log("1. Generating user key from Entra ID + salt...");
const userKey = deriveUserKey(entraId, salt);
console.log(`   ✓ Generated ${userKey.length * 8}-bit key\n`);

console.log("2. Encrypting private key...");
const encrypted = encrypt(secretData, userKey);
console.log(`   ✓ Ciphertext: ${encrypted.ciphertext.substring(0, 50)}...`);
console.log(`   ✓ IV length: ${encrypted.iv.length} bytes`);
console.log(`   ✓ Auth tag length: ${encrypted.authTag.length} bytes\n`);

console.log("3. Decrypting private key...");
const decrypted = decrypt(encrypted.ciphertext, userKey, encrypted.iv, encrypted.authTag);
console.log(`   ✓ Decrypted: ${decrypted.substring(0, 50)}...\n`);

console.log("4. Verifying data integrity...");
if (decrypted === secretData) {
  console.log("   ✓ SUCCESS: Encryption/decryption round-trip successful!\n");
} else {
  console.log("   ✗ FAIL: Decrypted data does not match original!\n");
  process.exit(1);
}

console.log("5. Testing tampering detection...");
try {
  const tamperedCiphertext = encrypted.ciphertext.replace("A", "B");
  decrypt(tamperedCiphertext, userKey, encrypted.iv, encrypted.authTag);
  console.log("   ✗ FAIL: Tampering was not detected!\n");
  process.exit(1);
} catch (error) {
  console.log("   ✓ SUCCESS: Tampering detected and prevented!\n");
}

console.log("All encryption tests passed! ✓");
