
import jwt from 'jsonwebtoken'
import User from '../models/User.js'

export const requireAuth = async (req, res, next) => {
  try {
    const cookieHeader = req.headers.cookie || ''

    const tokenCookie = cookieHeader
      .split(';')
      .map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith('threadpos_token='))

    const token = tokenCookie
      ? decodeURIComponent(tokenCookie.substring('threadpos_token='.length))
      : null

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please log in.',
      })
    }

    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET is not configured.')
      return res.status(500).json({
        success: false,
        message: 'Authentication is not configured.',
      })
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const user = await User.findById(decoded.id)

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Your account is invalid or inactive. Please log in again.',
      })
    }

    req.user = user
    next()
  } catch (error) {
    if (
      error.name === 'JsonWebTokenError' ||
      error.name === 'TokenExpiredError' ||
      error.name === 'CastError'
    ) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired session. Please log in again.',
      })
    }

    console.error('Authentication middleware error:', error.message)
    return res.status(500).json({
      success: false,
      message: 'Unable to verify authentication.',
    })
  }
}

export const requireRole = (...allowedRoles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required.',
    })
  }

  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: 'You do not have permission to perform this action.',
    })
  }

  next()
}
