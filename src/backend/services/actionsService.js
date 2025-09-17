const dbConnection = require('../database/connection');

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
    }

    async executeAction(lawnmowerId, action) {
        // Verify lawnmower exists
        const exists = await this.verifyLawnmowerExists(lawnmowerId);
        if (!exists) {
            throw new Error('Lawnmower not found');
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
            // In a real implementation, this would send the command to the IoT device
            // For now, we'll simulate the action by updating the state accordingly
            const newState = this.getExpectedStateForAction(action, currentState);
            
            if (newState) {
                await this.updateDeviceState(lawnmowerId, newState);
            }

            // Log successful action
            await this.logAction(lawnmowerId, action, 'completed');
            
            return {
                success: true,
                action: action,
                previousState: currentState,
                newState: newState || currentState,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            // Log failed action
            await this.logAction(lawnmowerId, action, 'failed', error.message);
            throw error;
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

    async verifyLawnmowerExists(lawnmowerId) {
        const connection = this.db.getConnection();
        
        const query = 'SELECT id FROM lawnmowers WHERE id = ?';
        
        try {
            const [rows] = await connection.execute(query, [lawnmowerId]);
            return rows.length > 0;
        } catch (error) {
            console.error('Error verifying lawnmower exists:', error);
            throw new Error('Failed to verify lawnmower');
        }
    }

    getValidActions() {
        return Object.values(this.validActions);
    }
}

module.exports = new ActionsService();