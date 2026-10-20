
import express from 'express'

import {
  getPurchases,
  getPurchaseById,
  createPurchase,
  receivePurchase,
  cancelPurchase,
} from '../controllers/purchaseController.js'

import {
  requireAuth,
  requireRole,
} from '../middleware.js/authMiddleware.js'

const router = express.Router()

// Logged-in admins and staff can view purchases.
router.get('/', requireAuth, getPurchases)
router.get('/:id', requireAuth, getPurchaseById)

// Only admins can create or change purchases.
router.post('/', requireAuth, requireRole('admin'), createPurchase)
router.patch('/:id/receive', requireAuth, requireRole('admin'), receivePurchase)
router.patch('/:id/cancel', requireAuth, requireRole('admin'), cancelPurchase)

export default router
