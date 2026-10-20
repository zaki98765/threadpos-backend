
import express from 'express'

import {
  createSale,
  getSales,
  getSaleById,
  getSaleByInvoice,
} from '../controllers/saleController.js'

import {
  requireAuth,
} from '../middleware.js/authMiddleware.js'

const router = express.Router()

// Logged-in admins and staff can create sales for billing.
router.post('/', requireAuth, createSale)

// Only authenticated users can access sales history.
router.get('/', requireAuth, getSales)

// Keep this route above /:id.
router.get('/invoice/:invoiceNumber', requireAuth, getSaleByInvoice)

// Get an invoice by its MongoDB ID.
router.get('/:id', requireAuth, getSaleById)

export default router
