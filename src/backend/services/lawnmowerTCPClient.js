const net = require('net');
const crypto = require('crypto');
const EventEmitter = require('events');

class LawnmowerTCPClient extends EventEmitter {
    constructor() {
        super();
        this.client = null;
        this.connected = false;
        this.authenticated = false;
        this.sharedSecret = null;
        this.iinCounter = 1;
        
        // Protocol constants
        this.SOF_MARKER = 0xAA;
        this.DH_GENERATOR = 5;
        this.DH_MODULUS = 0xFFFFFFFB;
        this.PSK = 0xFEED5EED;
        
        // Auth state
        this.clientSecret = null;
        this.clientPublicKey = null;
        this.serverPublicKey = null;
        this.nonce = null;
        
        // Connection timeout
        this.connectionTimeout = 10000; // 10 seconds
        this.responseTimeout = 5000; // 5 seconds
    }

    /**
     * Connect to lawnmower TCP server
     */
    async connect(port, host = 'localhost') {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Connection timeout'));
            }, this.connectionTimeout);

            this.client = net.createConnection({ port, host }, () => {
                clearTimeout(timeout);
                console.log(`TCP client connected to ${host}:${port}`);
                this.connected = true;
                resolve();
            });

            this.client.on('data', (data) => {
                this.handleData(data);
            });

            this.client.on('close', () => {
                console.log('TCP connection closed');
                this.connected = false;
                this.authenticated = false;
            });

            this.client.on('error', (error) => {
                clearTimeout(timeout);
                console.error('TCP connection error:', error);
                this.connected = false;
                this.authenticated = false;
                reject(error);
            });
        });
    }

    /**
     * Handle incoming data
     */
    handleData(data) {
        try {
            console.log('Received data:', data.length, 'bytes');
            const frame = this.parseFrame(data);
            
            // Parse presentation message first (IIN + session message)
            const presentationMsg = this.parsePresentationMessage(frame.payload);
            console.log('Presentation message IIN:', presentationMsg.iin);
            
            // Parse session message
            const sessionMsg = this.parseSessionMessage(presentationMsg.payload);
            console.log('Session message type:', `0x${sessionMsg.messageType.toString(16)}`);
            
            // Handle different message types
            if (sessionMsg.messageType === 0x02) { // Challenge
                this.handleChallenge(sessionMsg.payload);
            } else if (sessionMsg.messageType === 0x00 || sessionMsg.messageType === 0x01) { // Regular response
                console.log('Emitting response event');
                this.emit('response', sessionMsg);
            } else {
                console.log('Unknown session message type:', `0x${sessionMsg.messageType.toString(16)}`);
            }
            
        } catch (error) {
            console.error('Error parsing received data:', error);
            this.emit('error', error);
        }
    }

    /**
     * Authenticate with the lawnmower
     */
    async authenticate() {
        return new Promise((resolve, reject) => {
            if (this.authenticated) {
                resolve();
                return;
            }

            const timeout = setTimeout(() => {
                reject(new Error('Authentication timeout'));
            }, this.responseTimeout);

            // Set up one-time listener for authentication completion
            const onAuthComplete = () => {
                clearTimeout(timeout);
                resolve();
            };

            this.once('authenticated', onAuthComplete);

            try {
                // Generate client secret and public key
                this.clientSecret = this.generateRandomSecret();
                this.clientPublicKey = this.calculatePublicKey(this.clientSecret);
                
                console.log(`Client public key: 0x${this.clientPublicKey.toString(16)}`);
                
                // Create Hello message
                const helloPayload = Buffer.alloc(4);
                helloPayload.writeUInt32BE(this.clientPublicKey, 0);
                
                const sessionMessage = this.createSessionMessage(0x01, helloPayload);
                const frame = this.createFrame(sessionMessage);
                
                this.client.write(frame);
            } catch (error) {
                clearTimeout(timeout);
                reject(error);
            }
        });
    }

    /**
     * Handle challenge response from server
     */
    handleChallenge(payload) {
        try {
            this.serverPublicKey = payload.readUInt32BE(0);
            this.nonce = payload.readBigUInt64BE(4);
            const authS = payload.readUInt32BE(12);
            
            // Verify server authentication
            const expectedAuthS = this.calculateAuth(this.serverPublicKey, this.clientPublicKey, this.nonce);
            
            if (authS !== expectedAuthS) {
                this.emit('error', new Error('Server authentication failed'));
                return;
            }
            
            console.log('Server authentication verified');
            
            // Calculate client authentication
            const authC = this.calculateAuth(this.clientPublicKey, this.serverPublicKey, this.nonce);
            
            // Send client authentication
            const authCPayload = Buffer.alloc(4);
            authCPayload.writeUInt32BE(authC, 0);
            
            const sessionMessage = this.createSessionMessage(0x03, authCPayload);
            const frame = this.createFrame(sessionMessage);
            
            this.client.write(frame);
            
            // Calculate shared secret
            this.sharedSecret = this.calculateSharedSecret(this.serverPublicKey, this.clientSecret);
            console.log(`Shared secret: 0x${this.sharedSecret.toString(16)}`);
            this.authenticated = true;
            
            console.log('Authentication complete!');
            this.emit('authenticated');
            
        } catch (error) {
            this.emit('error', error);
        }
    }

    /**
     * Send control command and wait for response
     */
    async sendControlCommand(command, actionPayload = null) {
        return new Promise((resolve, reject) => {
            if (!this.connected) {
                reject(new Error('Not connected'));
                return;
            }

            if (!this.authenticated) {
                reject(new Error('Not authenticated'));
                return;
            }

            const timeout = setTimeout(() => {
                this.removeListener('response', onResponse);
                reject(new Error('Command response timeout'));
            }, this.responseTimeout);

            // Set up one-time listener for response
            const onResponse = (response) => {
                clearTimeout(timeout);
                this.removeListener('response', onResponse);
                resolve(response);
            };

            this.once('response', onResponse);

            try {
                // Create command payload
                let commandPayload = Buffer.from([command]);
                if (actionPayload !== null) {
                    commandPayload = Buffer.concat([commandPayload, Buffer.from([actionPayload])]);
                }
                
                const presentationMsg = this.createPresentationMessage(this.iinCounter++, commandPayload);
                
                // Calculate HMAC using shared secret
                const hmac = this.calculateHMAC(this.sharedSecret, presentationMsg);
                
                const sessionMessage = this.createSessionMessage(0x00, presentationMsg, hmac);
                const frame = this.createFrame(sessionMessage);
                
                console.log(`Sending command ${command}${actionPayload !== null ? ` with action ${actionPayload}` : ''}`);
                this.client.write(frame);
            } catch (error) {
                clearTimeout(timeout);
                this.removeListener('response', onResponse);
                reject(error);
            }
        });
    }

    /**
     * Send heartbeat command
     */
    async sendHeartbeat() {
        return new Promise((resolve, reject) => {
            if (!this.connected) {
                reject(new Error('Not connected'));
                return;
            }

            if (!this.authenticated) {
                reject(new Error('Not authenticated'));
                return;
            }

            const timeout = setTimeout(() => {
                reject(new Error('Heartbeat response timeout'));
            }, this.responseTimeout);

            const onResponse = (response) => {
                clearTimeout(timeout);
                resolve(response);
            };

            this.once('response', onResponse);

            try {
                // Create heartbeat command (0x00) with FACE payload
                const commandPayload = Buffer.concat([
                    Buffer.from([0x00]), // HEARTBEAT command
                    Buffer.from('FACE', 'hex') // Payload
                ]);
                
                const presentationMsg = this.createPresentationMessage(this.iinCounter++, commandPayload);
                
                const hmac = this.calculateHMAC(this.sharedSecret, presentationMsg);
                const sessionMessage = this.createSessionMessage(0x00, presentationMsg, hmac);
                const frame = this.createFrame(sessionMessage);
                
                console.log('Sending heartbeat');
                this.client.write(frame);
            } catch (error) {
                clearTimeout(timeout);
                this.removeListener('response', onResponse);
                reject(error);
            }
        });
    }

    /**
     * Connect, authenticate, and send control command
     */
    async sendAuthenticatedCommand(port, command, actionPayload = null, host = 'localhost') {
        try {
            await this.connect(port, host);
            await this.authenticate();
            const response = await this.sendControlCommand(command, actionPayload);
            this.disconnect();
            return response;
        } catch (error) {
            this.disconnect();
            throw error;
        }
    }

    /**
     * Parse presentation message (IIN + payload)
     */
    parsePresentationMessage(buffer) {
        if (buffer.length < 2) {
            throw new Error('Presentation message too short');
        }
        return {
            iin: buffer.readUInt16BE(0),
            payload: buffer.slice(2)
        };
    }

    /**
     * Disconnect from server
     */
    disconnect() {
        if (this.client) {
            console.log('Closing TCP connection...');
            // Give a small delay to ensure any final response is received
            setTimeout(() => {
                if (this.client) {
                    this.client.end();
                    this.client = null;
                }
            }, 50);
            this.connected = false;
            this.authenticated = false;
        }
    }

    // ==================== PROTOCOL METHODS ====================

    createFrame(payload) {
        const lengthBytes = this.encodeLength(payload.length);
        const frameWithoutChecksum = Buffer.concat([
            Buffer.from([this.SOF_MARKER]),
            lengthBytes,
            payload
        ]);
        const checksum = this.calculateChecksum(frameWithoutChecksum);
        return Buffer.concat([frameWithoutChecksum, checksum]);
    }

    parseFrame(buffer) {
        if (buffer[0] !== this.SOF_MARKER) {
            throw new Error('Invalid SOF marker');
        }

        let offset = 1;
        const lengthResult = this.decodeLength(buffer, offset);
        offset = lengthResult.offset;
        
        const payloadLength = lengthResult.length;
        const payload = buffer.slice(offset, offset + payloadLength);
        const receivedChecksum = buffer.slice(offset + payloadLength, offset + payloadLength + 2);
        
        if (buffer.length < offset + payloadLength + 2) {
            throw new Error('Frame too short for declared length and checksum');
        }
        
        const frameWithoutChecksum = buffer.slice(0, offset + payloadLength);
        const calculatedChecksum = this.calculateChecksum(frameWithoutChecksum);
        
        if (!receivedChecksum.equals(calculatedChecksum)) {
            console.warn('Checksum mismatch - frame may be corrupted');
        }
        
        return { payload, checksum: receivedChecksum };
    }

    encodeLength(length) {
        const bytes = [];
        if (length === 0) return Buffer.from([0x00]);
        
        while (length > 0) {
            let byte = length & 0x7F;
            length >>= 7;
            if (length > 0) byte |= 0x80;
            bytes.push(byte);
        }
        return Buffer.from(bytes);
    }

    decodeLength(buffer, startOffset) {
        let length = 0;
        let offset = startOffset;
        let shift = 0;

        while (offset < buffer.length) {
            const byte = buffer[offset];
            length |= (byte & 0x7F) << shift;
            offset++;
            shift += 7;
            if ((byte & 0x80) === 0) break;
        }
        return { length, offset };
    }

    calculateChecksum(buffer) {
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
            sum += buffer[i];
        }
        const checksum = ((~sum) + 1) & 0xFFFF;
        return Buffer.from([(checksum >> 8) & 0xFF, checksum & 0xFF]);
    }

    createSessionMessage(messageType, payload, hmac = null) {
        if (!hmac) {
            hmac = Buffer.from([0x00, 0x00, 0x00, 0x00]);
        }
        return Buffer.concat([hmac, Buffer.from([messageType]), payload]);
    }

    parseSessionMessage(buffer) {
        return {
            hmac: buffer.slice(0, 4),
            messageType: buffer[4],
            payload: buffer.slice(5)
        };
    }

    createPresentationMessage(iin, payload) {
        const iinBuffer = Buffer.allocUnsafe(2);
        iinBuffer.writeUInt16BE(iin, 0);
        return Buffer.concat([iinBuffer, payload]);
    }

    // ==================== CRYPTO METHODS ====================

    generateRandomSecret() {
        return crypto.randomInt(1, 0x10000);
    }

    modularExponentiation(base, exponent, modulus) {
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

    calculatePublicKey(secret) {
        return this.modularExponentiation(this.DH_GENERATOR, secret, this.DH_MODULUS);
    }

    calculateSharedSecret(otherPublicKey, mySecret) {
        return this.modularExponentiation(otherPublicKey, mySecret, this.DH_MODULUS);
    }

    calculateHash(payload) {
        let hash = 0;
        for (const byte of payload) {
            hash = (31 * hash + byte) >>> 0;
        }
        return hash;
    }

    calculateMAC(key, payload) {
        const hash = this.calculateHash(payload);
        return (hash ^ key) >>> 0;
    }

    calculateAuth(keyA, keyB, nonce) {
        const macData = Buffer.alloc(16);
        macData.writeUInt32BE(keyA, 0);
        macData.writeUInt32BE(keyB, 4);
        macData.writeBigUInt64BE(nonce, 8);
        return this.calculateMAC(this.PSK, macData);
    }

    calculateHMAC(key, payload) {
        const hmac = this.calculateMAC(key, payload);
        const buffer = Buffer.alloc(4);
        buffer.writeUInt32BE(hmac, 0);
        return buffer;
    }
}

module.exports = LawnmowerTCPClient;