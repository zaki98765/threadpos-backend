
import mongoose from 'mongoose'
import { randomBytes } from 'node:crypto'
import Purchase from '../models/Purchase.js'
import Product from '../models/Product.js'
import Supplier from '../models/Supplier.js'

const escapeRegex = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const roundMoney = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100

const makePurchaseNumber = () =>
  `PUR-${Date.now()}-${randomBytes(3).toString('hex').toUpperCase()}`

const invalidId = (id) => !mongoose.isValidObjectId(id)

export const getPurchases = async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 10)
    )

    const filter = {}

    if (req.query.status) {
      if (!['pending', 'received', 'cancelled'].includes(req.query.status)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid purchase status',
        })
      }

      filter.purchaseStatus = req.query.status
    }

    if (req.query.paymentStatus) {
      if (!['paid', 'credit'].includes(req.query.paymentStatus)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid payment status',
        })
      }

      filter.paymentStatus = req.query.paymentStatus
    }

    if (req.query.supplier && invalidId(req.query.supplier)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid supplier ID',
      })
    }

    if (req.query.supplier) {
      filter.supplier = req.query.supplier
    }

    if (req.query.search?.trim()) {
      const regex = new RegExp(escapeRegex(req.query.search.trim()), 'i')

      filter.$or = [
        { purchaseNumber: regex },
        { supplierName: regex },
        { 'items.productName': regex },
        { 'items.sku': regex },
      ]
    }

    const [purchases, total] = await Promise.all([
      Purchase.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('supplier', 'name companyName phone')
        .lean(),

      Purchase.countDocuments(filter),
    ])

    return res.status(200).json({
      success: true,
      purchases,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Get purchases error:', error)

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch purchases',
    })
  }
}

export const getPurchaseById = async (req, res) => {
  try {
    if (invalidId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid purchase ID',
      })
    }

    const purchase = await Purchase.findById(req.params.id)
      .populate('supplier', 'name companyName phone email address')
      .populate('items.product', 'name sku stock')

    if (!purchase) {
      return res.status(404).json({
        success: false,
        message: 'Purchase not found',
      })
    }

    return res.status(200).json({
      success: true,
      purchase,
    })
  } catch (error) {
    console.error('Get purchase error:', error)

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch purchase',
    })
  }
}

export const createPurchase = async (req, res) => {
  try {
    const {
      supplier: supplierId,
      items,
      discount = 0,
      paymentStatus = 'credit',
      notes = '',
    } = req.body

    if (!supplierId || invalidId(supplierId)) {
      return res.status(400).json({
        success: false,
        message: 'A valid supplier is required',
      })
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Add at least one purchase item',
      })
    }

    if (!['paid', 'credit'].includes(paymentStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Payment status must be paid or credit',
      })
    }

    const parsedDiscount = Number(discount)

    if (
      !Number.isFinite(parsedDiscount) ||
      parsedDiscount < 0
    ) {
      return res.status(400).json({
        success: false,
        message: 'Discount must be a valid non-negative amount',
      })
    }

    const supplier = await Supplier.findOne({
      _id: supplierId,
      isActive: true,
    }).lean()

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Active supplier not found',
      })
    }

    // Combine duplicate product lines before calculating totals.
    const itemMap = new Map()

    for (const item of items) {
      const productId = String(item.product || '')

      if (!mongoose.isValidObjectId(productId)) {
        return res.status(400).json({
          success: false,
          message: 'Each item must contain a valid product ID',
        })
      }

      const quantity = Number(item.quantity)
      const unitCost = Number(item.unitCost)

      if (!Number.isInteger(quantity) || quantity < 1) {
        return res.status(400).json({
          success: false,
          message: 'Each item quantity must be a positive whole number',
        })
      }

      if (!Number.isFinite(unitCost) || unitCost < 0) {
        return res.status(400).json({
          success: false,
          message: 'Each purchase price must be a valid non-negative amount',
        })
      }

      const existing = itemMap.get(productId)

      if (existing) {
        existing.quantity += quantity
        existing.unitCost = unitCost
      } else {
        itemMap.set(productId, { productId, quantity, unitCost })
      }
    }

    const productIds = [...itemMap.keys()]

    const products = await Product.find({
      _id: { $in: productIds },
      isActive: true,
    }).lean()

    if (products.length !== productIds.length) {
      return res.status(400).json({
        success: false,
        message: 'One or more products do not exist or are inactive',
      })
    }

    const productMap = new Map(
      products.map((product) => [String(product._id), product])
    )

    const purchaseItems = [...itemMap.values()].map((item) => {
      const product = productMap.get(item.productId)
      const lineTotal = roundMoney(item.quantity * item.unitCost)

      return {
        product: product._id,
        productName: product.name,
        sku: product.sku || '',
        quantity: item.quantity,
        unitCost: item.unitCost,
        lineTotal,
      }
    })

    const subtotal = roundMoney(
      purchaseItems.reduce((sum, item) => sum + item.lineTotal, 0)
    )

    if (parsedDiscount > subtotal) {
      return res.status(400).json({
        success: false,
        message: 'Discount cannot exceed the purchase subtotal',
      })
    }

    const totalAmount = roundMoney(subtotal - parsedDiscount)

    const purchase = await Purchase.create({
      purchaseNumber: makePurchaseNumber(),
      supplier: supplier._id,
      supplierName: supplier.name,
      items: purchaseItems,
      subtotal,
      discount: roundMoney(parsedDiscount),
      totalAmount,
      paymentStatus,
      purchaseStatus: 'pending',
      notes: String(notes || '').trim(),
    })

    return res.status(201).json({
      success: true,
      message: 'Purchase created. Receive it to add stock to inventory.',
      purchase,
    })
  } catch (error) {
    console.error('Create purchase error:', error)

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
      message: 'Failed to create purchase',
    })
  }
}

