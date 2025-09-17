const dbConnection = require('../database/connection');

class GPSService {
    constructor() {
        this.db = dbConnection;
    }

    async getCurrentPosition(lawnmowerId) {
        const connection = this.db.getConnection();
        
        const query = `
            SELECT latitude, longitude, timestamp
            FROM gps_positions 
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
                latitude: parseFloat(rows[0].latitude),
                longitude: parseFloat(rows[0].longitude)
            };
        } catch (error) {
            console.error('Error fetching current position:', error);
            throw new Error('Failed to fetch current position');
        }
    }

    async getPositionHistory(lawnmowerId, fromDate, toDate) {
        const connection = this.db.getConnection();
        
        // Validate date parameters
        if (!fromDate || !toDate) {
            throw new Error('From and to date parameters are required');
        }
        
        if (!this.isValidDateTime(fromDate) || !this.isValidDateTime(toDate)) {
            throw new Error('Invalid date format. Expected: YYYY-MM-DD HH:MM:SS or YYYY-MM-DD');
        }
        
        const query = `
            SELECT latitude, longitude, timestamp
            FROM gps_positions 
            WHERE lawnmower_id = ? 
            AND timestamp >= ? 
            AND timestamp <= ?
            ORDER BY timestamp ASC
        `;
        
        try {
            const [rows] = await connection.execute(query, [lawnmowerId, fromDate, toDate]);
            
            return rows.map(row => ({
                timestamp: this.formatTimestamp(row.timestamp),
                latitude: parseFloat(row.latitude),
                longitude: parseFloat(row.longitude)
            }));
        } catch (error) {
            console.error('Error fetching position history:', error);
            throw new Error('Failed to fetch position history');
        }
    }

    async addPositionReading(lawnmowerId, latitude, longitude, timestamp = null) {
        const connection = this.db.getConnection();
        
        // Validate coordinates
        if (!this.isValidCoordinate(latitude, 'latitude') || !this.isValidCoordinate(longitude, 'longitude')) {
            throw new Error('Invalid coordinates provided');
        }
        
        const readingTimestamp = timestamp || new Date();
        
        const query = `
            INSERT INTO gps_positions (lawnmower_id, latitude, longitude, timestamp)
            VALUES (?, ?, ?, ?)
        `;
        
        try {
            await connection.execute(query, [lawnmowerId, latitude, longitude, readingTimestamp]);
            return true;
        } catch (error) {
            console.error('Error adding position reading:', error);
            throw new Error('Failed to add position reading');
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

    isValidCoordinate(value, type) {
        const num = parseFloat(value);
        if (isNaN(num)) return false;
        
        if (type === 'latitude') {
            return num >= -90 && num <= 90;
        } else if (type === 'longitude') {
            return num >= -180 && num <= 180;
        }
        
        return false;
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

module.exports = new GPSService();