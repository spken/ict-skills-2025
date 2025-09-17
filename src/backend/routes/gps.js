const express = require('express');
const gpsService = require('../services/gpsService');
const router = express.Router();

// GET /api/lawnmower/:id/gps/current - Get current GPS position
router.get('/:id/gps/current', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        
        if (isNaN(id)) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid ID parameter'
            });
        }
        
        // Check if lawnmower exists
        const exists = await gpsService.verifyLawnmowerExists(id);
        if (!exists) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Lawnmower not found'
            });
        }
        
        const gpsData = await gpsService.getCurrentPosition(id);
        
        if (!gpsData) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'No GPS data found for this lawnmower'
            });
        }
        
        res.json(gpsData);
    } catch (error) {
        console.error('Error in GET /api/lawnmower/:id/gps/current:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: error.message
        });
    }
});

// GET /api/lawnmower/:id/gps/history - Get GPS position history
router.get('/:id/gps/history', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        
        if (isNaN(id)) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid ID parameter'
            });
        }
        
        // Validate required query parameters
        if (!req.query.from || !req.query.to) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'From and to date parameters are required'
            });
        }
        
        // Check if lawnmower exists
        const exists = await gpsService.verifyLawnmowerExists(id);
        if (!exists) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Lawnmower not found'
            });
        }
        
        const gpsHistory = await gpsService.getPositionHistory(id, req.query.from, req.query.to);
        
        res.json(gpsHistory);
    } catch (error) {
        console.error('Error in GET /api/lawnmower/:id/gps/history:', error);
        
        if (error.message.includes('Invalid date format') || 
            error.message.includes('required')) {
            return res.status(400).json({
                error: 'Bad Request',
                message: error.message
            });
        }
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: error.message
        });
    }
});

// POST /api/lawnmower/:id/gps - Add GPS reading (for testing/simulation)
router.post('/:id/gps', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        
        if (isNaN(id)) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid ID parameter'
            });
        }
        
        const { latitude, longitude, timestamp } = req.body;
        
        if (latitude === undefined || latitude === null || 
            longitude === undefined || longitude === null) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Latitude and longitude are required'
            });
        }
        
        // Check if lawnmower exists
        const exists = await gpsService.verifyLawnmowerExists(id);
        if (!exists) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Lawnmower not found'
            });
        }
        
        await gpsService.addPositionReading(id, latitude, longitude, timestamp);
        
        res.status(201).json({
            message: 'GPS reading added successfully',
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude),
            timestamp: timestamp || new Date().toISOString()
        });
    } catch (error) {
        console.error('Error in POST /api/lawnmower/:id/gps:', error);
        
        if (error.message.includes('Invalid coordinates') ||
            error.message.includes('Invalid')) {
            return res.status(400).json({
                error: 'Bad Request',
                message: error.message
            });
        }
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: error.message
        });
    }
});

module.exports = router;