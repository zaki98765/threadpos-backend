
import express from 'express'

import {
  createReturn,
  getReturns,
  getReturnById,
} from '../controllers/returnController.js'

import {
  requireAuth,
  requireRole,
} from '../middleware.js/authMiddleware.js'

const router = express.Router()

// Only admins can process refunds and restock returned items.
router.post('/', requireAuth, requireRole('admin'), createReturn)

// Authenticated users can view return history.
router.get('/', requireAuth, getReturns)
router.get('/:id', requireAuth, getReturnById)

export default router
