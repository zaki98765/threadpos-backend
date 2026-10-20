
import express from 'express'

import {
  createSupplierPayment,
  getSupplierPayments,
  getSupplierLedger,
  getPurchasePayments,
} from '../controllers/supplierPaymentController.js'

import {
  requireAuth,
  requireRole,
} from '../middleware.js/authMiddleware.js'

const router = express.Router()

// Only admins can record supplier payments.
router.post('/', requireAuth, requireRole('admin'), createSupplierPayment)

// Logged-in admins and staff can view payment history and ledgers.
router.get(
  '/supplier/:supplierId/payments',
  requireAuth,
  getSupplierPayments
)

router.get(
  '/supplier/:supplierId/ledger',
  requireAuth,
  getSupplierLedger
)

router.get(
  '/purchase/:purchaseId/payments',
  requireAuth,
  getPurchasePayments
)

export default router
