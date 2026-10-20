
import Supplier from '../models/Supplier.js'

export const getSuppliers = async (req, res) => {
  try {
    const {
      search = '',
      page = 1,
      limit = 10,
    } = req.query

    const currentPage = Math.max(1, Number(page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(limit) || 10))

    const filter = { isActive: true }

    if (search.trim()) {
      const escapedSearch = search.trim().replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
      )

      const searchRegex = new RegExp(escapedSearch, 'i')

      filter.$or = [
        { name: searchRegex },
        { companyName: searchRegex },
        { phone: searchRegex },
        { email: searchRegex },
        { gstNumber: searchRegex },
      ]
    }

    const [suppliers, total] = await Promise.all([
      Supplier.find(filter)
        .sort({ createdAt: -1 })
        .skip((currentPage - 1) * pageSize)
        .limit(pageSize)
        .lean(),

      Supplier.countDocuments(filter),
    ])

    return res.status(200).json({
      success: true,
      suppliers,
      pagination: {
        total,
        page: currentPage,
        limit: pageSize,
        pages: Math.ceil(total / pageSize),
      },
    })
  } catch (error) {
    console.error('Get suppliers error:', error)

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch suppliers',
    })
  }
}

export const getSupplierById = async (req, res) => {
  try {
    const supplier = await Supplier.findOne({
      _id: req.params.id,
      isActive: true,
    })

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found',
      })
    }

    return res.status(200).json({
      success: true,
      supplier,
    })
  } catch (error) {
    console.error('Get supplier error:', error)

    return res.status(400).json({
      success: false,
      message: 'Invalid supplier ID',
    })
  }
}

export const createSupplier = async (req, res) => {
  try {
    const {
      name,
      companyName,
      phone,
      email,
      gstNumber,
      address,
      openingBalance,
      notes,
    } = req.body

    if (!name?.trim() || !phone?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Supplier name and phone number are required',
      })
    }

    const supplier = await Supplier.create({
      name,
      companyName,
      phone,
      email,
      gstNumber,
      address,
      openingBalance:
        openingBalance === '' || openingBalance == null
          ? 0
          : Number(openingBalance),
      notes,
    })

    return res.status(201).json({
      success: true,
      message: 'Supplier created successfully',
      supplier,
    })
  } catch (error) {
    console.error('Create supplier error:', error)

    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: Object.values(error.errors)
          .map((item) => item.message)
          .join(', '),
      })
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to create supplier',
    })
  }
}

export const updateSupplier = async (req, res) => {
  try {
    const allowedFields = [
      'name',
      'companyName',
      'phone',
      'email',
      'gstNumber',
      'address',
      'openingBalance',
      'notes',
    ]

    const updates = {}

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field]
      }
    }

    if (
      updates.openingBalance === '' ||
      updates.openingBalance === null
    ) {
      updates.openingBalance = 0
    } else if (updates.openingBalance !== undefined) {
      updates.openingBalance = Number(updates.openingBalance)
    }

    if (updates.name !== undefined && !updates.name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Supplier name is required',
      })
    }

    if (updates.phone !== undefined && !updates.phone.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required',
      })
    }

    const supplier = await Supplier.findOneAndUpdate(
      { _id: req.params.id, isActive: true },
      { $set: updates },
      {
        new: true,
        runValidators: true,
      }
    )

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found',
      })
    }

    return res.status(200).json({
      success: true,
      message: 'Supplier updated successfully',
      supplier,
    })
  } catch (error) {
    console.error('Update supplier error:', error)

    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: Object.values(error.errors)
          .map((item) => item.message)
          .join(', '),
      })
    }

    return res.status(400).json({
      success: false,
      message: 'Unable to update supplier. Check the supplier ID and input values.',
    })
  }
}

export const deleteSupplier = async (req, res) => {
  try {
    const supplier = await Supplier.findOneAndUpdate(
      { _id: req.params.id, isActive: true },
      { $set: { isActive: false } },
      { new: true }
    )

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found',
      })
    }

    return res.status(200).json({
      success: true,
      message: 'Supplier deleted successfully',
    })
  } catch (error) {
    console.error('Delete supplier error:', error)

    return res.status(400).json({
      success: false,
      message: 'Unable to delete supplier. Check the supplier ID.',
    })
  }
}
