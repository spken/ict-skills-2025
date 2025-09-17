const dbConnection = require('../database/connection');

class AnalyticsService {
    constructor() {
        this.db = dbConnection;
    }

    async calculateDistance(lawnmowerId, fromDate = null, toDate = null) {
        const connection = this.db.getConnection();
        
        let query = `
            SELECT latitude, longitude, timestamp
            FROM gps_positions 
            WHERE lawnmower_id = ?
        `;
        const params = [lawnmowerId];
        
        if (fromDate && toDate) {
            query += ' AND timestamp >= ? AND timestamp <= ?';
            params.push(fromDate, toDate);
        }
        
        query += ' ORDER BY timestamp ASC';
        
        try {
            const [rows] = await connection.execute(query, params);
            
            if (rows.length < 2) {
                return { totalDistance: 0 };
            }
            
            let totalDistance = 0;
            
            for (let i = 1; i < rows.length; i++) {
                const prevPoint = rows[i - 1];
                const currentPoint = rows[i];
                
                const distance = this.haversineDistance(
                    parseFloat(prevPoint.latitude),
                    parseFloat(prevPoint.longitude),
                    parseFloat(currentPoint.latitude),
                    parseFloat(currentPoint.longitude)
                );
                
                totalDistance += distance;
            }
            
            return { totalDistance: Math.round(totalDistance * 100) / 100 };
        } catch (error) {
            console.error('Error calculating distance:', error);
            throw new Error('Failed to calculate distance');
        }
    }

    async calculateOperationalHours(lawnmowerId, fromDate = null, toDate = null) {
        const connection = this.db.getConnection();
        
        let query = `
            SELECT state, timestamp,
                   LEAD(timestamp) OVER (ORDER BY timestamp) as next_timestamp
            FROM device_states 
            WHERE lawnmower_id = ?
        `;
        const params = [lawnmowerId];
        
        if (fromDate && toDate) {
            query += ' AND timestamp >= ? AND timestamp <= ?';
            params.push(fromDate, toDate);
        }
        
        query += ' ORDER BY timestamp ASC';
        
        try {
            const [rows] = await connection.execute(query, params);
            
            let totalHours = 0;
            
            for (const row of rows) {
                if (row.state === 'Mowing' && row.next_timestamp) {
                    const startTime = new Date(row.timestamp);
                    const endTime = new Date(row.next_timestamp);
                    const durationHours = (endTime - startTime) / (1000 * 60 * 60);
                    totalHours += durationHours;
                }
            }
            
            return { operationalHours: Math.round(totalHours * 100) / 100 };
        } catch (error) {
            console.error('Error calculating operational hours:', error);
            throw new Error('Failed to calculate operational hours');
        }
    }

    async calculateEfficiency(lawnmowerId, fromDate = null, toDate = null) {
        const connection = this.db.getConnection();
        
        let query = `
            SELECT state, timestamp,
                   LEAD(timestamp) OVER (ORDER BY timestamp) as next_timestamp
            FROM device_states 
            WHERE lawnmower_id = ?
        `;
        const params = [lawnmowerId];
        
        if (fromDate && toDate) {
            query += ' AND timestamp >= ? AND timestamp <= ?';
            params.push(fromDate, toDate);
        }
        
        query += ' ORDER BY timestamp ASC';
        
        try {
            const [rows] = await connection.execute(query, params);
            
            let timeMowing = 0;
            let timePaused = 0;
            let timeError = 0;
            let timeCharging = 0;
            let timeReturningToStation = 0;
            
            for (const row of rows) {
                if (row.next_timestamp) {
                    const startTime = new Date(row.timestamp);
                    const endTime = new Date(row.next_timestamp);
                    const durationHours = (endTime - startTime) / (1000 * 60 * 60);
                    
                    switch (row.state) {
                        case 'Mowing':
                            timeMowing += durationHours;
                            break;
                        case 'Paused':
                            timePaused += durationHours;
                            break;
                        case 'Error':
                            timeError += durationHours;
                            break;
                        case 'StationCharging':
                            timeCharging += durationHours;
                            break;
                        case 'ReturningToStation':
                            timeReturningToStation += durationHours;
                            break;
                    }
                }
            }
            
            const totalOperationalTime = timeMowing + timePaused + timeError + timeReturningToStation;
            const efficiencyPercentage = totalOperationalTime > 0 
                ? (timeMowing / totalOperationalTime) * 100 
                : 0;
            
            return {
                timeMowing: Math.round(timeMowing * 100) / 100,
                timePaused: Math.round(timePaused * 100) / 100,
                timeError: Math.round(timeError * 100) / 100,
                timeCharging: Math.round(timeCharging * 100) / 100,
                timeReturningToStation: Math.round(timeReturningToStation * 100) / 100,
                efficiencyPercentage: Math.round(efficiencyPercentage * 100) / 100
            };
        } catch (error) {
            console.error('Error calculating efficiency:', error);
            throw new Error('Failed to calculate efficiency');
        }
    }

