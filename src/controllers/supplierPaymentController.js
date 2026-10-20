
import mongoose from 'mongoose'
import SupplierPayment from '../models/SupplierPayment.js'
import Purchase from '../models/Purchase.js'
import Supplier from '../models/Supplier.js'

const isValidId = (id) => mongoose.isValidObjectId(id)

const roundMoney = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100

const escapeRegex = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Record a payment against a received credit purchase.
export const createSupplierPayment = async (req, res) => {
  const {
    supplier: supplierId,
    purchase: purchaseId,
    amount,
    paymentMethod = 'cash',
    referenceNumber = '',
    paymentDate,
    notes = '',
  } = req.body

  if (!isValidId(supplierId) || !isValidId(purchaseId)) {
    return res.status(400).json({
      success: false,
      message: 'Valid supplier and purchase IDs are required',
    })
  }

  const parsedAmount = Number(amount)

  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Payment amount must be greater than zero',
    })
  }

  const allowedMethods = [
    'cash',
    'bank_transfer',
    'upi',
    'cheque',
    'other',
  ]

  if (!allowedMethods.includes(paymentMethod)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid payment method',
    })
  }

  let parsedDate = new Date()

  if (paymentDate !== undefined && paymentDate !== '') {
    parsedDate = new Date(paymentDate)

    if (Number.isNaN(parsedDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment date',
      })
    }

    if (parsedDate.getTime() > Date.now()) {
      return res.status(400).json({
        success: false,
        message: 'Payment date cannot be in the future',
      })
    }
  }

  const session = await mongoose.startSession()

  try {
    let createdPayment
    let remainingBalance = 0

    await session.withTransaction(async () => {
      const supplier = await Supplier.findOne({
        _id: supplierId,
        isActive: true,
      }).session(session)

      if (!supplier) {
        const error = new Error('Active supplier not found')
        error.statusCode = 404
        throw error
      }

      const purchase = await Purchase.findOne({
        _id: purchaseId,
        supplier: supplierId,
      }).session(session)

      if (!purchase) {
        const error = new Error(
          'Purchase not found for this supplier'
        )
        error.statusCode = 404
        throw error
      }

      if (purchase.purchaseStatus !== 'received') {
        const error = new Error(
          'Only received purchases can have payments recorded'
        )
        error.statusCode = 400
        throw error
      }

      if (purchase.paymentStatus === 'paid') {
        const error = new Error(
          'This purchase is already marked as fully paid'
        )
        error.statusCode = 409
        throw error
      }

      const payments = await SupplierPayment.aggregate([
        { $match: { purchase: purchase._id } },
        {
          $group: {
            _id: null,
            totalPaid: { $sum: '$amount' },
          },
        },
      ]).session(session)

      const totalPaid = roundMoney(payments[0]?.totalPaid || 0)
      const outstanding = roundMoney(
        Number(purchase.totalAmount) - totalPaid
      )
      const amountToPay = roundMoney(parsedAmount)

      if (amountToPay > outstanding) {
        const error = new Error(
          `Payment exceeds the outstanding balance of ₹${outstanding.toFixed(2)}`
        )
        error.statusCode = 400
        throw error
      }

      const payment = new SupplierPayment({
        supplier: supplier._id,
        purchase: purchase._id,
        amount: amountToPay,
        paymentMethod,
        referenceNumber: String(referenceNumber || '').trim(),
        paymentDate: parsedDate,
        notes: String(notes || '').trim(),
      })

      await payment.save({ session })

      const newTotalPaid = roundMoney(totalPaid + amountToPay)
      remainingBalance = roundMoney(
        Number(purchase.totalAmount) - newTotalPaid
      )

      if (remainingBalance <= 0) {
        purchase.paymentStatus = 'paid'
        await purchase.save({ session })
      }

      createdPayment = payment.toObject()
    })

    return res.status(201).json({
      success: true,
      message: 'Supplier payment recorded successfully',
      payment: createdPayment,
      outstandingBalance: remainingBalance,
    })
  } catch (error) {
    console.error('Create supplier payment error:', error)

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to record supplier payment',
    })
  } finally {
    await session.endSession()
  }
}

