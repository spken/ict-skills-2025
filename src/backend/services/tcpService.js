const net = require('net');
const EventEmitter = require('events');
const protocolService = require('./protocolService');
const cryptoService = require('./cryptoService');
const dbConnection = require('../database/connection');

class TCPService extends EventEmitter {
    constructor() {
        super();
        this.servers = new Map(); // port -> server instance
        this.connections = new Map(); // connectionId -> connection info
        this.connectionCounter = 0;
    }

    /**
     * Start TCP servers for multiple lawnmowers
     */
    async startServers() {
        try {
            // Get all lawnmowers with port numbers
            const connection = dbConnection.getConnection();
            const [lawnmowers] = await connection.execute(
                'SELECT id, name, serial_number, port_number FROM lawnmowers WHERE port_number IS NOT NULL'
            );

            console.log(`Starting TCP servers for ${lawnmowers.length} lawnmowers...`);

            for (const lawnmower of lawnmowers) {
                await this.startServerForLawnmower(lawnmower);
            }

            console.log('All TCP servers started successfully');
        } catch (error) {
            console.error('Error starting TCP servers:', error);
            throw error;
        }
    }

    /**
     * Start TCP server for a specific lawnmower
     */
    async startServerForLawnmower(lawnmower) {
        const port = lawnmower.port_number;
        
        if (this.servers.has(port)) {
            console.log(`TCP server already running on port ${port}`);
            return;
        }

        const server = net.createServer((socket) => {
            this.handleConnection(socket, lawnmower);
        });

        return new Promise((resolve, reject) => {
            server.listen(port, (error) => {
                if (error) {
                    console.error(`Failed to start TCP server on port ${port}:`, error);
                    reject(error);
                } else {
                    console.log(`TCP server started for ${lawnmower.name} on port ${port}`);
                    this.servers.set(port, server);
                    resolve(server);
                }
            });
        });
    }

    /**
     * Handle new TCP connection
     */
    handleConnection(socket, lawnmower) {
        const connectionId = ++this.connectionCounter;
        const connectionInfo = {
            id: connectionId,
            socket: socket,
            lawnmower: lawnmower,
            authenticated: false,
            sharedSecret: null,
            buffer: Buffer.alloc(0),
            lastActivity: Date.now(),
            authState: {
                serverSecret: null,
                clientPublicKey: null,
                nonce: null
            }
        };

        this.connections.set(connectionId, connectionInfo);

        console.log(`New connection ${connectionId} for ${lawnmower.name} from ${socket.remoteAddress}:${socket.remotePort}`);

        // Set up connection timeout
        const connectionTimeout = setTimeout(() => {
            this.logCommunication(lawnmower.id, 'Warning', 'Connection_Timeout', 'Connection timed out due to inactivity');
            socket.destroy();
        }, protocolService.TIMEOUT_CONNECTION);

        socket.on('data', (data) => {
            connectionInfo.lastActivity = Date.now();
            clearTimeout(connectionTimeout);
            
            // Reset timeout
            const newTimeout = setTimeout(() => {
                this.logCommunication(lawnmower.id, 'Warning', 'Connection_Timeout', 'Connection timed out due to inactivity');
                socket.destroy();
            }, protocolService.TIMEOUT_CONNECTION);

            this.handleData(connectionId, data);
        });

        socket.on('close', () => {
            clearTimeout(connectionTimeout);
            this.logCommunication(lawnmower.id, 'Information', 'Connection_Closed', 'Connection closed normally');
            this.connections.delete(connectionId);
            console.log(`Connection ${connectionId} closed`);
        });

        socket.on('error', (error) => {
            clearTimeout(connectionTimeout);
            this.logCommunication(lawnmower.id, 'Error', 'Connection_Error', `Connection error: ${error.message}`);
            this.connections.delete(connectionId);
            console.error(`Connection ${connectionId} error:`, error);
        });

        // Log connection attempt
        this.logCommunication(lawnmower.id, 'Information', 'Connection_Attempt', 'Client connected');
    }

