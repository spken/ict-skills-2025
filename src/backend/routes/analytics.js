const express = require('express');
const analyticsService = require('../services/analyticsService');
const router = express.Router();

// GET /api/lawnmower/:id/analytics/distance - Calculate total distance
router.get('/:id/analytics/distance', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        
        if (isNaN(id)) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid ID parameter'
            });
        }
        
        // Check if lawnmower exists
        const exists = await analyticsService.verifyLawnmowerExists(id);
        if (!exists) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Lawnmower not found'
            });
        }
        
        // Validate optional date parameters
        const fromDate = req.query.from;
        const toDate = req.query.to;
        
        if ((fromDate && !analyticsService.isValidDateTime(fromDate)) ||
            (toDate && !analyticsService.isValidDateTime(toDate))) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid date format. Expected: YYYY-MM-DD or YYYY-MM-DD HH:MM:SS'
            });
        }
        
        const result = await analyticsService.calculateDistance(id, fromDate, toDate);
        res.json(result);
    } catch (error) {
        console.error('Error in GET /api/lawnmower/:id/analytics/distance:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: error.message
        });
    }
});

// GET /api/lawnmower/:id/analytics/hours - Calculate operational hours
router.get('/:id/analytics/hours', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        
        if (isNaN(id)) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid ID parameter'
            });
        }
        
        // Check if lawnmower exists
        const exists = await analyticsService.verifyLawnmowerExists(id);
        if (!exists) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Lawnmower not found'
            });
        }
        
        // Validate optional date parameters
        const fromDate = req.query.from;
        const toDate = req.query.to;
        
        if ((fromDate && !analyticsService.isValidDateTime(fromDate)) ||
            (toDate && !analyticsService.isValidDateTime(toDate))) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid date format. Expected: YYYY-MM-DD or YYYY-MM-DD HH:MM:SS'
            });
        }
        
        const result = await analyticsService.calculateOperationalHours(id, fromDate, toDate);
        res.json(result);
    } catch (error) {
        console.error('Error in GET /api/lawnmower/:id/analytics/hours:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: error.message
        });
    }
});

// GET /api/lawnmower/:id/analytics/efficency - Calculate efficiency metrics
router.get('/:id/analytics/efficency', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        
        if (isNaN(id)) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid ID parameter'
            });
        }
        
        // Check if lawnmower exists
        const exists = await analyticsService.verifyLawnmowerExists(id);
        if (!exists) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Lawnmower not found'
            });
        }
        
        // Validate optional date parameters
        const fromDate = req.query.from;
        const toDate = req.query.to;
        
        if ((fromDate && !analyticsService.isValidDateTime(fromDate)) ||
            (toDate && !analyticsService.isValidDateTime(toDate))) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid date format. Expected: YYYY-MM-DD or YYYY-MM-DD HH:MM:SS'
            });
        }
        
        const result = await analyticsService.calculateEfficiency(id, fromDate, toDate);
        res.json(result);
    } catch (error) {
        console.error('Error in GET /api/lawnmower/:id/analytics/efficency:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: error.message
        });
    }
});

// GET /api/lawnmower/:id/analytics/energy - Calculate energy statistics
router.get('/:id/analytics/energy', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        
        if (isNaN(id)) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid ID parameter'
            });
        }
        
        // Check if lawnmower exists
        const exists = await analyticsService.verifyLawnmowerExists(id);
        if (!exists) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Lawnmower not found'
            });
        }
        
        // Validate optional date parameters
        const fromDate = req.query.from;
        const toDate = req.query.to;
        
        if ((fromDate && !analyticsService.isValidDateTime(fromDate)) ||
            (toDate && !analyticsService.isValidDateTime(toDate))) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid date format. Expected: YYYY-MM-DD or YYYY-MM-DD HH:MM:SS'
            });
        }
        
        const result = await analyticsService.calculateEnergyStatistics(id, fromDate, toDate);
        res.json(result);
    } catch (error) {
        console.error('Error in GET /api/lawnmower/:id/analytics/energy:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: error.message
        });
    }
});

module.exports = router;