const crypto = require('crypto');

class CryptoService {
    constructor() {
        // Diffie-Hellman parameters from the assignment
        this.DH_GENERATOR = 5;
        this.DH_MODULUS = 0xFFFFFFFB; // 4,294,967,291
        this.PSK = 0xFEED5EED;
    }

    /**
     * Generate random 16-bit number for Diffie-Hellman
     */
    generateRandomSecret() {
        return crypto.randomInt(1, 0x10000); // 1 to 65535
    }

    /**
     * Generate random 64-bit nonce
     */
    generateNonce() {
        const buffer = crypto.randomBytes(8);
        return buffer.readBigUInt64BE(0);
    }

    /**
     * Perform modular exponentiation: (base^exponent) mod modulus
     */
    modularExponentiation(base, exponent, modulus) {
        if (modulus === 1n) return 0n;
        
        let result = 1n;
        base = BigInt(base) % BigInt(modulus);
        exponent = BigInt(exponent);
        modulus = BigInt(modulus);
        
        while (exponent > 0n) {
            if (exponent % 2n === 1n) {
                result = (result * base) % modulus;
            }
            exponent = exponent >> 1n;
            base = (base * base) % modulus;
        }
        
        return Number(result);
    }

    /**
     * Calculate Diffie-Hellman public key: g^secret mod p
     */
    calculatePublicKey(secret) {
        return this.modularExponentiation(this.DH_GENERATOR, secret, this.DH_MODULUS);
    }

    /**
     * Calculate shared secret: otherPublicKey^mySecret mod p
     */
    calculateSharedSecret(otherPublicKey, mySecret) {
        return this.modularExponentiation(otherPublicKey, mySecret, this.DH_MODULUS);
    }

    /**
     * Hash algorithm for MAC calculation
     */
    calculateHash(payload) {
        let hash = 0;
        
        for (const byte of payload) {
            hash = (31 * hash + byte) >>> 0; // Keep as 32-bit unsigned
        }
        
        return hash;
    }

    /**
     * Calculate MAC (Message Authentication Code)
     */
    calculateMAC(key, payload) {
        const hash = this.calculateHash(payload);
        return (hash ^ key) >>> 0; // XOR with key, keep as 32-bit unsigned
    }

    /**
     * Create authentication challenge (server side)
     */
    createChallenge(serverSecret, clientPublicKey, nonce) {
        const B = this.calculatePublicKey(serverSecret);
        
        // Create data for MAC: B || A || Ns (big-endian)
        const macData = Buffer.alloc(16);
        macData.writeUInt32BE(B, 0);
        macData.writeUInt32BE(clientPublicKey, 4);
        macData.writeBigUInt64BE(nonce, 8);
        
        const authS = this.calculateMAC(this.PSK, macData);
        
        return {
            serverPublicKey: B,
            nonce: nonce,
            authS: authS
        };
    }

    /**
     * Create client authentication response
     */
    createClientAuth(clientSecret, serverPublicKey, nonce) {
        const A = this.calculatePublicKey(clientSecret);
        
        // Create data for MAC: A || B || Ns (big-endian)
        const macData = Buffer.alloc(16);
        macData.writeUInt32BE(A, 0);
        macData.writeUInt32BE(serverPublicKey, 4);
        macData.writeBigUInt64BE(nonce, 8);
        
        const authC = this.calculateMAC(this.PSK, macData);
        
        return {
            clientPublicKey: A,
            authC: authC
        };
    }

    /**
     * Verify authentication response
     */
    verifyAuth(publicKeyA, publicKeyB, nonce, receivedAuth, isServer = true) {
        // Create MAC data based on perspective
        const macData = Buffer.alloc(16);
        
        if (isServer) {
            // Server verifies AuthC: A || B || Ns
            macData.writeUInt32BE(publicKeyA, 0);
            macData.writeUInt32BE(publicKeyB, 4);
        } else {
            // Client verifies AuthS: B || A || Ns
            macData.writeUInt32BE(publicKeyB, 0);
            macData.writeUInt32BE(publicKeyA, 4);
        }
        
        macData.writeBigUInt64BE(nonce, 8);
        
        const expectedAuth = this.calculateMAC(this.PSK, macData);
        return expectedAuth === receivedAuth;
    }

    /**
     * Create Hello message payload
     */
    createHelloPayload(clientPublicKey) {
        const buffer = Buffer.alloc(4);
        buffer.writeUInt32BE(clientPublicKey, 0);
        return buffer;
    }

    /**
     * Parse Hello message
     */
    parseHelloPayload(buffer) {
        if (buffer.length < 4) {
            throw new Error('Invalid Hello message length');
        }
        return buffer.readUInt32BE(0);
    }

    /**
     * Create Challenge message payload
     */
    createChallengePayload(serverPublicKey, nonce, authS) {
        const buffer = Buffer.alloc(16);
        buffer.writeUInt32BE(serverPublicKey, 0);
        buffer.writeBigUInt64BE(nonce, 4);
        buffer.writeUInt32BE(authS, 12);
        return buffer;
    }

    /**
     * Parse Challenge message
     */
    parseChallengePayload(buffer) {
        if (buffer.length < 16) {
            throw new Error('Invalid Challenge message length');
        }
        
        return {
            serverPublicKey: buffer.readUInt32BE(0),
            nonce: buffer.readBigUInt64BE(4),
            authS: buffer.readUInt32BE(12)
        };
    }

    /**
     * Create Client Authentication message payload
     */
    createClientAuthPayload(authC) {
        const buffer = Buffer.alloc(4);
        buffer.writeUInt32BE(authC, 0);
        return buffer;
    }

    /**
     * Parse Client Authentication message
     */
    parseClientAuthPayload(buffer) {
        if (buffer.length < 4) {
            throw new Error('Invalid Client Authentication message length');
        }
        return buffer.readUInt32BE(0);
    }

    /**
     * Calculate HMAC for authenticated messages
     */
    calculateHMAC(key, payload) {
        return this.calculateMAC(key, payload);
    }

    /**
     * Create authenticated message HMAC
     */
    createAuthenticatedHMAC(sharedSecret, payload) {
        const hmac = this.calculateHMAC(sharedSecret, payload);
        const buffer = Buffer.alloc(4);
        buffer.writeUInt32BE(hmac, 0);
        return buffer;
    }

    /**
     * Verify authenticated message HMAC
     */
    verifyAuthenticatedHMAC(sharedSecret, payload, receivedHMAC) {
        const expectedHMAC = this.calculateHMAC(sharedSecret, payload);
        const receivedHMACValue = receivedHMAC.readUInt32BE(0);
        return expectedHMAC === receivedHMACValue;
    }

    /**
     * Generate bypass HMAC (for testing without authentication)
     */
    getBypassHMAC() {
        return Buffer.from([0xFA, 0xDE, 0xDB, 0xED]);
    }

    /**
     * Check if HMAC is bypass value
     */
    isBypassHMAC(hmac) {
        const bypass = this.getBypassHMAC();
        return hmac.equals(bypass);
    }
}

module.exports = new CryptoService();