    /**
     * Handle incoming data
     */
    handleData(connectionId, data) {
        const connectionInfo = this.connections.get(connectionId);
        if (!connectionInfo) return;

        // Add data to buffer
        connectionInfo.buffer = Buffer.concat([connectionInfo.buffer, data]);

        // Process complete frames
        while (connectionInfo.buffer.length > 0) {
            try {
                const frameResult = protocolService.parseFrame(connectionInfo.buffer);
                
                // Remove processed frame from buffer
                connectionInfo.buffer = connectionInfo.buffer.slice(frameResult.totalLength);
                
                // Process the frame
                this.processFrame(connectionId, frameResult.payload);
                
            } catch (error) {
                if (error.message === 'Incomplete frame') {
                    // Wait for more data
                    break;
                } else {
                    // Invalid frame, log and reset buffer
                    this.logCommunication(
                        connectionInfo.lawnmower.id, 
                        'Error', 
                        'Invalid_Frame', 
                        `Broken frame: ${error.message}. Data: ${connectionInfo.buffer.toString('hex')}`
                    );
                    connectionInfo.buffer = Buffer.alloc(0);
                    break;
                }
            }
        }
    }

    /**
     * Process a complete frame
     */
    processFrame(connectionId, payload) {
        const connectionInfo = this.connections.get(connectionId);
        if (!connectionInfo) return;

        try {
            // Parse session layer
            const sessionMsg = protocolService.parseSessionMessage(payload);
            
            // Handle different message types
            switch (sessionMsg.messageType) {
                case protocolService.getMessageTypes().HELLO:
                    this.handleHello(connectionId, sessionMsg);
                    break;
                    
                case protocolService.getMessageTypes().CLIENT_AUTH:
                    this.handleClientAuth(connectionId, sessionMsg);
                    break;
                    
                case protocolService.getMessageTypes().REGULAR:
                    this.handleRegularMessage(connectionId, sessionMsg);
                    break;
                    
                case protocolService.getMessageTypes().NOTIFICATION:
                    this.handleNotification(connectionId, sessionMsg);
                    break;
                    
                default:
                    this.logCommunication(
                        connectionInfo.lawnmower.id,
                        'Warning',
                        'Unknown_Message_Type',
                        `Unknown message type: 0x${sessionMsg.messageType.toString(16)}`
                    );
            }
        } catch (error) {
            this.logCommunication(
                connectionInfo.lawnmower.id,
                'Error',
                'Message_Parse_Error',
                `Failed to parse message: ${error.message}`
            );
        }
    }

    /**
     * Handle Hello message (start authentication)
     */
    handleHello(connectionId, sessionMsg) {
        const connectionInfo = this.connections.get(connectionId);
        if (!connectionInfo) return;

        try {
            const clientPublicKey = cryptoService.parseHelloPayload(sessionMsg.payload);
            
            // Generate server secret and nonce
            const serverSecret = cryptoService.generateRandomSecret();
            const nonce = cryptoService.generateNonce();
            
            // Create challenge
            const challenge = cryptoService.createChallenge(serverSecret, clientPublicKey, nonce);
            
            // Store auth state
            connectionInfo.authState = {
                serverSecret: serverSecret,
                clientPublicKey: clientPublicKey,
                nonce: nonce,
                serverPublicKey: challenge.serverPublicKey
            };

            // Send challenge
            const challengePayload = cryptoService.createChallengePayload(
                challenge.serverPublicKey,
                challenge.nonce,
                challenge.authS
            );
            
            const sessionMessage = protocolService.createSessionMessage(
                protocolService.getMessageTypes().CHALLENGE,
                challengePayload,
                Buffer.from([0x00, 0x00, 0x00, 0x00]) // Fixed HMAC during auth
            );

            const presentationMsg = protocolService.createPresentationMessage(0, sessionMessage);
            const frame = protocolService.createFrame(presentationMsg);
            
            connectionInfo.socket.write(frame);
            
            this.logCommunication(
                connectionInfo.lawnmower.id,
                'Information',
                'Auth_Challenge_Sent',
                `Challenge sent with g=${cryptoService.DH_GENERATOR}, p=${cryptoService.DH_MODULUS}, a=${clientPublicKey}`
            );
            
        } catch (error) {
            this.logCommunication(
                connectionInfo.lawnmower.id,
                'Error',
                'Auth_Hello_Error',
                `Failed to process Hello: ${error.message}`
            );
        }
    }

