
import mongoose from 'mongoose'
import User from '../models/User.js'

const publicStaff = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  isActive: user.isActive,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
})

// GET /api/staff
export const getStaff = async (req, res) => {
  try {
    const staff = await User.find({ role: 'staff' })
      .select('name email role isActive createdAt updatedAt')
      .sort({ createdAt: -1 })
      .lean()

    return res.status(200).json({
      success: true,
      count: staff.length,
      staff: staff.map(publicStaff),
    })
  } catch (error) {
    console.error('Get staff error:', error.message)
    return res.status(500).json({
      success: false,
      message: 'Unable to fetch staff accounts.',
    })
  }
}

// POST /api/staff
export const createStaff = async (req, res) => {
  try {
    const { name, email, password } = req.body

    if (
      typeof name !== 'string' ||
      !name.trim() ||
      typeof email !== 'string' ||
      !email.trim() ||
      typeof password !== 'string' ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message: 'Name, email and password are required.',
      })
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must contain at least 8 characters.',
      })
    }

    const normalizedEmail = email.trim().toLowerCase()

    const existingUser = await User.findOne({ email: normalizedEmail })

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email already exists.',
      })
    }

    // Never accept role or isActive from the request body.
    // Admin-created accounts are staff accounts only.
    const staff = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password,
      role: 'staff',
      isActive: true,
    })

    return res.status(201).json({
      success: true,
      message: 'Staff account created successfully.',
      staff: publicStaff(staff),
    })
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email already exists.',
      })
    }

    console.error('Create staff error:', error.message)
    return res.status(500).json({
      success: false,
      message: 'Unable to create staff account.',
    })
  }
}

// PATCH /api/staff/:id/status
export const updateStaffStatus = async (req, res) => {
  try {
    const { id } = req.params
    const { isActive } = req.body

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid staff ID.',
      })
    }

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'isActive must be true or false.',
      })
    }

    const staff = await User.findOneAndUpdate(
      { _id: id, role: 'staff' },
      { $set: { isActive } },
      { new: true, runValidators: true }
    ).select('name email role isActive createdAt updatedAt')

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: 'Staff account not found.',
      })
    }

    return res.status(200).json({
      success: true,
      message: `Staff account ${isActive ? 'activated' : 'deactivated'} successfully.`,
      staff: publicStaff(staff),
    })
  } catch (error) {
    console.error('Update staff status error:', error.message)
    return res.status(500).json({
      success: false,
      message: 'Unable to update staff status.',
    })
  }
}

// PATCH /api/staff/:id/password
export const resetStaffPassword = async (req, res) => {
  try {
    const { id } = req.params
    const { password } = req.body

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid staff ID.',
      })
    }

    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'New password must contain at least 8 characters.',
      })
    }

    const staff = await User.findOne({ _id: id, role: 'staff' })
      .select('+password')

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: 'Staff account not found.',
      })
    }

    staff.password = password
    await staff.save()

    return res.status(200).json({
      success: true,
      message: 'Staff password reset successfully.',
    })
  } catch (error) {
    console.error('Reset staff password error:', error.message)
    return res.status(500).json({
      success: false,
      message: 'Unable to reset staff password.',
    })
  }
}
