
import mongoose from 'mongoose'
import { randomBytes } from 'node:crypto'

import Return from '../models/Return.js'
import Sale from '../models/Sale.js'
import Product from '../models/Product.js'

const roundMoney = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100

const sendError = (res, status, message) =>
  res.status(status).json({ success: false, message })

const makeReturnNumber = () => {
  const date = new Date()
  const datePart = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('')

  return `RET-${datePart}-${randomBytes(4).toString('hex').toUpperCase()}`
}

// POST /api/returns
export const createReturn = async (req, res) => {
  const session = await mongoose.startSession()

  try {
    const {
      saleId,
      items,
      refundMethod,
      notes = '',
    } = req.body

    if (!mongoose.isValidObjectId(saleId)) {
      return sendError(res, 400, 'A valid sale ID is required.')
    }

    if (!Array.isArray(items) || items.length === 0) {
      return sendError(res, 400, 'Select at least one item to return.')
    }

    if (
      !['cash', 'upi', 'card', 'bank_transfer', 'other'].includes(
        refundMethod
      )
    ) {
      return sendError(res, 400, 'Choose a valid refund method.')
    }

    if (typeof notes !== 'string') {
      return sendError(res, 400, 'Return notes are invalid.')
    }

    const requestedItems = new Map()

    for (const item of items) {
      const productId = String(item?.product || item?.productId || '')
      const quantity = Number(item?.quantity)
      const restock = item?.restock !== false
      const reason = typeof item?.reason === 'string' ? item.reason.trim() : ''

      if (!mongoose.isValidObjectId(productId)) {
        return sendError(res, 400, 'A returned product ID is invalid.')
      }

      if (!Number.isInteger(quantity) || quantity < 1) {
        return sendError(
          res,
          400,
          'Return quantities must be positive whole numbers.'
        )
      }

      if (requestedItems.has(productId)) {
        return sendError(
          res,
          400,
          'Send each product only once per return.'
        )
      }

      requestedItems.set(productId, { quantity, restock, reason })
    }

    let createdReturn

    await session.withTransaction(async () => {
      const sale = await Sale.findById(saleId).session(session)

      if (!sale) {
        throw new Error('Original sale was not found.')
      }

      const previousReturns = await Return.find({
        sale: sale._id,
        status: 'completed',
      }).session(session)

      const alreadyReturned = new Map()

      for (const previousReturn of previousReturns) {
        for (const item of previousReturn.items) {
          const id = String(item.product)
          alreadyReturned.set(
            id,
            (alreadyReturned.get(id) || 0) + item.quantity
          )
        }
      }

      const returnItems = []
      let totalRefund = 0

      for (const [productId, requested] of requestedItems.entries()) {
        const soldItem = sale.items.find(
          (item) => String(item.product) === productId
        )

        if (!soldItem) {
          throw new Error(
            `Product ${productId} does not belong to this invoice.`
          )
        }

        const priorQuantity = alreadyReturned.get(productId) || 0
        const remainingQuantity = soldItem.quantity - priorQuantity

        if (requested.quantity > remainingQuantity) {
          throw new Error(
            `Cannot return ${requested.quantity} units of ${soldItem.productName}. Only ${remainingQuantity} unit(s) remain eligible for return.`
          )
        }

        const unitPrice = roundMoney(soldItem.unitPrice)
        const refundAmount = roundMoney(
          unitPrice * requested.quantity
        )

        totalRefund = roundMoney(totalRefund + refundAmount)

        returnItems.push({
          product: soldItem.product,
          productName: soldItem.productName,
          sku: soldItem.sku,
          quantity: requested.quantity,
          unitPrice,
          refundAmount,
          restock: requested.restock,
          reason: requested.reason,
        })
      }

      // Restock only items marked as fit for resale.
      for (const item of returnItems) {
        if (!item.restock) continue

        const update = await Product.updateOne(
          { _id: item.product },
          { $inc: { stock: item.quantity } },
          { session }
        )

        if (update.matchedCount !== 1) {
          throw new Error(
            `Product ${item.productName} no longer exists, so its stock could not be restored.`
          )
        }
      }

      const returnRecord = new Return({
        returnNumber: makeReturnNumber(),
        sale: sale._id,
        invoiceNumber: sale.invoiceNumber,
        items: returnItems,
        totalRefund,
        refundMethod,
        status: 'completed',
        notes: notes.trim(),
      })

      await returnRecord.save({ session })
      createdReturn = returnRecord
    })

    return res.status(201).json({
      success: true,
      message: 'Return recorded successfully.',
      return: createdReturn,
    })
  } catch (error) {
    if (
      error.message?.includes('Original sale was not found') ||
      error.message?.includes('does not belong to this invoice') ||
      error.message?.includes('Only ') ||
      error.message?.includes('Cannot return') ||
      error.message?.includes('no longer exists')
    ) {
      return sendError(res, 400, error.message)
    }

    console.error('Create return error:', error)

    return sendError(res, 500, 'Unable to process return.')
  } finally {
    await session.endSession()
  }
}

