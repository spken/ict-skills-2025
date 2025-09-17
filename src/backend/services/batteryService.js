const dbConnection = require('../database/connection');

class BatteryService {
    constructor() {
        this.db = dbConnection;
    }

    async getCurrentBatteryLevel(lawnmowerId) {
        const connection = this.db.getConnection();
        
        const query = `
            SELECT battery_level, timestamp
            FROM battery_levels 
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
                batteryLevel: rows[0].battery_level
            };
        } catch (error) {
            console.error('Error fetching current battery level:', error);
            throw new Error('Failed to fetch current battery level');
        }
    }

    async getBatteryHistory(lawnmowerId, fromDate, toDate) {
        const connection = this.db.getConnection();
        
        // Validate date parameters
        if (!fromDate || !toDate) {
            throw new Error('From and to date parameters are required');
        }
        
        if (!this.isValidDateTime(fromDate) || !this.isValidDateTime(toDate)) {
            throw new Error('Invalid date format. Expected: YYYY-MM-DD HH:MM:SS or YYYY-MM-DD');
        }
        
        const query = `
            SELECT battery_level, timestamp
            FROM battery_levels 
            WHERE lawnmower_id = ? 
            AND timestamp >= ? 
            AND timestamp <= ?
            ORDER BY timestamp ASC
        `;
        
        try {
            const [rows] = await connection.execute(query, [lawnmowerId, fromDate, toDate]);
            
            return rows.map(row => ({
                timestamp: this.formatTimestamp(row.timestamp),
                batteryLevel: row.battery_level
            }));
        } catch (error) {
            console.error('Error fetching battery history:', error);
            throw new Error('Failed to fetch battery history');
        }
    }

    async addBatteryReading(lawnmowerId, batteryLevel, timestamp = null) {
        const connection = this.db.getConnection();
        
        // Validate battery level
        if (batteryLevel < 0 || batteryLevel > 100) {
            throw new Error('Battery level must be between 0 and 100');
        }
        
        const readingTimestamp = timestamp || new Date();
        
        const query = `
            INSERT INTO battery_levels (lawnmower_id, battery_level, timestamp)
            VALUES (?, ?, ?)
        `;
        
        try {
            await connection.execute(query, [lawnmowerId, batteryLevel, readingTimestamp]);
            return true;
        } catch (error) {
            console.error('Error adding battery reading:', error);
            throw new Error('Failed to add battery reading');
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
}

module.exports = new BatteryService();