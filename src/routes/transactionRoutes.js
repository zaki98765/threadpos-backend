
import express from 'express'
import { getTransactions } from '../controllers/transactionController.js'
import {
  requireAuth,
  requireRole,
} from '../middleware.js/authMiddleware.js'

const router = express.Router()

router.get('/', requireAuth, requireRole('admin'), getTransactions)

export default router
