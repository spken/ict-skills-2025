const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');

class DatabaseConnection {
    constructor() {
        this.connection = null;
        this.config = {
            host: 'localhost',
            port: 3306,
            user: 'root',
            password: 'ictskills',
            timezone: '+00:00'
        };
    }

    async connect() {
        try {
            // First connect without database to create it if needed
            const connectionWithoutDB = await mysql.createConnection(this.config);
            
            // Create database if it doesn't exist
            await connectionWithoutDB.execute('CREATE DATABASE IF NOT EXISTS lawnmower_management');
            await connectionWithoutDB.end();

            // Now connect with the database
            this.connection = await mysql.createConnection({
                ...this.config,
                database: 'lawnmower_management'
            });

            console.log('Connected to MySQL database successfully');
            return this.connection;
        } catch (error) {
            console.error('Database connection failed:', error);
            throw error;
        }
    }

    async initializeSchema() {
        if (!this.connection) {
            throw new Error('Database not connected');
        }

        try {
            const schemaPath = path.join(__dirname, 'schema.sql');
            const schema = await fs.readFile(schemaPath, 'utf8');
            
            // Split schema by semicolons and execute each statement
            const statements = schema.split(';').filter(stmt => stmt.trim().length > 0);
            
            for (const statement of statements) {
                await this.connection.execute(statement);
            }
            
            console.log('Database schema initialized successfully');
        } catch (error) {
            console.error('Schema initialization failed:', error);
            throw error;
        }
    }

    getConnection() {
        if (!this.connection) {
            throw new Error('Database not connected');
        }
        return this.connection;
    }

    async close() {
        if (this.connection) {
            await this.connection.end();
            this.connection = null;
            console.log('Database connection closed');
        }
    }
}

module.exports = new DatabaseConnection();