    /**
     * Handle Client Authentication message
     */
    handleClientAuth(connectionId, sessionMsg) {
        const connectionInfo = this.connections.get(connectionId);
        if (!connectionInfo) return;

        try {
            const authC = cryptoService.parseClientAuthPayload(sessionMsg.payload);
            
            // Verify client authentication
            const isValid = cryptoService.verifyAuth(
                connectionInfo.authState.clientPublicKey,
                connectionInfo.authState.serverPublicKey,
                connectionInfo.authState.nonce,
                authC,
                true // isServer
            );

            if (isValid) {
                // Calculate shared secret
                const sharedSecret = cryptoService.calculateSharedSecret(
                    connectionInfo.authState.clientPublicKey,
                    connectionInfo.authState.serverSecret
                );
                
                connectionInfo.authenticated = true;
                connectionInfo.sharedSecret = sharedSecret;
                
                this.logCommunication(
                    connectionInfo.lawnmower.id,
                    'Information',
                    'Auth_Success',
                    `Authentication successful. Shared secret: 0x${sharedSecret.toString(16).padStart(8, '0')}`
                );
                
                console.log(`Connection ${connectionId} authenticated successfully`);
                
            } else {
                this.logCommunication(
                    connectionInfo.lawnmower.id,
                    'Error',
                    'Auth_Failed',
                    'Client authentication verification failed'
                );
                connectionInfo.socket.destroy();
            }
            
        } catch (error) {
            this.logCommunication(
                connectionInfo.lawnmower.id,
                'Error',
                'Auth_Client_Error',
                `Failed to process client auth: ${error.message}`
            );
            connectionInfo.socket.destroy();
        }
    }

    /**
     * Handle regular authenticated messages
     */
    handleRegularMessage(connectionId, sessionMsg) {
        const connectionInfo = this.connections.get(connectionId);
        if (!connectionInfo) return;

        // Check authentication (allow bypass HMAC for testing)
        if (!connectionInfo.authenticated && !cryptoService.isBypassHMAC(sessionMsg.hmac)) {
            this.logCommunication(
                connectionInfo.lawnmower.id,
                'Warning',
                'Unauthenticated_Message',
                'Received message from unauthenticated connection'
            );
            return;
        }

        try {
            // Parse presentation layer
            const presentationMsg = protocolService.parsePresentationMessage(sessionMsg.payload);
            
            // Parse application layer
            const command = protocolService.parseCommand(presentationMsg.payload);
            
            // Handle command
            this.handleCommand(connectionId, presentationMsg.iin, command);
            
        } catch (error) {
            this.logCommunication(
                connectionInfo.lawnmower.id,
                'Error',
                'Command_Parse_Error',
                `Failed to parse command: ${error.message}`
            );
        }
    }

    /**
     * Handle application layer commands
     */
    handleCommand(connectionId, iin, command) {
        const connectionInfo = this.connections.get(connectionId);
        if (!connectionInfo) return;

        const commands = protocolService.getCommands();
        
        switch (command.command) {
            case commands.HEARTBEAT:
                this.handleHeartbeat(connectionId, iin, command.payload);
                break;
                
            case commands.CONTROL_DEVICE:
                this.handleControlDevice(connectionId, iin, command.payload);
                break;
                
            case commands.ACK_ERROR:
                this.handleAckError(connectionId, iin);
                break;
                
            case commands.RESET_BLADE_TIME:
                this.handleResetBladeTime(connectionId, iin);
                break;
                
            default:
                this.logCommunication(
                    connectionInfo.lawnmower.id,
                    'Warning',
                    'Unknown_Command',
                    `Unknown command: 0x${command.command.toString(16)}`
                );
        }
    }

