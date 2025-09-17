const dbConnection = require('../database/connection');
const LawnmowerTCPClient = require('./lawnmowerTCPClient');

class ActionsService {
    constructor() {
        this.db = dbConnection;
        
        // Valid actions as defined in the assignment
        this.validActions = {
            STOP: 'stop',
            START: 'start', 
            HOME: 'home',
            ACK_ERROR: 'ackerror'
        };

        // Map actions to TCP command structure
        this.actionToCommandMap = {
            'stop': { command: 0x01, action: 0x00 },    // CONTROL_DEVICE with STOP
            'start': { command: 0x01, action: 0x01 },   // CONTROL_DEVICE with START
            'home': { command: 0x01, action: 0x02 },    // CONTROL_DEVICE with HOME  
            'ackerror': { command: 0x02, action: null } // ACK_ERROR command
        };
    }

    async executeAction(lawnmowerId, action) {
        // Verify lawnmower exists and get its details
        const lawnmowerInfo = await this.getLawnmowerInfo(lawnmowerId);
        if (!lawnmowerInfo) {
            throw new Error('Lawnmower not found');
        }

        if (!lawnmowerInfo.port_number) {
            // Get list of lawnmowers with port numbers configured for better error message
            const availablePorts = await this.getLawnmowersWithPorts();
            const errorMessage = `Lawnmower ${lawnmowerId} does not have a TCP port configured. ` +
                `Available lawnmowers with TCP control: ${availablePorts.map(l => `ID ${l.id} (${l.name}) on port ${l.port_number}`).join(', ')}`;
            throw new Error(errorMessage);
        }

        // Get current state to validate action
        const currentState = await this.getCurrentState(lawnmowerId);
        
        // Validate action based on current state
        const isValidAction = this.validateActionForState(action, currentState);
        if (!isValidAction) {
            throw new Error(`Action '${action}' is not valid for current state '${currentState}'`);
        }

        // Log the action attempt
        await this.logAction(lawnmowerId, action, 'requested');

        try {
            // Send TCP command to the lawnmower
            const commandMapping = this.actionToCommandMap[action];
            if (!commandMapping) {
                throw new Error(`Unknown action: ${action}`);
            }

            const tcpClient = new LawnmowerTCPClient();
            
            console.log(`Sending TCP command ${commandMapping.command} (action: ${commandMapping.action}) for '${action}' to lawnmower ${lawnmowerId} on port ${lawnmowerInfo.port_number}`);
            
            // Send authenticated command to the lawnmower
            const response = await tcpClient.sendAuthenticatedCommand(
                lawnmowerInfo.port_number,
                commandMapping.command,
                commandMapping.action
            );

            console.log('TCP command completed successfully');

            // Update the expected state based on the action
            const newState = this.getExpectedStateForAction(action, currentState);
            
            if (newState) {
                await this.updateDeviceState(lawnmowerId, newState);
            }

            // Log successful action
            await this.logAction(lawnmowerId, action, 'completed', `TCP response received`);
            
            return {
                success: true,
                action: action,
                previousState: currentState,
                newState: newState || currentState,
                timestamp: new Date().toISOString(),
                tcpResponse: response
            };
        } catch (error) {
            // Log failed action
            await this.logAction(lawnmowerId, action, 'failed', error.message);
            console.error(`TCP command failed for action '${action}' on lawnmower ${lawnmowerId}:`, error);
            throw new Error(`Failed to execute ${action} command: ${error.message}`);
        }
    }

    async stopLawnmower(lawnmowerId) {
        return await this.executeAction(lawnmowerId, this.validActions.STOP);
    }

    async startLawnmower(lawnmowerId) {
        return await this.executeAction(lawnmowerId, this.validActions.START);
    }

    async homeLawnmower(lawnmowerId) {
        return await this.executeAction(lawnmowerId, this.validActions.HOME);
    }

