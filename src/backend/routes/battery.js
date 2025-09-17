const express = require('express');
const batteryService = require('../services/batteryService');
const router = express.Router();

// GET /api/lawnmower/:id/battery/current - Get current battery level
router.get('/:id/battery/current', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        
        if (isNaN(id)) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid ID parameter'
            });
        }
        
        // Check if lawnmower exists
        const exists = await batteryService.verifyLawnmowerExists(id);
        if (!exists) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Lawnmower not found'
            });
        }
        
        const batteryData = await batteryService.getCurrentBatteryLevel(id);
        
        if (!batteryData) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'No battery data found for this lawnmower'
            });
        }
        
        res.json(batteryData);
    } catch (error) {
        console.error('Error in GET /api/lawnmower/:id/battery/current:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: error.message
        });
    }
});

// GET /api/lawnmower/:id/battery/history - Get battery history
router.get('/:id/battery/history', async (req, res) => {
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
        const exists = await batteryService.verifyLawnmowerExists(id);
        if (!exists) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Lawnmower not found'
            });
        }
        
        const batteryHistory = await batteryService.getBatteryHistory(id, req.query.from, req.query.to);
        
        res.json(batteryHistory);
    } catch (error) {
        console.error('Error in GET /api/lawnmower/:id/battery/history:', error);
        
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

// POST /api/lawnmower/:id/battery - Add battery reading (for testing/simulation)
router.post('/:id/battery', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        
        if (isNaN(id)) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid ID parameter'
            });
        }
        
        const { batteryLevel, timestamp } = req.body;
        
        if (batteryLevel === undefined || batteryLevel === null) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Battery level is required'
            });
        }
        
        // Check if lawnmower exists
        const exists = await batteryService.verifyLawnmowerExists(id);
        if (!exists) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Lawnmower not found'
            });
        }
        
        await batteryService.addBatteryReading(id, batteryLevel, timestamp);
        
        res.status(201).json({
            message: 'Battery reading added successfully',
            batteryLevel: batteryLevel,
            timestamp: timestamp || new Date().toISOString()
        });
    } catch (error) {
        console.error('Error in POST /api/lawnmower/:id/battery:', error);
        
        if (error.message.includes('Battery level must be') ||
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