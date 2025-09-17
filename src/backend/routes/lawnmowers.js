const express = require('express');
const lawnmowerService = require('../services/lawnmowerService');
const router = express.Router();

// GET /api/lawnmowers - Get all lawnmowers with optional filters
router.get('/', async (req, res) => {
    try {
        const filters = {};
        
        // Extract query parameters for filtering
        if (req.query.id) {
            const id = parseInt(req.query.id);
            if (isNaN(id)) {
                return res.status(400).json({
                    error: 'Bad Request',
                    message: 'Invalid ID parameter'
                });
            }
            filters.id = id;
        }
        
        if (req.query.name) {
            filters.name = req.query.name.trim();
        }
        
        if (req.query.vendor) {
            filters.vendor = req.query.vendor.trim();
        }
        
        const lawnmowers = await lawnmowerService.getAllLawnmowers(filters);
        res.json(lawnmowers);
    } catch (error) {
        console.error('Error in GET /api/lawnmowers:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: error.message
        });
    }
});

// POST /api/lawnmower - Create a new lawnmower
router.post('/', async (req, res) => {
    try {
        const lawnmowerData = req.body;
        
        // Validate request body exists
        if (!lawnmowerData || Object.keys(lawnmowerData).length === 0) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Request body is required'
            });
        }
        
        const newLawnmower = await lawnmowerService.createLawnmower(lawnmowerData);
        res.status(201).json(newLawnmower);
    } catch (error) {
        console.error('Error in POST /api/lawnmower:', error);
        
        // Handle validation errors
        if (error.message.includes('Missing required field') || 
            error.message.includes('Invalid') ||
            error.message.includes('Serial number already exists')) {
            return res.status(400).json({
                error: 'Bad Request',
                message: error.message
            });
        }
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to create lawnmower'
        });
    }
});

// GET /api/lawnmower/:id - Get specific lawnmower by ID
router.get('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        
        if (isNaN(id)) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid ID parameter'
            });
        }
        
        const lawnmower = await lawnmowerService.getLawnmowerById(id);
        
        if (!lawnmower) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Lawnmower not found'
            });
        }
        
        res.json(lawnmower);
    } catch (error) {
        console.error('Error in GET /api/lawnmower/:id:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: error.message
        });
    }
});

// PUT /api/lawnmower - Update existing lawnmower
router.put('/', async (req, res) => {
    try {
        const lawnmowerData = req.body;
        
        // Validate request body exists
        if (!lawnmowerData || Object.keys(lawnmowerData).length === 0) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Request body is required'
            });
        }
        
        // Validate ID is provided
        if (!lawnmowerData.id) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'ID is required for update'
            });
        }
        
        const id = parseInt(lawnmowerData.id);
        if (isNaN(id)) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid ID'
            });
        }
        
        const updatedLawnmower = await lawnmowerService.updateLawnmower(id, lawnmowerData);
        res.json(updatedLawnmower);
    } catch (error) {
        console.error('Error in PUT /api/lawnmower:', error);
        
        // Handle specific errors
        if (error.message === 'Lawnmower not found') {
            return res.status(404).json({
                error: 'Not Found',
                message: error.message
            });
        }
        
        if (error.message.includes('Invalid') || 
            error.message.includes('Serial number already exists')) {
            return res.status(400).json({
                error: 'Bad Request',
                message: error.message
            });
        }
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to update lawnmower'
        });
    }
});

// DELETE /api/lawnmower/:id - Delete lawnmower
router.delete('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        
        if (isNaN(id)) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid ID parameter'
            });
        }
        
        await lawnmowerService.deleteLawnmower(id);
        
        // Return 204 No Content as specified in the assignment
        res.status(204).send();
    } catch (error) {
        console.error('Error in DELETE /api/lawnmower/:id:', error);
        
        if (error.message === 'Lawnmower not found') {
            return res.status(404).json({
                error: 'Not Found',
                message: error.message
            });
        }
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to delete lawnmower'
        });
    }
});

module.exports = router;