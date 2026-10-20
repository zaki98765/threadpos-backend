
import express from 'express'
import { getReportOverview } from '../controllers/reportController.js'
import {
  requireAuth,
  requireRole,
} from '../middleware.js/authMiddleware.js'

const router = express.Router()

// Reports contain business and financial data.
router.get(
  '/overview',
  requireAuth,
  requireRole('admin'),
  getReportOverview
)

export default router
