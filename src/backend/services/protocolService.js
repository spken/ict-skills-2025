const crypto = require('crypto');

class ProtocolService {
    constructor() {
        this.SOF_MARKER = 0xAA;
        this.TIMEOUT_CONNECTION = 2000; // 2 seconds
        this.TIMEOUT_FRAME = 200; // 200ms
        this.TIMEOUT_RESPONSE = 500; // 500ms
    }

    /**
     * Create a frame with SOF, length, payload, and checksum
     */
    createFrame(payload) {
        if (!Buffer.isBuffer(payload)) {
            payload = Buffer.from(payload);
        }

        const lengthBytes = this.encodeLength(payload.length);
        const frameWithoutChecksum = Buffer.concat([
            Buffer.from([this.SOF_MARKER]),
            lengthBytes,
            payload
        ]);

        const checksum = this.calculateChecksum(frameWithoutChecksum);
        const frame = Buffer.concat([frameWithoutChecksum, checksum]);

        return frame;
    }

    /**
     * Parse incoming frame data
     */
    parseFrame(buffer) {
        if (buffer.length < 4) { // SOF + min length + min checksum
            throw new Error('Frame too short');
        }

        if (buffer[0] !== this.SOF_MARKER) {
            throw new Error('Invalid SOF marker');
        }

        let offset = 1;
        const lengthResult = this.decodeLength(buffer, offset);
        const payloadLength = lengthResult.length;
        offset = lengthResult.offset;

        if (buffer.length < offset + payloadLength + 2) {
            throw new Error('Incomplete frame');
        }

        const payload = buffer.slice(offset, offset + payloadLength);
        const receivedChecksum = buffer.slice(offset + payloadLength, offset + payloadLength + 2);
        
        // Verify checksum
        const frameWithoutChecksum = buffer.slice(0, offset + payloadLength);
        const calculatedChecksum = this.calculateChecksum(frameWithoutChecksum);
        
        if (!receivedChecksum.equals(calculatedChecksum)) {
            throw new Error('Checksum mismatch');
        }

        return {
            payload: payload,
            totalLength: offset + payloadLength + 2
        };
    }

    /**
     * Encode length using variable-length encoding (7 bits per byte)
     */
    encodeLength(length) {
        const bytes = [];
        
        if (length === 0) {
            return Buffer.from([0x00]);
        }

        while (length > 0) {
            let byte = length & 0x7F; // Get lower 7 bits
            length >>= 7; // Shift right by 7 bits
            
            if (length > 0) {
                byte |= 0x80; // Set continuation bit
            }
            
            bytes.push(byte);
        }

        return Buffer.from(bytes);
    }

    /**
     * Decode variable-length encoded length
     */
    decodeLength(buffer, startOffset) {
        let length = 0;
        let offset = startOffset;
        let shift = 0;

        while (offset < buffer.length) {
            const byte = buffer[offset];
            length |= (byte & 0x7F) << shift;
            offset++;
            shift += 7;

            if ((byte & 0x80) === 0) { // No continuation bit
                break;
            }

            if (shift >= 21) { // Max 3 bytes for length
                throw new Error('Length encoding too long');
            }
        }

        return { length, offset };
    }

    /**
     * Calculate checksum using two's complement
     */
    calculateChecksum(buffer) {
        let sum = 0;
        
        for (let i = 0; i < buffer.length; i++) {
            sum += buffer[i];
        }
        
        // Calculate modulo 2^16 and two's complement
        const checksum = ((~sum) + 1) & 0xFFFF;
        
        // Return as big-endian 16-bit value
        return Buffer.from([(checksum >> 8) & 0xFF, checksum & 0xFF]);
    }

    /**
     * Verify checksum
     */
    verifyChecksum(frameBuffer, checksumBuffer) {
        let sum = 0;
        
        // Sum all bytes in frame
        for (let i = 0; i < frameBuffer.length; i++) {
            sum += frameBuffer[i];
        }
        
        // Add checksum bytes
        sum += checksumBuffer[0] << 8;
        sum += checksumBuffer[1];
        
        // Result should be 0 for valid checksum
        return (sum & 0xFFFF) === 0;
    }

    /**
     * Create session layer message (with HMAC)
     */
    createSessionMessage(messageType, payload, hmac = null) {
        if (!hmac) {
            hmac = Buffer.from([0xFA, 0xDE, 0xDB, 0xED]); // Bypass authentication
        }

        const sessionPayload = Buffer.concat([
            hmac,
            Buffer.from([messageType]),
            Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
        ]);

        return sessionPayload;
    }

    /**
     * Parse session layer message
     */
    parseSessionMessage(buffer) {
        if (buffer.length < 5) { // HMAC (4) + MT (1)
            throw new Error('Session message too short');
        }

        return {
            hmac: buffer.slice(0, 4),
            messageType: buffer[4],
            payload: buffer.slice(5)
        };
    }

    /**
     * Create presentation layer message with IIN
     */
    createPresentationMessage(iin, payload) {
        const iinBuffer = Buffer.allocUnsafe(2);
        iinBuffer.writeUInt16BE(iin, 0);
        
        return Buffer.concat([
            iinBuffer,
            Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
        ]);
    }

    /**
     * Parse presentation layer message
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
     * Create application layer command
     */
    createCommand(command, payload = Buffer.alloc(0)) {
        return Buffer.concat([
            Buffer.from([command]),
            Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
        ]);
    }

    /**
     * Parse application layer command/response
     */
    parseCommand(buffer) {
        if (buffer.length < 1) {
            throw new Error('Command too short');
        }

        return {
            command: buffer[0],
            payload: buffer.slice(1)
        };
    }

    /**
     * Message types for session layer
     */
    getMessageTypes() {
        return {
            REGULAR: 0x00,
            HELLO: 0x01,
            CHALLENGE: 0x02,
            CLIENT_AUTH: 0x03,
            NOTIFICATION: 0x80
        };
    }

    /**
     * Application layer commands
     */
    getCommands() {
        return {
            HEARTBEAT: 0x00,
            CONTROL_DEVICE: 0x01,
            ACK_ERROR: 0x02,
            RESET_BLADE_TIME: 0x03
        };
    }

    /**
     * Device control actions
     */
    getControlActions() {
        return {
            STOP: 0x00,
            START: 0x01,
            HOME: 0x02
        };
    }

    /**
     * Notification types
     */
    getNotificationTypes() {
        return {
            DEVICE_STATUS: 0x00,
            POSITION_UPDATE: 0x01
        };
    }
}

module.exports = new ProtocolService();