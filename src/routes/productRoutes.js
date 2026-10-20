
import express from 'express'
import {
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct,
} from '../controllers/productController.js'
import {
  requireAuth,
  requireRole,
} from '../middleware.js/authMiddleware.js'

const router = express.Router()

// Logged-in admins and staff can view products for billing.
router.get('/', requireAuth, getProducts)

// Only admins can manage the product catalogue.
router.post('/', requireAuth, requireRole('admin'), createProduct)
router.put('/:id', requireAuth, requireRole('admin'), updateProduct)
router.delete('/:id', requireAuth, requireRole('admin'), deleteProduct)

export default router
