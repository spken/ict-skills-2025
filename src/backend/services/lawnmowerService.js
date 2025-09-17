const dbConnection = require('../database/connection');

class LawnmowerService {
    constructor() {
        this.db = dbConnection;
    }

    async getAllLawnmowers(filters = {}) {
        const connection = this.db.getConnection();
        
        let query = `
            SELECT 
                id, name, address, postal_code, city, canton,
                home_latitude, home_longitude, serial_number, vendor, model,
                firmware_version, purchase_date, latest_maintenance,
                current_latitude, current_longitude, current_battery_level, current_state
            FROM current_status
            WHERE 1=1
        `;
        
        const params = [];
        
        // Apply filters
        if (filters.id) {
            query += ' AND id = ?';
            params.push(filters.id);
        }
        
        if (filters.name) {
            query += ' AND name LIKE ?';
            params.push(`%${filters.name}%`);
        }
        
        if (filters.vendor) {
            query += ' AND vendor LIKE ?';
            params.push(`%${filters.vendor}%`);
        }
        
        query += ' ORDER BY name ASC';
        
        try {
            const [rows] = await connection.execute(query, params);
            return rows.map(this.formatLawnmowerResponse);
        } catch (error) {
            console.error('Error fetching lawnmowers:', error);
            throw new Error('Failed to fetch lawnmowers');
        }
    }

    async getLawnmowerById(id) {
        const connection = this.db.getConnection();
        
        const query = `
            SELECT 
                id, name, address, postal_code, city, canton,
                home_latitude, home_longitude, serial_number, vendor, model,
                firmware_version, purchase_date, latest_maintenance,
                current_latitude, current_longitude, current_battery_level, current_state
            FROM current_status
            WHERE id = ?
        `;
        
        try {
            const [rows] = await connection.execute(query, [id]);
            if (rows.length === 0) {
                return null;
            }
            return this.formatLawnmowerResponse(rows[0]);
        } catch (error) {
            console.error('Error fetching lawnmower by ID:', error);
            throw new Error('Failed to fetch lawnmower');
        }
    }

