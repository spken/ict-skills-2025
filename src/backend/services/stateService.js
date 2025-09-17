const dbConnection = require('../database/connection');

class StateService {
    constructor() {
        this.db = dbConnection;
        
        // Valid states as defined in the lawnmower manual and database schema
        this.validStates = [
            'StationCharging',
            'StationChargingCompleted',
            'Mowing',
            'ReturningToStation',
            'Paused',
            'Error'
        ];
    }

    async getCurrentState(lawnmowerId) {
        const connection = this.db.getConnection();
        
        const query = `
            SELECT state, timestamp
            FROM device_states 
            WHERE lawnmower_id = ? 
            ORDER BY timestamp DESC 
            LIMIT 1
        `;
        
        try {
            const [rows] = await connection.execute(query, [lawnmowerId]);
            
            if (rows.length === 0) {
                return null;
            }
            
            return {
                timestamp: this.formatTimestamp(rows[0].timestamp),
                state: rows[0].state
            };
        } catch (error) {
            console.error('Error fetching current state:', error);
            throw new Error('Failed to fetch current state');
        }
    }

    async getStateHistory(lawnmowerId, fromDate, toDate) {
        const connection = this.db.getConnection();
        
        // Validate date parameters
        if (!fromDate || !toDate) {
            throw new Error('From and to date parameters are required');
        }
        
        if (!this.isValidDateTime(fromDate) || !this.isValidDateTime(toDate)) {
            throw new Error('Invalid date format. Expected: YYYY-MM-DD HH:MM:SS or YYYY-MM-DD');
        }
        
        const query = `
            SELECT state, timestamp
            FROM device_states 
            WHERE lawnmower_id = ? 
            AND timestamp >= ? 
            AND timestamp <= ?
            ORDER BY timestamp ASC
        `;
        
        try {
            const [rows] = await connection.execute(query, [lawnmowerId, fromDate, toDate]);
            
            return rows.map(row => ({
                timestamp: this.formatTimestamp(row.timestamp),
                state: row.state
            }));
        } catch (error) {
            console.error('Error fetching state history:', error);
            throw new Error('Failed to fetch state history');
        }
    }

    async addStateChange(lawnmowerId, state, timestamp = null) {
        const connection = this.db.getConnection();
        
        // Validate state
        if (!this.validStates.includes(state)) {
            throw new Error(`Invalid state: ${state}. Valid states are: ${this.validStates.join(', ')}`);
        }
        
        const changeTimestamp = timestamp || new Date();
        
        const query = `
            INSERT INTO device_states (lawnmower_id, state, timestamp)
            VALUES (?, ?, ?)
        `;
        
        try {
            await connection.execute(query, [lawnmowerId, state, changeTimestamp]);
            return true;
        } catch (error) {
            console.error('Error adding state change:', error);
            throw new Error('Failed to add state change');
        }
    }

    async getStateTransitions(lawnmowerId, fromDate, toDate) {
        const connection = this.db.getConnection();
        
        // Get state history with duration calculations
        const query = `
            SELECT 
                state,
                timestamp,
                LEAD(timestamp) OVER (ORDER BY timestamp) as next_timestamp,
                TIMESTAMPDIFF(SECOND, timestamp, LEAD(timestamp) OVER (ORDER BY timestamp)) as duration_seconds
            FROM device_states 
            WHERE lawnmower_id = ? 
            AND timestamp >= ? 
            AND timestamp <= ?
            ORDER BY timestamp ASC
        `;
        
        try {
            const [rows] = await connection.execute(query, [lawnmowerId, fromDate, toDate]);
            
            return rows.map(row => ({
                state: row.state,
                timestamp: this.formatTimestamp(row.timestamp),
                nextTimestamp: row.next_timestamp ? this.formatTimestamp(row.next_timestamp) : null,
                durationSeconds: row.duration_seconds
            }));
        } catch (error) {
            console.error('Error fetching state transitions:', error);
            throw new Error('Failed to fetch state transitions');
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

    isValidDateTime(dateTimeString) {
        // Accept both YYYY-MM-DD and YYYY-MM-DD HH:MM:SS formats
        const dateOnlyRegex = /^\d{4}-\d{2}-\d{2}$/;
        const dateTimeRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
        
        if (!dateOnlyRegex.test(dateTimeString) && !dateTimeRegex.test(dateTimeString)) {
            return false;
        }
        
        const date = new Date(dateTimeString);
        return date instanceof Date && !isNaN(date);
    }

    formatTimestamp(timestamp) {
        // Format timestamp as YYYY-MM-DD HH:MM:SS
        const date = new Date(timestamp);
        return date.toISOString().slice(0, 19).replace('T', ' ');
    }

    getValidStates() {
        return this.validStates;
    }
}

module.exports = new StateService();