    async calculateEnergyStatistics(lawnmowerId, fromDate = null, toDate = null) {
        const connection = this.db.getConnection();
        
        let query = `
            SELECT battery_level, timestamp
            FROM battery_levels 
            WHERE lawnmower_id = ?
        `;
        const params = [lawnmowerId];
        
        if (fromDate && toDate) {
            query += ' AND timestamp >= ? AND timestamp <= ?';
            params.push(fromDate, toDate);
        }
        
        query += ' ORDER BY timestamp ASC';
        
        try {
            const [batteryRows] = await connection.execute(query, params);
            
            if (batteryRows.length === 0) {
                return {
                    averageRechargeTime: 0,
                    chargeCycles: 0,
                    maxBatteryLevel: 0,
                    minBatteryLevel: 0,
                    avgBatteryLost: 0
                };
            }
            
            let maxBatteryLevel = Math.max(...batteryRows.map(row => row.battery_level));
            let minBatteryLevel = Math.min(...batteryRows.map(row => row.battery_level));
            let chargeCycles = 0;
            let totalRechargeTime = 0;
            let batteryDrops = [];
            
            // Detect charging cycles and battery consumption
            for (let i = 1; i < batteryRows.length; i++) {
                const prev = batteryRows[i - 1];
                const current = batteryRows[i];
                
                // Detect start of charging cycle (significant battery increase)
                if (current.battery_level > prev.battery_level + 10) {
                    chargeCycles++;
                    
                    // Find end of charging cycle
                    for (let j = i + 1; j < batteryRows.length; j++) {
                        if (batteryRows[j].battery_level >= 95) { // Assume 95%+ is fully charged
                            const chargeStartTime = new Date(prev.timestamp);
                            const chargeEndTime = new Date(batteryRows[j].timestamp);
                            totalRechargeTime += (chargeEndTime - chargeStartTime) / (1000 * 60); // minutes
                            break;
                        }
                    }
                }
                
                // Track battery consumption during operation
                if (current.battery_level < prev.battery_level) {
                    const timeDiff = (new Date(current.timestamp) - new Date(prev.timestamp)) / (1000 * 60 * 60); // hours
                    if (timeDiff > 0) {
                        const batteryDrop = prev.battery_level - current.battery_level;
                        batteryDrops.push(batteryDrop / timeDiff); // battery % per hour
                    }
                }
            }
            
            const averageRechargeTime = chargeCycles > 0 ? totalRechargeTime / chargeCycles : 0;
            const avgBatteryLost = batteryDrops.length > 0 
                ? batteryDrops.reduce((sum, rate) => sum + rate, 0) / batteryDrops.length 
                : 0;
            
            return {
                averageRechargeTime: Math.round(averageRechargeTime * 100) / 100,
                chargeCycles: chargeCycles,
                maxBatteryLevel: maxBatteryLevel,
                minBatteryLevel: minBatteryLevel,
                avgBatteryLost: Math.round(avgBatteryLost * 100) / 100
            };
        } catch (error) {
            console.error('Error calculating energy statistics:', error);
            throw new Error('Failed to calculate energy statistics');
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

    // Haversine formula to calculate distance between two GPS points
    haversineDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000; // Earth's radius in meters
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;
        
        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                  Math.cos(φ1) * Math.cos(φ2) *
                  Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        
        return R * c; // Distance in meters
    }

    isValidDateTime(dateTimeString) {
        if (!dateTimeString) return true; // Optional parameter
        
        const dateOnlyRegex = /^\d{4}-\d{2}-\d{2}$/;
        const dateTimeRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
        
        if (!dateOnlyRegex.test(dateTimeString) && !dateTimeRegex.test(dateTimeString)) {
            return false;
        }
        
        const date = new Date(dateTimeString);
        return date instanceof Date && !isNaN(date);
    }
}

module.exports = new AnalyticsService();