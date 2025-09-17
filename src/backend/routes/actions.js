const express = require('express');
const actionsService = require('../services/actionsService');
const router = express.Router();

// POST /api/lawnmower/:id/actions/stop - Stop the lawnmower
router.post('/:id/actions/stop', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        
        if (isNaN(id)) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid ID parameter'
            });
        }
        
        const result = await actionsService.stopLawnmower(id);
        res.json(result);
    } catch (error) {
        console.error('Error in POST /api/lawnmower/:id/actions/stop:', error);
        
        if (error.message === 'Lawnmower not found') {
            return res.status(404).json({
                error: 'Not Found',
                message: error.message
            });
        }
        
        if (error.message.includes('not valid for current state')) {
            return res.status(400).json({
                error: 'Bad Request',
                message: error.message
            });
        }
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to execute stop command'
        });
    }
});

// POST /api/lawnmower/:id/actions/start - Start the lawnmower
router.post('/:id/actions/start', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        
        if (isNaN(id)) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid ID parameter'
            });
        }
        
        const result = await actionsService.startLawnmower(id);
        res.json(result);
    } catch (error) {
        console.error('Error in POST /api/lawnmower/:id/actions/start:', error);
        
        if (error.message === 'Lawnmower not found') {
            return res.status(404).json({
                error: 'Not Found',
                message: error.message
            });
        }
        
        if (error.message.includes('not valid for current state')) {
            return res.status(400).json({
                error: 'Bad Request',
                message: error.message
            });
        }
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to execute start command'
        });
    }
});

// POST /api/lawnmower/:id/actions/home - Send lawnmower home
router.post('/:id/actions/home', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        
        if (isNaN(id)) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid ID parameter'
            });
        }
        
        const result = await actionsService.homeLawnmower(id);
        res.json(result);
    } catch (error) {
        console.error('Error in POST /api/lawnmower/:id/actions/home:', error);
        
        if (error.message === 'Lawnmower not found') {
            return res.status(404).json({
                error: 'Not Found',
                message: error.message
            });
        }
        
        if (error.message.includes('not valid for current state')) {
            return res.status(400).json({
                error: 'Bad Request',
                message: error.message
            });
        }
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to execute home command'
        });
    }
});

// POST /api/lawnmower/:id/actions/ackerror - Acknowledge error
router.post('/:id/actions/ackerror', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        
        if (isNaN(id)) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid ID parameter'
            });
        }
        
        const result = await actionsService.acknowledgeError(id);
        res.json(result);
    } catch (error) {
        console.error('Error in POST /api/lawnmower/:id/actions/ackerror:', error);
        
        if (error.message === 'Lawnmower not found') {
            return res.status(404).json({
                error: 'Not Found',
                message: error.message
            });
        }
        
        if (error.message.includes('not valid for current state')) {
            return res.status(400).json({
                error: 'Bad Request',
                message: error.message
            });
        }
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to execute acknowledge error command'
        });
    }
});

// GET /api/actions - Get list of valid actions
router.get('/actions', (req, res) => {
    const validActions = actionsService.getValidActions();
    res.json({
        validActions: validActions,
        description: 'Valid remote control actions for lawnmowers',
        endpoints: {
            stop: 'POST /api/lawnmower/:id/actions/stop',
            start: 'POST /api/lawnmower/:id/actions/start',
            home: 'POST /api/lawnmower/:id/actions/home',
            ackerror: 'POST /api/lawnmower/:id/actions/ackerror'
        }
    });
});

module.exports = router;