    /**
     * Handle heartbeat/echo command
     */
    handleHeartbeat(connectionId, iin, payload) {
        const connectionInfo = this.connections.get(connectionId);
        if (!connectionInfo) return;

        // Echo the payload back
        const responseCommand = protocolService.createCommand(0x80, payload); // Response has MSB set
        const presentationMsg = protocolService.createPresentationMessage(iin, responseCommand);
        
        const hmac = connectionInfo.authenticated 
            ? cryptoService.createAuthenticatedHMAC(connectionInfo.sharedSecret, presentationMsg)
            : cryptoService.getBypassHMAC();
            
        const sessionMsg = protocolService.createSessionMessage(
            protocolService.getMessageTypes().REGULAR,
            presentationMsg,
            hmac
        );
        
        const frame = protocolService.createFrame(sessionMsg);
        connectionInfo.socket.write(frame);
        
        this.logCommunication(
            connectionInfo.lawnmower.id,
            'Information',
            'Heartbeat_Response',
            `Heartbeat echoed, payload length: ${payload.length}`
        );
    }

    /**
     * Handle control device command
     */
    handleControlDevice(connectionId, iin, payload) {
        const connectionInfo = this.connections.get(connectionId);
        if (!connectionInfo) return;

        if (payload.length < 1) {
            this.sendErrorResponse(connectionId, iin, 'Invalid control command');
            return;
        }

        const action = payload[0];
        const controlActions = protocolService.getControlActions();
        
        let actionName = 'UNKNOWN';
        let newState = null;
        
        switch (action) {
            case controlActions.STOP:
                actionName = 'STOP';
                newState = 'Paused';
                break;
            case controlActions.START:
                actionName = 'START';
                newState = 'Mowing';
                break;
            case controlActions.HOME:
                actionName = 'HOME';
                newState = 'ReturningToStation';
                break;
        }
        
        // Update device state in database
        if (newState) {
            this.updateDeviceState(connectionInfo.lawnmower.id, newState);
        }
        
        // Send acknowledgment
        const responseCommand = protocolService.createCommand(0x81); // Response for command 0x01
        const presentationMsg = protocolService.createPresentationMessage(iin, responseCommand);
        
        const hmac = connectionInfo.authenticated 
            ? cryptoService.createAuthenticatedHMAC(connectionInfo.sharedSecret, presentationMsg)
            : cryptoService.getBypassHMAC();
            
        const sessionMsg = protocolService.createSessionMessage(
            protocolService.getMessageTypes().REGULAR,
            presentationMsg,
            hmac
        );
        
        const frame = protocolService.createFrame(sessionMsg);
        connectionInfo.socket.write(frame);
        
        this.logCommunication(
            connectionInfo.lawnmower.id,
            'Information',
            'Control_Command',
            `Control action ${actionName} executed, new state: ${newState}`
        );
    }

    /**
     * Handle acknowledge error command
     */
    handleAckError(connectionId, iin) {
        const connectionInfo = this.connections.get(connectionId);
        if (!connectionInfo) return;

        // Update device state to Paused (from Error)
        this.updateDeviceState(connectionInfo.lawnmower.id, 'Paused');
        
        // Send acknowledgment
        const responseCommand = protocolService.createCommand(0x82); // Response for command 0x02
        const presentationMsg = protocolService.createPresentationMessage(iin, responseCommand);
        
        const hmac = connectionInfo.authenticated 
            ? cryptoService.createAuthenticatedHMAC(connectionInfo.sharedSecret, presentationMsg)
            : cryptoService.getBypassHMAC();
            
        const sessionMsg = protocolService.createSessionMessage(
            protocolService.getMessageTypes().REGULAR,
            presentationMsg,
            hmac
        );
        
        const frame = protocolService.createFrame(sessionMsg);
        connectionInfo.socket.write(frame);
        
        this.logCommunication(
            connectionInfo.lawnmower.id,
            'Information',
            'Ack_Error',
            'Error acknowledged, state changed to Paused'
        );
    }