    async acknowledgeError(lawnmowerId) {
        return await this.executeAction(lawnmowerId, this.validActions.ACK_ERROR);
    }

    async getCurrentState(lawnmowerId) {
        const connection = this.db.getConnection();
        
        const query = `
            SELECT state
            FROM device_states 
            WHERE lawnmower_id = ? 
            ORDER BY timestamp DESC 
            LIMIT 1
        `;
        
        try {
            const [rows] = await connection.execute(query, [lawnmowerId]);
            
            if (rows.length === 0) {
                return 'StationChargingCompleted'; // Default state
            }
            
            return rows[0].state;
        } catch (error) {
            console.error('Error fetching current state:', error);
            throw new Error('Failed to fetch current state');
        }
    }

    async updateDeviceState(lawnmowerId, newState) {
        const connection = this.db.getConnection();
        
        const query = `
            INSERT INTO device_states (lawnmower_id, state, timestamp)
            VALUES (?, ?, ?)
        `;
        
        try {
            await connection.execute(query, [lawnmowerId, newState, new Date()]);
        } catch (error) {
            console.error('Error updating device state:', error);
            throw new Error('Failed to update device state');
        }
    }

    validateActionForState(action, currentState) {
        // Define valid transitions based on the state machine from the assignment
        const validTransitions = {
            'StationCharging': ['start'], // Can start from charging
            'StationChargingCompleted': ['start'], // Can start when charging completed
            'Mowing': ['stop', 'home'], // Can stop or return home while mowing
            'ReturningToStation': ['stop'], // Can stop while returning
            'Paused': ['start', 'home'], // Can start or return home when paused
            'Error': ['ackerror'] // Can only acknowledge error when in error state
        };

        const allowedActions = validTransitions[currentState] || [];
        return allowedActions.includes(action);
    }

    getExpectedStateForAction(action, currentState) {
        // Define expected state changes based on actions
        const stateTransitions = {
            'stop': {
                'Mowing': 'Paused',
                'ReturningToStation': 'Paused'
            },
            'start': {
                'StationCharging': 'Mowing',
                'StationChargingCompleted': 'Mowing',
                'Paused': 'Mowing'
            },
            'home': {
                'Mowing': 'ReturningToStation',
                'Paused': 'ReturningToStation'
            },
            'ackerror': {
                'Error': 'Paused'
            }
        };

        return stateTransitions[action]?.[currentState] || null;
    }

    async logAction(lawnmowerId, action, status, errorMessage = null) {
        const connection = this.db.getConnection();
        
        const severity = status === 'failed' ? 'Error' : 'Information';
        const eventType = `Action_${action}`;
        const message = `Action '${action}' ${status}` + (errorMessage ? `: ${errorMessage}` : '');
        
        const query = `
            INSERT INTO communication_logs (lawnmower_id, severity, event_type, message, timestamp)
            VALUES (?, ?, ?, ?, ?)
        `;
        
        try {
            await connection.execute(query, [lawnmowerId, severity, eventType, message, new Date()]);
        } catch (error) {
            console.error('Error logging action:', error);
            // Don't throw error here to avoid disrupting the main action flow
        }
    }

    async getLawnmowerInfo(lawnmowerId) {
        const connection = this.db.getConnection();
        
        const query = `
            SELECT id, name, port_number, serial_number
            FROM lawnmowers 
            WHERE id = ?
        `;
        
        try {
            const [rows] = await connection.execute(query, [lawnmowerId]);
            
            if (rows.length === 0) {
                return null;
            }
            
            return rows[0];
        } catch (error) {
            console.error('Error fetching lawnmower info:', error);
            throw new Error('Failed to fetch lawnmower information');
        }
    }

    async verifyLawnmowerExists(lawnmowerId) {
        const info = await this.getLawnmowerInfo(lawnmowerId);
        return info !== null;
    }

    getValidActions() {
        return Object.values(this.validActions);
    }
}

module.exports = new ActionsService();