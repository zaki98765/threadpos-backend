
import express from 'express'
import {
  getStaff,
  createStaff,
  updateStaffStatus,
  resetStaffPassword,
} from '../controllers/staffController.js'
import {
  requireAuth,
  requireRole,
} from '../middleware.js/authMiddleware.js'

const router = express.Router()

// Every staff-management endpoint requires an authenticated admin.
router.use(requireAuth, requireRole('admin'))

router.get('/', getStaff)
router.post('/', createStaff)
router.patch('/:id/status', updateStaffStatus)
router.patch('/:id/password', resetStaffPassword)

export default router