    /**
     * Handle reset blade time command
     */
    handleResetBladeTime(connectionId, iin) {
        const connectionInfo = this.connections.get(connectionId);
        if (!connectionInfo) return;

        // Send acknowledgment
        const responseCommand = protocolService.createCommand(0x83); // Response for command 0x03
        const presentationMsg = protocolService.createPresentationMessage(iin, responseCommand);
        
        const hmac = connectionInfo.authenticated 
            ? cryptoService.createAuthenticatedHMAC(connectionInfo.sharedSecret, presentationMsg)
            : cryptoService.getBypassHMAC();
            
        const sessionMsg = protocolService.createSessionMessage(
            protocolService.getMessageTypes().REGULAR,
            presentationMsg,
            hmac
        );
        
        const frame = protocolService.createFrame(sessionMsg);
        connectionInfo.socket.write(frame);
        
        this.logCommunication(
            connectionInfo.lawnmower.id,
            'Information',
            'Reset_Blade_Time',
            'Blade time reset to 0'
        );
    }

    /**
     * Handle notification messages from device
     */
    handleNotification(connectionId, sessionMsg) {
        const connectionInfo = this.connections.get(connectionId);
        if (!connectionInfo) return;

        try {
            const ntPayload = sessionMsg.payload;
            if (ntPayload.length < 1) return;
            
            const notificationType = ntPayload[0];
            const notificationData = ntPayload.slice(1);
            const notificationTypes = protocolService.getNotificationTypes();
            
            switch (notificationType) {
                case notificationTypes.DEVICE_STATUS:
                    this.handleDeviceStatusNotification(connectionId, notificationData);
                    break;
                    
                case notificationTypes.POSITION_UPDATE:
                    this.handlePositionUpdateNotification(connectionId, notificationData);
                    break;
                    
                default:
                    this.logCommunication(
                        connectionInfo.lawnmower.id,
                        'Warning',
                        'Unknown_Notification',
                        `Unknown notification type: 0x${notificationType.toString(16)}`
                    );
            }
        } catch (error) {
            this.logCommunication(
                connectionInfo.lawnmower.id,
                'Error',
                'Notification_Error',
                `Failed to process notification: ${error.message}`
            );
        }
    }

    /**
     * Handle device status notification
     */
    handleDeviceStatusNotification(connectionId, data) {
        const connectionInfo = this.connections.get(connectionId);
        if (!connectionInfo) return;

        if (data.length < 6) return; // Battery (1) + Blade (4) + Status (1)
        
        const batteryLevel = data[0] / 2; // Convert from 0.5% units to percentage
        const bladeTime = data.readUInt32BE(1); // Blade time in seconds
        const status = data[5];
        
        // Map status code to state name
        const stateMap = {
            0x00: 'StationCharging',
            0x01: 'StationChargingCompleted',
            0x02: 'Mowing',
            0x03: 'ReturningToStation',
            0x04: 'Paused',
            0x80: 'Error'
        };
        
        const stateName = stateMap[status] || 'Unknown';
        const timestamp = new Date();
        
        // Store telemetry data
        this.storeTelemetryData(connectionInfo.lawnmower.id, {
            batteryLevel: batteryLevel,
            state: stateName,
            timestamp: timestamp
        });
        
        this.logCommunication(
            connectionInfo.lawnmower.id,
            'Information',
            'Status_Update',
            `Battery: ${batteryLevel}%, State: ${stateName}, Blade: ${bladeTime}s`
        );
    }

    /**
     * Handle position update notification
     */
    handlePositionUpdateNotification(connectionId, data) {
        const connectionInfo = this.connections.get(connectionId);
        if (!connectionInfo) return;

        if (data.length < 12) return; // TS (4) + Latitude (4) + Longitude (4)
        
        const timestamp = new Date(data.readUInt32BE(0) * 1000); // Unix timestamp
        const latitude = data.readFloatBE(4);
        const longitude = data.readFloatBE(8);
        
        // Store GPS data
        this.storeGPSData(connectionInfo.lawnmower.id, {
            latitude: latitude,
            longitude: longitude,
            timestamp: timestamp
        });
        
        this.logCommunication(
            connectionInfo.lawnmower.id,
            'Information',
            'Position_Update',
            `Position: ${latitude}, ${longitude} at ${timestamp.toISOString()}`
        );
    }