    async createLawnmower(lawnmowerData) {
        const connection = this.db.getConnection();
        
        // Validate required fields
        this.validateLawnmowerData(lawnmowerData);
        
        const query = `
            INSERT INTO lawnmowers (
                name, address, postal_code, city, canton,
                home_latitude, home_longitude, serial_number, vendor, model,
                firmware_version, purchase_date, latest_maintenance
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const params = [
            lawnmowerData.name,
            lawnmowerData.address,
            lawnmowerData.postalCode,
            lawnmowerData.city,
            lawnmowerData.canton,
            lawnmowerData.homeLatitude,
            lawnmowerData.homeLongitude,
            lawnmowerData.serialNumber,
            lawnmowerData.vendor,
            lawnmowerData.model,
            lawnmowerData.firmwareVersion,
            lawnmowerData.purchaseDate,
            lawnmowerData.latestMaintenance || null
        ];
        
        try {
            const [result] = await connection.execute(query, params);
            const newId = result.insertId;
            
            // Initialize with default values
            await this.initializeDefaultValues(newId, lawnmowerData);
            
            // Fetch and return the created lawnmower
            return await this.getLawnmowerById(newId);
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                throw new Error('Serial number already exists');
            }
            console.error('Error creating lawnmower:', error);
            throw new Error('Failed to create lawnmower');
        }
    }

    async updateLawnmower(id, lawnmowerData) {
        const connection = this.db.getConnection();
        
        // Check if lawnmower exists
        const existing = await this.getLawnmowerById(id);
        if (!existing) {
            throw new Error('Lawnmower not found');
        }
        
        // Validate data
        this.validateLawnmowerData(lawnmowerData, true);
        
        const query = `
            UPDATE lawnmowers SET
                name = ?, address = ?, postal_code = ?, city = ?, canton = ?,
                home_latitude = ?, home_longitude = ?, serial_number = ?, vendor = ?, model = ?,
                firmware_version = ?, purchase_date = ?, latest_maintenance = ?
            WHERE id = ?
        `;
        
        const params = [
            lawnmowerData.name,
            lawnmowerData.address,
            lawnmowerData.postalCode,
            lawnmowerData.city,
            lawnmowerData.canton,
            lawnmowerData.homeLatitude,
            lawnmowerData.homeLongitude,
            lawnmowerData.serialNumber,
            lawnmowerData.vendor,
            lawnmowerData.model,
            lawnmowerData.firmwareVersion,
            lawnmowerData.purchaseDate,
            lawnmowerData.latestMaintenance || null,
            id
        ];
        
        try {
            await connection.execute(query, params);
            return await this.getLawnmowerById(id);
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                throw new Error('Serial number already exists');
            }
            console.error('Error updating lawnmower:', error);
            throw new Error('Failed to update lawnmower');
        }
    }

    async deleteLawnmower(id) {
        const connection = this.db.getConnection();
        
        // Check if lawnmower exists
        const existing = await this.getLawnmowerById(id);
        if (!existing) {
            throw new Error('Lawnmower not found');
        }
        
        const query = 'DELETE FROM lawnmowers WHERE id = ?';
        
        try {
            await connection.execute(query, [id]);
            return true;
        } catch (error) {
            console.error('Error deleting lawnmower:', error);
            throw new Error('Failed to delete lawnmower');
        }
    }

    async initializeDefaultValues(lawnmowerId, lawnmowerData) {
        const connection = this.db.getConnection();
        const now = new Date();
        
        try {
            // Initialize with default battery level (100%)
            await connection.execute(
                'INSERT INTO battery_levels (lawnmower_id, battery_level, timestamp) VALUES (?, ?, ?)',
                [lawnmowerId, 100, now]
            );
            
            // Initialize with home position
            await connection.execute(
                'INSERT INTO gps_positions (lawnmower_id, latitude, longitude, timestamp) VALUES (?, ?, ?, ?)',
                [lawnmowerId, lawnmowerData.homeLatitude, lawnmowerData.homeLongitude, now]
            );
            
            // Initialize with default state
            await connection.execute(
                'INSERT INTO device_states (lawnmower_id, state, timestamp) VALUES (?, ?, ?)',
                [lawnmowerId, 'StationChargingCompleted', now]
            );
        } catch (error) {
            console.error('Error initializing default values:', error);
            // Don't throw error here as the lawnmower was created successfully
        }
    }

    validateLawnmowerData(data, isUpdate = false) {
        const requiredFields = [
            'name', 'address', 'postalCode', 'city', 'canton',
            'homeLatitude', 'homeLongitude', 'serialNumber', 'vendor',
            'model', 'firmwareVersion', 'purchaseDate'
        ];
        
        for (const field of requiredFields) {
            if (!isUpdate && (data[field] === undefined || data[field] === null || data[field] === '')) {
                throw new Error(`Missing required field: ${field}`);
            }
        }
        
        // Validate coordinates
        if (data.homeLatitude !== undefined) {
            const lat = parseFloat(data.homeLatitude);
            if (isNaN(lat) || lat < -90 || lat > 90) {
                throw new Error('Invalid latitude value');
            }
        }
        
        if (data.homeLongitude !== undefined) {
            const lng = parseFloat(data.homeLongitude);
            if (isNaN(lng) || lng < -180 || lng > 180) {
                throw new Error('Invalid longitude value');
            }
        }
        
        // Validate date format
        if (data.purchaseDate && !this.isValidDate(data.purchaseDate)) {
            throw new Error('Invalid purchase date format (expected YYYY-MM-DD)');
        }
        
        if (data.latestMaintenance && !this.isValidDate(data.latestMaintenance)) {
            throw new Error('Invalid latest maintenance date format (expected YYYY-MM-DD)');
        }
    }

    isValidDate(dateString) {
        const regex = /^\d{4}-\d{2}-\d{2}$/;
        if (!regex.test(dateString)) return false;
        
        const date = new Date(dateString);
        return date instanceof Date && !isNaN(date) && dateString === date.toISOString().split('T')[0];
    }

    formatLawnmowerResponse(row) {
        return {
            id: row.id,
            name: row.name,
            address: row.address,
            postalCode: row.postal_code,
            city: row.city,
            canton: row.canton,
            homeLatitude: parseFloat(row.home_latitude),
            homeLongitude: parseFloat(row.home_longitude),
            serialNumber: row.serial_number,
            vendor: row.vendor,
            model: row.model,
            firmwareVersion: row.firmware_version,
            purchaseDate: row.purchase_date,
            latestMaintenance: row.latest_maintenance,
            currentLatitude: parseFloat(row.current_latitude),
            currentLongitude: parseFloat(row.current_longitude),
            currentBatteryLevel: row.current_battery_level,
            currentState: row.current_state
        };
    }
}

module.exports = new LawnmowerService();