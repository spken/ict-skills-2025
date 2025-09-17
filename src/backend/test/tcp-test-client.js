#!/usr/bin/env node

const net = require('net');
const crypto = require('crypto');

class LawnmowerTestClient {
    constructor() {
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
    }

    /**
     * Connect to lawnmower TCP server
     */
    connect(port, host = 'localhost') {
        return new Promise((resolve, reject) => {
            this.client = net.createConnection({ port, host }, () => {
                console.log(`Connected to ${host}:${port}`);
                this.connected = true;
                resolve();
            });

            this.client.on('data', (data) => {
                this.handleData(data);
            });

            this.client.on('close', () => {
                console.log('Connection closed');
                this.connected = false;
                this.authenticated = false;
            });

            this.client.on('error', (error) => {
                console.error('Connection error:', error);
                this.connected = false;
                this.authenticated = false;
                // Don't reject here if we're already connected, just log
                if (!this.connected) {
                    reject(error);
                }
            });
        });
    }

    /**
     * Handle incoming data
     */
    handleData(data) {
        try {
            console.log(`Received: ${data.toString('hex')}`);
            console.log(`Frame length: ${data.length} bytes`);
            
            const frame = this.parseFrame(data);
            console.log('Parsed frame payload:', frame.payload.toString('hex'));
            console.log('Frame checksum:', frame.checksum.toString('hex'));
            
            // Parse presentation message first (IIN + session message)
            const presentationMsg = this.parsePresentationMessage(frame.payload);
            console.log(`IIN: ${presentationMsg.iin}`);
            console.log('Presentation payload:', presentationMsg.payload.toString('hex'));
            
            // Parse session message
            const sessionMsg = this.parseSessionMessage(presentationMsg.payload);
            console.log(`Message type: 0x${sessionMsg.messageType.toString(16).padStart(2, '0')}`);
            console.log(`HMAC: ${sessionMsg.hmac.toString('hex')}`);
            console.log(`Session payload: ${sessionMsg.payload.toString('hex')}`);
            
            // Handle different message types
            if (sessionMsg.messageType === 0x02) { // Challenge
                this.handleChallenge(sessionMsg.payload);
            } else if (sessionMsg.messageType === 0x00) { // Regular response
                console.log('Received regular response');
                // Check if this might be a challenge response with wrong message type
                if (sessionMsg.payload.length >= 16) {
                    console.log('Payload is long enough to be a challenge, attempting to parse as challenge...');
                    this.handleChallenge(sessionMsg.payload);
                } else if (this.authenticated && sessionMsg.payload.length <= 4) {
                    console.log('Received short response - likely auth acknowledgment');
                    // This could be an auth acknowledgment
                } else {
                    console.log('Received other regular response');
                }
            } else if (sessionMsg.messageType === 0x04) { // Auth acknowledgment
                console.log('Received authentication acknowledgment');
                this.authenticated = true;
                if (this.onAuthComplete) {
                    this.onAuthComplete();
                }
            }
            
        } catch (error) {
            console.error('Error parsing received data:', error);
            console.error('Raw data:', data.toString('hex'));
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
     * Send raw hex frame (for testing provided examples)
     */
    sendHexFrame(hexString) {
        if (!this.connected) {
            console.error('Not connected');
            return;
        }
        
        // Remove spaces and convert to buffer
        const cleanHex = hexString.replace(/\s/g, '');
        const buffer = Buffer.from(cleanHex, 'hex');
        
        console.log(`Sending hex frame: ${cleanHex}`);
        
        // Validate the frame before sending
        try {
            this.validateFrame(buffer);
            console.log('Frame validation: PASSED');
        } catch (error) {
            console.error('Frame validation: FAILED -', error.message);
            console.error('Sending anyway for testing purposes...');
        }
        
        this.client.write(buffer);
    }

    /**
     * Validate frame structure and checksum
     */
    validateFrame(buffer) {
        if (buffer[0] !== this.SOF_MARKER) {
            throw new Error('Invalid SOF marker');
        }

        let offset = 1;
        const lengthResult = this.decodeLength(buffer, offset);
        offset = lengthResult.offset;
        
        const payloadLength = lengthResult.length;
        
        if (buffer.length < offset + payloadLength + 2) {
            throw new Error(`Frame too short: expected ${offset + payloadLength + 2}, got ${buffer.length}`);
        }
        
        const frameWithoutChecksum = buffer.slice(0, offset + payloadLength);
        const receivedChecksum = buffer.slice(offset + payloadLength, offset + payloadLength + 2);
        const calculatedChecksum = this.calculateChecksum(frameWithoutChecksum);
        
        if (!receivedChecksum.equals(calculatedChecksum)) {
            throw new Error(`Checksum mismatch: expected ${calculatedChecksum.toString('hex')}, got ${receivedChecksum.toString('hex')}`);
        }
        
        console.log(`Frame structure: SOF=${buffer[0].toString(16)} Length=${payloadLength} Payload=${buffer.slice(offset, offset + payloadLength).toString('hex')} Checksum=${receivedChecksum.toString('hex')}`);
    }

    /**
     * Start authentication process
     */
    authenticate() {
        if (!this.connected) {
            console.error('Not connected');
            return;
        }

        // Generate client secret and public key
        this.clientSecret = this.generateRandomSecret();
        this.clientPublicKey = this.calculatePublicKey(this.clientSecret);
        
        console.log(`Client secret: 0x${this.clientSecret.toString(16)}`);
        console.log(`Client public key: 0x${this.clientPublicKey.toString(16)}`);
        
        // Create Hello message - this should be a raw session message, not wrapped in presentation
        const helloPayload = Buffer.alloc(4);
        helloPayload.writeUInt32BE(this.clientPublicKey, 0);
        
        const sessionMessage = this.createSessionMessage(0x01, helloPayload);
        const frame = this.createFrame(sessionMessage);
        
        console.log(`Sending Hello: ${frame.toString('hex')}`);
        this.client.write(frame);
    }

    /**
     * Handle challenge response from server
     */
    handleChallenge(payload) {
        console.log(`Raw challenge payload length: ${payload.length}`);
        console.log(`Raw challenge payload: ${payload.toString('hex')}`);
        
        // Check if payload starts with response code (like 0002)
        let offset = 0;
        if (payload.length >= 2 && payload.readUInt16BE(0) === 0x0002) {
            console.log('Detected response code 0002, skipping it');
            offset = 2;
        }
        
        const challengeData = payload.slice(offset);
        console.log(`Challenge data: ${challengeData.toString('hex')} (${challengeData.length} bytes)`);
        
        if (challengeData.length < 16) {
            console.error('Invalid challenge payload length after parsing');
            return;
        }
        
        this.serverPublicKey = challengeData.readUInt32BE(0);
        this.nonce = challengeData.readBigUInt64BE(4);
        const authS = challengeData.readUInt32BE(12);
        
        console.log(`Server public key: 0x${this.serverPublicKey.toString(16)}`);
        console.log(`Nonce: 0x${this.nonce.toString(16)}`);
        console.log(`AuthS: 0x${authS.toString(16)}`);
        
        // Verify server authentication
        const expectedAuthS = this.calculateAuth(this.serverPublicKey, this.clientPublicKey, this.nonce);
        console.log(`Expected AuthS: 0x${expectedAuthS.toString(16)}`);
        
        if (authS !== expectedAuthS) {
            console.error('Server authentication failed!');
            return;
        }
        
        console.log('Server authentication verified');
        
        // Calculate client authentication
        const authC = this.calculateAuth(this.clientPublicKey, this.serverPublicKey, this.nonce);
        console.log(`AuthC: 0x${authC.toString(16)}`);
        
        // Send client authentication
        const authCPayload = Buffer.alloc(4);
        authCPayload.writeUInt32BE(authC, 0);
        
        const sessionMessage = this.createSessionMessage(0x03, authCPayload);
        const frame = this.createFrame(sessionMessage);
        
        console.log(`Sending Client Auth: ${frame.toString('hex')}`);
        this.client.write(frame);
        
        // Calculate shared secret
        this.sharedSecret = this.calculateSharedSecret(this.serverPublicKey, this.clientSecret);
        console.log(`Shared secret: 0x${this.sharedSecret.toString(16)}`);
        this.authenticated = true;
        
        console.log('Authentication complete!');
        
        // Emit authentication complete event if we have callbacks waiting
        if (this.onAuthComplete) {
            this.onAuthComplete();
        }
    }

    /**
     * Authenticate and then execute a callback
     */
    authenticateAndThen(callback, delay = 100) { // Reduced delay to 100ms
        if (this.authenticated) {
            // Already authenticated, execute immediately
            callback();
            return;
        }
        
        // Set up callback for when authentication completes
        this.onAuthComplete = () => {
            setTimeout(callback, delay);
            this.onAuthComplete = null; // Clear the callback
        };
        
        // Start authentication
        this.authenticate();
    }

    /**
     * Send heartbeat command
     */
    sendHeartbeat(payload = 'FACE', useBypassAuth = false) {
        if (!this.connected) {
            console.error('Not connected');
            return;
        }

        const payloadBuffer = Buffer.from(payload, 'hex');
        const command = this.createCommand(0x00, payloadBuffer);
        const presentationMsg = this.createPresentationMessage(this.iinCounter++, command);
        
        // Calculate HMAC - prefer proper auth if available
        let hmac;
        if (this.authenticated && !useBypassAuth) {
            hmac = this.calculateHMAC(this.sharedSecret, presentationMsg);
            console.log('Using authenticated HMAC');
        } else if (useBypassAuth) {
            hmac = Buffer.from([0xFA, 0xDE, 0xDB, 0xED]); // Bypass
            console.log('Using bypass authentication');
        } else {
            console.error('Not authenticated and bypass not requested - cannot send heartbeat');
            return;
        }
        
        const sessionMessage = this.createSessionMessage(0x00, presentationMsg, hmac);
        const frame = this.createFrame(sessionMessage);
        
        console.log(`Sending heartbeat: ${frame.toString('hex')}`);
        this.client.write(frame);
    }

    /**
     * Send control command
     */
    sendControlCommand(action, useBypassAuth = false) {
        if (!this.connected) {
            console.error('Not connected');
            return;
        }

        const actionBuffer = Buffer.from([action]);
        const command = this.createCommand(0x01, actionBuffer);
        const presentationMsg = this.createPresentationMessage(this.iinCounter++, command);
        
        // Calculate HMAC - prefer proper auth if available
        let hmac;
        if (this.authenticated && !useBypassAuth) {
            hmac = this.calculateHMAC(this.sharedSecret, presentationMsg);
            console.log('Using authenticated HMAC');
        } else if (useBypassAuth) {
            hmac = Buffer.from([0xFA, 0xDE, 0xDB, 0xED]); // Bypass
            console.log('Using bypass authentication');
        } else {
            console.error('Not authenticated and bypass not requested - cannot send control command');
            return;
        }
        
        const sessionMessage = this.createSessionMessage(0x00, presentationMsg, hmac);
        const frame = this.createFrame(sessionMessage);
        
        const actionNames = ['STOP', 'START', 'HOME'];
        console.log(`Sending ${actionNames[action] || 'UNKNOWN'} command: ${frame.toString('hex')}`);
        this.client.write(frame);
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
        
        // Validate frame length
        if (buffer.length < offset + payloadLength + 2) {
            throw new Error('Frame too short for declared length and checksum');
        }
        
        // Validate checksum
        const frameWithoutChecksum = buffer.slice(0, offset + payloadLength);
        const calculatedChecksum = this.calculateChecksum(frameWithoutChecksum);
        
        if (!receivedChecksum.equals(calculatedChecksum)) {
            console.warn('Checksum mismatch - frame may be corrupted');
            console.warn(`Expected: ${calculatedChecksum.toString('hex')}, Got: ${receivedChecksum.toString('hex')}`);
            // Don't throw error, just warn for debugging
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

    createCommand(command, payload = Buffer.alloc(0)) {
        return Buffer.concat([Buffer.from([command]), payload]);
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

    disconnect() {
        if (this.client) {
            console.log('Closing connection gracefully...');
            this.client.end(); // Graceful close
            setTimeout(() => {
                if (this.client && !this.client.destroyed) {
                    console.log('Force closing connection...');
                    this.client.destroy();
                }
            }, 1000);
        }
    }
}

// ==================== CLI Interface ====================

function printUsage() {
    console.log(`
Usage: node tcp-test-client.js [command] [options]

Commands:
  test-frames <port>     - Test with provided assignment frames (bypass auth)
  test-hello <port>      - Test only Hello frame exchange
  authenticate <port>    - Perform full authentication and send commands
  auth-heartbeat <port>  - Authenticate then send heartbeat
  auth-control <port> <action> - Authenticate then send control command
  heartbeat-bypass <port> - Send heartbeat with bypass auth
  control-bypass <port> <action> - Send control with bypass auth

Examples:
  node tcp-test-client.js authenticate 5000
  node tcp-test-client.js auth-heartbeat 5000
  node tcp-test-client.js auth-control 5000 1
  node tcp-test-client.js test-hello 5000
  node tcp-test-client.js heartbeat-bypass 5000
`);
}

async function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 2) {
        printUsage();
        process.exit(1);
    }

    const command = args[0];
    const port = parseInt(args[1]);

    if (isNaN(port)) {
        console.error('Invalid port number');
        process.exit(1);
    }

    const client = new LawnmowerTestClient();

    try {
        await client.connect(port);

        switch (command) {
            case 'test-hello':
                console.log('Testing Hello frame only...');
                console.log('\n=== Sending Hello Frame ===');
                client.sendHexFrame('AA0900000000014E254254FE43');
                break;

            case 'test-frames':
                console.log('Testing with assignment example frames...');
                
                // Hello frame from assignment
                console.log('\n=== Sending Hello Frame ===');
                client.sendHexFrame('AA0900000000014E254254FE43');
                
                // Wait for server response before sending next frame
                setTimeout(() => {
                    if (client.connected) {
                        console.log('\n=== Sending Echo Request (Bypass Auth) ===');
                        // Echo request with bypass auth
                        client.sendHexFrame('AA0A9FA50DF400123400FACEFAF9');
                    }
                }, 1500); // Increased delay to ensure server processes first frame
                
                setTimeout(() => {
                    if (client.connected) {
                        console.log('\n=== Sending Control Command (Bypass Auth) ===');
                        // Start command with bypass auth
                        client.sendHexFrame('AA09FADEDBED0012340101FB65');
                    }
                }, 3000); // Further increased delay
                
                break;

            case 'authenticate':
                console.log('Starting authentication process...');
                client.authenticate();
                
                // Send heartbeat after authentication
                setTimeout(() => {
                    if (client.authenticated) {
                        console.log('\n=== Sending authenticated heartbeat ===');
                        client.sendHeartbeat();
                    }
                }, 3000);
                
                // Send control command after heartbeat
                setTimeout(() => {
                    if (client.authenticated) {
                        console.log('\n=== Sending authenticated START command ===');
                        client.sendControlCommand(1); // START
                    }
                }, 5000);
                break;

            case 'auth-heartbeat':
                console.log('Authenticating and sending heartbeat...');
                client.authenticateAndThen(() => {
                    console.log('\n=== Sending authenticated heartbeat ===');
                    client.sendHeartbeat();
                });
                break;

            case 'auth-control':
                if (args.length < 3) {
                    console.error('Control command requires action (0=STOP, 1=START, 2=HOME)');
                    process.exit(1);
                }
                const authAction = parseInt(args[2]);
                console.log('Authenticating and sending control command...');
                client.authenticateAndThen(() => {
                    console.log(`\n=== Sending authenticated control command ===`);
                    client.sendControlCommand(authAction);
                });
                break;

            case 'heartbeat-bypass':
                console.log('Sending heartbeat with bypass auth...');
                client.sendHeartbeat('FACE', true); // useBypassAuth = true
                break;

            case 'control-bypass':
                if (args.length < 3) {
                    console.error('Control command requires action (0=STOP, 1=START, 2=HOME)');
                    process.exit(1);
                }
                const bypassAction = parseInt(args[2]);
                console.log(`Sending control command with bypass auth...`);
                client.sendControlCommand(bypassAction, true); // useBypassAuth = true
                break;

            default:
                console.error(`Unknown command: ${command}`);
                printUsage();
                process.exit(1);
        }

        // Keep connection alive for 10 seconds to see responses
        setTimeout(() => {
            console.log('Disconnecting...');
            client.disconnect();
            process.exit(0);
        }, 10000);

    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = LawnmowerTestClient;