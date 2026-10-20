
import express from 'express'
import {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from '../controllers/categoryController.js'
import {
  requireAuth,
  requireRole,
} from '../middleware.js/authMiddleware.js'

const router = express.Router()

// Logged-in admins and staff can view categories.
router.get('/', requireAuth, getCategories)

// Only admins can manage categories.
router.post('/', requireAuth, requireRole('admin'), createCategory)
router.put('/:id', requireAuth, requireRole('admin'), updateCategory)
router.delete('/:id', requireAuth, requireRole('admin'), deleteCategory)

export default router
