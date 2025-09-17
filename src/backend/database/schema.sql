-- Create lawnmowers table (main device information)
CREATE TABLE IF NOT EXISTS lawnmowers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    address VARCHAR(255) NOT NULL,
    postal_code VARCHAR(20) NOT NULL,
    city VARCHAR(255) NOT NULL,
    canton VARCHAR(100) NOT NULL,
    home_latitude DECIMAL(10, 8) NOT NULL,
    home_longitude DECIMAL(11, 8) NOT NULL,
    serial_number VARCHAR(100) UNIQUE NOT NULL,
    vendor VARCHAR(100) NOT NULL,
    model VARCHAR(100) NOT NULL,
    firmware_version VARCHAR(50) NOT NULL,
    purchase_date DATE NOT NULL,
    latest_maintenance DATE,
    port_number INT,
    timezone VARCHAR(50) DEFAULT 'UTC',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Create battery_levels table (historical battery data)
CREATE TABLE IF NOT EXISTS battery_levels (
    id INT AUTO_INCREMENT PRIMARY KEY,
    lawnmower_id INT NOT NULL,
    battery_level TINYINT UNSIGNED NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lawnmower_id) REFERENCES lawnmowers(id) ON DELETE CASCADE,
    INDEX idx_lawnmower_timestamp (lawnmower_id, timestamp),
    INDEX idx_timestamp (timestamp)
);

-- Create gps_positions table (historical GPS data)
CREATE TABLE IF NOT EXISTS gps_positions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    lawnmower_id INT NOT NULL,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lawnmower_id) REFERENCES lawnmowers(id) ON DELETE CASCADE,
    INDEX idx_lawnmower_timestamp (lawnmower_id, timestamp),
    INDEX idx_timestamp (timestamp)
);

-- Create device_states table (historical state data)
CREATE TABLE IF NOT EXISTS device_states (
    id INT AUTO_INCREMENT PRIMARY KEY,
    lawnmower_id INT NOT NULL,
    state ENUM(
        'StationCharging', 
        'StationChargingCompleted', 
        'Mowing', 
        'ReturningToStation', 
        'Paused', 
        'Error'
    ) NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lawnmower_id) REFERENCES lawnmowers(id) ON DELETE CASCADE,
    INDEX idx_lawnmower_timestamp (lawnmower_id, timestamp),
    INDEX idx_timestamp (timestamp)
);

-- Create communication_logs table (TCP communication logging)
CREATE TABLE IF NOT EXISTS communication_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    lawnmower_id INT,
    severity ENUM('Information', 'Warning', 'Error') NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    message TEXT NOT NULL,
    additional_data JSON,
    timestamp TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lawnmower_id) REFERENCES lawnmowers(id) ON DELETE SET NULL,
    INDEX idx_lawnmower_timestamp (lawnmower_id, timestamp),
    INDEX idx_severity (severity),
    INDEX idx_event_type (event_type)
);

-- Create alerts table (system-generated alerts)
CREATE TABLE IF NOT EXISTS alerts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    lawnmower_id INT NOT NULL,
    alert_type ENUM('ShakyConnection', 'BladesWornOut', 'Stuck') NOT NULL,
    message TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP NULL,
    FOREIGN KEY (lawnmower_id) REFERENCES lawnmowers(id) ON DELETE CASCADE,
    INDEX idx_lawnmower_active (lawnmower_id, is_active),
    INDEX idx_alert_type (alert_type)
);

-- Create current_status view (for quick access to latest values)
CREATE OR REPLACE VIEW current_status AS
SELECT 
    l.id,
    l.name,
    l.address,
    l.postal_code,
    l.city,
    l.canton,
    l.home_latitude,
    l.home_longitude,
    l.serial_number,
    l.vendor,
    l.model,
    l.firmware_version,
    l.purchase_date,
    l.latest_maintenance,
    COALESCE(latest_gps.latitude, l.home_latitude) as current_latitude,
    COALESCE(latest_gps.longitude, l.home_longitude) as current_longitude,
    COALESCE(latest_battery.battery_level, 100) as current_battery_level,
    COALESCE(latest_state.state, 'StationChargingCompleted') as current_state
FROM lawnmowers l
LEFT JOIN (
    SELECT DISTINCT
        lawnmower_id,
        FIRST_VALUE(latitude) OVER (PARTITION BY lawnmower_id ORDER BY timestamp DESC) as latitude,
        FIRST_VALUE(longitude) OVER (PARTITION BY lawnmower_id ORDER BY timestamp DESC) as longitude
    FROM gps_positions
    WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
) latest_gps ON l.id = latest_gps.lawnmower_id
LEFT JOIN (
    SELECT DISTINCT
        lawnmower_id,
        FIRST_VALUE(battery_level) OVER (PARTITION BY lawnmower_id ORDER BY timestamp DESC) as battery_level
    FROM battery_levels
    WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
) latest_battery ON l.id = latest_battery.lawnmower_id
LEFT JOIN (
    SELECT DISTINCT
        lawnmower_id,
        FIRST_VALUE(state) OVER (PARTITION BY lawnmower_id ORDER BY timestamp DESC) as state
    FROM device_states
    WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
) latest_state ON l.id = latest_state.lawnmower_id;