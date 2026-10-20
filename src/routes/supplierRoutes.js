
import express from 'express'
import {
  getSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier,
} from '../controllers/supplierController.js'
import {
  requireAuth,
  requireRole,
} from '../middleware.js/authMiddleware.js'

const router = express.Router()

// Logged-in admins and staff can view suppliers.
router.get('/', requireAuth, getSuppliers)
router.get('/:id', requireAuth, getSupplierById)

// Only admins can manage supplier records.
router.post('/', requireAuth, requireRole('admin'), createSupplier)
router.put('/:id', requireAuth, requireRole('admin'), updateSupplier)
router.delete('/:id', requireAuth, requireRole('admin'), deleteSupplier)

export default router