// GET /api/returns
export const getReturns = async (req, res) => {
  try {
    const {
      search = '',
      startDate = '',
      endDate = '',
      page = 1,
      limit = 10,
    } = req.query

    const currentPage = Math.max(1, Number.parseInt(page, 10) || 1)
    const pageSize = Math.min(
      100,
      Math.max(1, Number.parseInt(limit, 10) || 10)
    )

    const filter = { status: 'completed' }

    if (startDate || endDate) {
      const createdAt = {}

      if (startDate) {
        const start = new Date(startDate)

        if (Number.isNaN(start.getTime())) {
          return sendError(res, 400, 'Invalid start date.')
        }

        start.setHours(0, 0, 0, 0)
        createdAt.$gte = start
      }

      if (endDate) {
        const end = new Date(endDate)

        if (Number.isNaN(end.getTime())) {
          return sendError(res, 400, 'Invalid end date.')
        }

        end.setHours(23, 59, 59, 999)
        createdAt.$lte = end
      }

      filter.createdAt = createdAt
    }

    const trimmedSearch = String(search).trim()

    if (trimmedSearch) {
      const escapedSearch = trimmedSearch.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
      )
      const regex = new RegExp(escapedSearch, 'i')

      filter.$or = [
        { returnNumber: regex },
        { invoiceNumber: regex },
      ]
    }

    const [returns, total, summary] = await Promise.all([
      Return.find(filter)
        .populate('sale', 'customerName customerPhone invoiceNumber')
        .sort({ createdAt: -1 })
        .skip((currentPage - 1) * pageSize)
        .limit(pageSize)
        .lean(),

      Return.countDocuments(filter),

      Return.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            totalRefunds: { $sum: '$totalRefund' },
            totalReturns: { $sum: 1 },
          },
        },
      ]),
    ])

    return res.json({
      success: true,
      returns,
      pagination: {
        total,
        page: currentPage,
        limit: pageSize,
        pages: Math.ceil(total / pageSize),
      },
      summary: {
        totalRefunds: summary[0]?.totalRefunds || 0,
        totalReturns: summary[0]?.totalReturns || 0,
      },
    })
  } catch (error) {
    console.error('Get returns error:', error)
    return sendError(res, 500, 'Unable to fetch returns.')
  }
}

// GET /api/returns/:id
export const getReturnById = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return sendError(res, 400, 'Invalid return ID.')
    }

    const returnRecord = await Return.findById(req.params.id)
      .populate('sale', 'customerName customerPhone invoiceNumber createdAt')
      .lean()

    if (!returnRecord) {
      return sendError(res, 404, 'Return record not found.')
    }

    return res.json({
      success: true,
      return: returnRecord,
    })
  } catch (error) {
    console.error('Get return error:', error)
    return sendError(res, 500, 'Unable to fetch return details.')
  }
}
