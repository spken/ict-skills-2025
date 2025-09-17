const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const dbConnection = require('./database/connection');

class LawnmowerServer {
    constructor() {
        this.app = express();
        this.port = process.env.PORT || 3001;
        this.setupMiddleware();
        this.setupRoutes();
    }

    setupMiddleware() {
        // Enable CORS for Electron renderer process
        this.app.use(cors({
            origin: ['http://localhost:*', 'file://*'],
            methods: ['GET', 'POST', 'PUT', 'DELETE'],
            allowedHeaders: ['Content-Type', 'Authorization']
        }));

        // Parse JSON bodies
        this.app.use(bodyParser.json({ limit: '10mb' }));
        this.app.use(bodyParser.urlencoded({ extended: true }));

        // Static file serving for any assets
        this.app.use('/static', express.static(path.join(__dirname, '../renderer')));

        // Request logging middleware
        this.app.use((req, res, next) => {
            console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
            next();
        });
    }

    setupRoutes() {
        // Import route modules
        const lawnmowerRoutes = require('./routes/lawnmowers');
        const batteryRoutes = require('./routes/battery');
        const gpsRoutes = require('./routes/gps');
        const stateRoutes = require('./routes/state');

        // Health check endpoint
        this.app.get('/api/health', (req, res) => {
            res.json({ 
                status: 'OK', 
                timestamp: new Date().toISOString(),
                database: 'Connected'
            });
        });

        // Basic API info
        this.app.get('/api', (req, res) => {
            res.json({
                name: 'Lawnmower Management API',
                version: '1.0.0',
                description: 'REST API for managing lawnmower fleet',
                endpoints: {
                    lawnmowers: '/api/lawnmowers',
                    battery: '/api/lawnmower/:id/battery',
                    gps: '/api/lawnmower/:id/gps',
                    state: '/api/lawnmower/:id/state',
                    analytics: '/api/lawnmower/:id/analytics',
                    actions: '/api/lawnmower/:id/actions'
                }
            });
        });

        // Register API routes
        this.app.use('/api/lawnmowers', lawnmowerRoutes);
        this.app.use('/api/lawnmower', lawnmowerRoutes);
        
        // Telemetry routes
        this.app.use('/api/lawnmower', batteryRoutes);
        this.app.use('/api/lawnmower', gpsRoutes);
        this.app.use('/api/lawnmower', stateRoutes);

        // Error handling middleware
        this.app.use((error, req, res, next) => {
            console.error('Server error:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
            });
        });

        // 404 handler
        this.app.use('*', (req, res) => {
            res.status(404).json({
                error: 'Not Found',
                message: `Route ${req.originalUrl} not found`
            });
        });
    }

    async start() {
        try {
            // Initialize database connection
            console.log('Initializing database connection...');
            await dbConnection.connect();
            await dbConnection.initializeSchema();

            // Start server
            this.server = this.app.listen(this.port, () => {
                console.log(`Lawnmower Management Server running on port ${this.port}`);
                console.log(`API available at: http://localhost:${this.port}/api`);
                console.log(`Health check: http://localhost:${this.port}/api/health`);
            });

            return this.server;
        } catch (error) {
            console.error('Failed to start server:', error);
            process.exit(1);
        }
    }

    async stop() {
        console.log('Shutting down server...');
        
        if (this.server) {
            this.server.close();
        }
        
        await dbConnection.close();
        console.log('Server stopped');
    }
}

// Handle graceful shutdown
const server = new LawnmowerServer();

process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT, shutting down gracefully...');
    await server.stop();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\nReceived SIGTERM, shutting down gracefully...');
    await server.stop();
    process.exit(0);
});

// Start server if this file is run directly
if (require.main === module) {
    server.start().catch(console.error);
}

module.exports = server;