// Get payment history for one supplier.
export const getSupplierPayments = async (req, res) => {
  try {
    const { supplierId } = req.params

    if (!isValidId(supplierId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid supplier ID',
      })
    }

    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 10)
    )

    const supplier = await Supplier.findById(supplierId).lean()

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found',
      })
    }

    const filter = { supplier: supplier._id }

    const [payments, total, totals] = await Promise.all([
      SupplierPayment.find(filter)
        .sort({ paymentDate: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('purchase', 'purchaseNumber totalAmount')
        .lean(),

      SupplierPayment.countDocuments(filter),

      SupplierPayment.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            totalPaid: { $sum: '$amount' },
          },
        },
      ]),
    ])

    return res.status(200).json({
      success: true,
      supplier,
      payments,
      totalPaid: roundMoney(totals[0]?.totalPaid || 0),
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Get supplier payments error:', error)

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch supplier payment history',
    })
  }
}

// Get all purchase and payment entries for a supplier.
export const getSupplierLedger = async (req, res) => {
  try {
    const { supplierId } = req.params

    if (!isValidId(supplierId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid supplier ID',
      })
    }

    const supplier = await Supplier.findById(supplierId).lean()

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found',
      })
    }

    const [purchases, paymentTotals, paymentHistory] = await Promise.all([
      Purchase.find({
        supplier: supplier._id,
        purchaseStatus: 'received',
      })
        .sort({ createdAt: -1 })
        .lean(),

      SupplierPayment.aggregate([
        { $match: { supplier: supplier._id } },
        {
          $group: {
            _id: null,
            totalPaid: { $sum: '$amount' },
          },
        },
      ]),

      SupplierPayment.find({ supplier: supplier._id })
        .sort({ paymentDate: -1, createdAt: -1 })
        .populate('purchase', 'purchaseNumber')
        .lean(),
    ])

    const purchaseEntries = purchases.map((purchase) => ({
      type: 'purchase',
      date: purchase.receivedAt || purchase.createdAt,
      reference: purchase.purchaseNumber,
      purchaseId: purchase._id,
      description: `Purchase from ${supplier.name}`,
      debit: roundMoney(purchase.totalAmount),
      credit: 0,
      purchaseStatus: purchase.purchaseStatus,
      paymentStatus: purchase.paymentStatus,
    }))

    const paymentEntries = paymentHistory.map((payment) => ({
      type: 'payment',
      date: payment.paymentDate,
      reference: payment.referenceNumber || 'Supplier payment',
      purchaseId: payment.purchase?._id || payment.purchase,
      description: `Payment via ${payment.paymentMethod.replace('_', ' ')}`,
      debit: 0,
      credit: roundMoney(payment.amount),
      paymentMethod: payment.paymentMethod,
      paymentId: payment._id,
    }))

    const entries = [...purchaseEntries, ...paymentEntries].sort(
      (a, b) => new Date(a.date) - new Date(b.date)
    )

    let runningBalance = 0

    const ledger = entries.map((entry) => {
      runningBalance = roundMoney(
        runningBalance + entry.debit - entry.credit
      )

      return {
        ...entry,
        balance: runningBalance,
      }
    })

    const totalPurchases = roundMoney(
      purchases.reduce(
        (sum, purchase) => sum + Number(purchase.totalAmount || 0),
        0
      )
    )

    const totalPaid = roundMoney(paymentTotals[0]?.totalPaid || 0)

    return res.status(200).json({
      success: true,
      supplier,
      summary: {
        totalPurchases,
        totalPaid,
        outstandingBalance: roundMoney(totalPurchases - totalPaid),
      },
      ledger,
    })
  } catch (error) {
    console.error('Get supplier ledger error:', error)

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch supplier ledger',
    })
  }
}

// Get payment history for one purchase.
export const getPurchasePayments = async (req, res) => {
  try {
    const { purchaseId } = req.params

    if (!isValidId(purchaseId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid purchase ID',
      })
    }

    const purchase = await Purchase.findById(purchaseId).lean()

    if (!purchase) {
      return res.status(404).json({
        success: false,
        message: 'Purchase not found',
      })
    }

    const payments = await SupplierPayment.find({
      purchase: purchase._id,
    })
      .sort({ paymentDate: -1, createdAt: -1 })
      .lean()

    const totalPaid = roundMoney(
      payments.reduce((sum, payment) => sum + Number(payment.amount), 0)
    )

    return res.status(200).json({
      success: true,
      purchase,
      payments,
      totalPaid,
      outstandingBalance: roundMoney(
        Number(purchase.totalAmount) - totalPaid
      ),
    })
  } catch (error) {
    console.error('Get purchase payments error:', error)

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch purchase payments',
    })
  }
}