export const receivePurchase = async (req, res) => {
  if (invalidId(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid purchase ID',
    })
  }

  const session = await mongoose.startSession()

  try {
    let receivedPurchase

    await session.withTransaction(async () => {
      const purchase = await Purchase.findById(req.params.id).session(session)

      if (!purchase) {
        const error = new Error('Purchase not found')
        error.statusCode = 404
        throw error
      }

      if (purchase.purchaseStatus === 'received') {
        const error = new Error('This purchase has already been received')
        error.statusCode = 409
        throw error
      }

      if (purchase.purchaseStatus === 'cancelled') {
        const error = new Error('A cancelled purchase cannot be received')
        error.statusCode = 400
        throw error
      }

      for (const item of purchase.items) {
        const result = await Product.updateOne(
          {
            _id: item.product,
            isActive: true,
            stock: { $lte: Number.MAX_SAFE_INTEGER - item.quantity },
          },
          {
            $inc: { stock: item.quantity },
          },
          { session }
        )

        if (result.modifiedCount !== 1) {
          const error = new Error(
            `Unable to update stock for "${item.productName}". The product may be inactive or its stock would exceed the supported limit.`
          )
          error.statusCode = 409
          throw error
        }
      }

      purchase.purchaseStatus = 'received'
      purchase.receivedAt = new Date()

      await purchase.save({ session })

      receivedPurchase = purchase.toObject()
    })

    return res.status(200).json({
      success: true,
      message: 'Purchase received and inventory updated successfully',
      purchase: receivedPurchase,
    })
  } catch (error) {
    console.error('Receive purchase error:', error)

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to receive purchase',
    })
  } finally {
    await session.endSession()
  }
}

export const cancelPurchase = async (req, res) => {
  try {
    if (invalidId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid purchase ID',
      })
    }

    const purchase = await Purchase.findOneAndUpdate(
      {
        _id: req.params.id,
        purchaseStatus: 'pending',
      },
      {
        $set: {
          purchaseStatus: 'cancelled',
          cancelledAt: new Date(),
        },
      },
      { new: true, runValidators: true }
    )

    if (!purchase) {
      const existing = await Purchase.findById(req.params.id)

      if (!existing) {
        return res.status(404).json({
          success: false,
          message: 'Purchase not found',
        })
      }

      return res.status(409).json({
        success: false,
        message: 'Only pending purchases can be cancelled',
      })
    }

    return res.status(200).json({
      success: true,
      message: 'Purchase cancelled successfully',
      purchase,
    })
  } catch (error) {
    console.error('Cancel purchase error:', error)

    return res.status(500).json({
      success: false,
      message: 'Failed to cancel purchase',
    })
  }
}
