const express = require('express');
const stateService = require('../services/stateService');
const router = express.Router();

// GET /api/lawnmower/:id/state/current - Get current device state
router.get('/:id/state/current', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        
        if (isNaN(id)) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid ID parameter'
            });
        }
        
        // Check if lawnmower exists
        const exists = await stateService.verifyLawnmowerExists(id);
        if (!exists) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Lawnmower not found'
            });
        }
        
        const stateData = await stateService.getCurrentState(id);
        
        if (!stateData) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'No state data found for this lawnmower'
            });
        }
        
        res.json(stateData);
    } catch (error) {
        console.error('Error in GET /api/lawnmower/:id/state/current:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: error.message
        });
    }
});

// GET /api/lawnmower/:id/state/history - Get device state history
router.get('/:id/state/history', async (req, res) => {
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
        const exists = await stateService.verifyLawnmowerExists(id);
        if (!exists) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Lawnmower not found'
            });
        }
        
        const stateHistory = await stateService.getStateHistory(id, req.query.from, req.query.to);
        
        res.json(stateHistory);
    } catch (error) {
        console.error('Error in GET /api/lawnmower/:id/state/history:', error);
        
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

// POST /api/lawnmower/:id/state - Add state change (for testing/simulation)
router.post('/:id/state', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        
        if (isNaN(id)) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid ID parameter'
            });
        }
        
        const { state, timestamp } = req.body;
        
        if (!state) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'State is required'
            });
        }
        
        // Check if lawnmower exists
        const exists = await stateService.verifyLawnmowerExists(id);
        if (!exists) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Lawnmower not found'
            });
        }
        
        await stateService.addStateChange(id, state, timestamp);
        
        res.status(201).json({
            message: 'State change added successfully',
            state: state,
            timestamp: timestamp || new Date().toISOString()
        });
    } catch (error) {
        console.error('Error in POST /api/lawnmower/:id/state:', error);
        
        if (error.message.includes('Invalid state') ||
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

// GET /api/states - Get list of valid states
router.get('/states', (req, res) => {
    const validStates = stateService.getValidStates();
    res.json({
        validStates: validStates,
        description: 'Valid device states as defined in the lawnmower state machine'
    });
});

module.exports = router;