    /**
     * Send error response
     */
    sendErrorResponse(connectionId, iin, errorMessage) {
        const connectionInfo = this.connections.get(connectionId);
        if (!connectionInfo) return;

        const responseCommand = protocolService.createCommand(0xFF, Buffer.from(errorMessage, 'utf-8'));
        const presentationMsg = protocolService.createPresentationMessage(iin, responseCommand);
        
        const hmac = connectionInfo.authenticated 
            ? cryptoService.createAuthenticatedHMAC(connectionInfo.sharedSecret, presentationMsg)
            : cryptoService.getBypassHMAC();
            
        const sessionMsg = protocolService.createSessionMessage(
            protocolService.getMessageTypes().REGULAR,
            presentationMsg,
            hmac
        );
        
        const frame = protocolService.createFrame(sessionMsg);
        connectionInfo.socket.write(frame);
        
        this.logCommunication(
            connectionInfo.lawnmower.id,
            'Error',
            'Error_Response',
            `Error response sent: ${errorMessage}`
        );
    }

    /**
     * Update device state in database
     */
    async updateDeviceState(lawnmowerId, state) {
        try {
            const connection = dbConnection.getConnection();
            await connection.execute(
                'INSERT INTO device_states (lawnmower_id, state, timestamp) VALUES (?, ?, ?)',
                [lawnmowerId, state, new Date()]
            );
        } catch (error) {
            console.error('Error updating device state:', error);
        }
    }

    /**
     * Store telemetry data in database
     */
    async storeTelemetryData(lawnmowerId, data) {
        try {
            const connection = dbConnection.getConnection();
            
            // Store battery level
            if (data.batteryLevel !== undefined) {
                await connection.execute(
                    'INSERT INTO battery_levels (lawnmower_id, battery_level, timestamp) VALUES (?, ?, ?)',
                    [lawnmowerId, data.batteryLevel, data.timestamp]
                );
            }
            
            // Store state
            if (data.state) {
                await connection.execute(
                    'INSERT INTO device_states (lawnmower_id, state, timestamp) VALUES (?, ?, ?)',
                    [lawnmowerId, data.state, data.timestamp]
                );
            }
        } catch (error) {
            console.error('Error storing telemetry data:', error);
        }
    }

    /**
     * Store GPS data in database
     */
    async storeGPSData(lawnmowerId, data) {
        try {
            const connection = dbConnection.getConnection();
            await connection.execute(
                'INSERT INTO gps_positions (lawnmower_id, latitude, longitude, timestamp) VALUES (?, ?, ?, ?)',
                [lawnmowerId, data.latitude, data.longitude, data.timestamp]
            );
        } catch (error) {
            console.error('Error storing GPS data:', error);
        }
    }

    /**
     * Log communication events
     */
    async logCommunication(lawnmowerId, severity, eventType, message) {
        try {
            const connection = dbConnection.getConnection();
            await connection.execute(
                'INSERT INTO communication_logs (lawnmower_id, severity, event_type, message, timestamp) VALUES (?, ?, ?, ?, ?)',
                [lawnmowerId, severity, eventType, message, new Date()]
            );
        } catch (error) {
            console.error('Error logging communication:', error);
        }
    }

    /**
     * Stop all TCP servers
     */
    async stopServers() {
        console.log('Stopping all TCP servers...');
        
        // Close all connections
        for (const [connectionId, connectionInfo] of this.connections) {
            connectionInfo.socket.destroy();
        }
        this.connections.clear();
        
        // Close all servers
        for (const [port, server] of this.servers) {
            server.close();
            console.log(`TCP server on port ${port} stopped`);
        }
        this.servers.clear();
        
        console.log('All TCP servers stopped');
    }

    /**
     * Get connection statistics
     */
    getStats() {
        return {
            activeServers: this.servers.size,
            activeConnections: this.connections.size,
            authenticatedConnections: Array.from(this.connections.values())
                .filter(conn => conn.authenticated).length
        };
    }
}

module.exports = new TCPService();