
import mongoose from 'mongoose'
import { randomBytes } from 'node:crypto'

import Sale from '../models/Sale.js'
import Product from '../models/Product.js'

const roundMoney = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100

const makeInvoiceNumber = () => {
  const date = new Date()
  const datePart = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('')

  return `INV-${datePart}-${randomBytes(4).toString('hex').toUpperCase()}`
}

const sendError = (res, status, message) =>
  res.status(status).json({ success: false, message })

// POST /api/sales
export const createSale = async (req, res) => {
  const session = await mongoose.startSession()

  try {
    const {
      items,
      customerName = 'Walk-in Customer',
      customerPhone = '',
      discount = 0,
      taxRate = 0,
      paymentMethod,
      amountReceived,
      notes = '',
    } = req.body

    if (!Array.isArray(items) || items.length === 0) {
      return sendError(res, 400, 'Add at least one product to the sale.')
    }

    if (
      !['cash', 'upi', 'card', 'bank_transfer', 'other'].includes(
        paymentMethod
      )
    ) {
      return sendError(res, 400, 'Choose a valid payment method.')
    }

    if (
      !Number.isFinite(Number(discount)) ||
      Number(discount) < 0
    ) {
      return sendError(res, 400, 'Discount must be zero or greater.')
    }

    if (
      !Number.isFinite(Number(taxRate)) ||
      Number(taxRate) < 0 ||
      Number(taxRate) > 100
    ) {
      return sendError(res, 400, 'Tax rate must be between 0 and 100.')
    }

    if (
      !Number.isFinite(Number(amountReceived)) ||
      Number(amountReceived) < 0
    ) {
      return sendError(res, 400, 'Enter a valid amount received.')
    }

    if (
      typeof customerName !== 'string' ||
      typeof customerPhone !== 'string' ||
      typeof notes !== 'string'
    ) {
      return sendError(res, 400, 'Customer details or notes are invalid.')
    }

    // Merge repeated product IDs into one line item.
    const quantities = new Map()

    for (const item of items) {
      const productId = String(item?.product || item?.productId || '')
      const quantity = Number(item?.quantity)

      if (!mongoose.isValidObjectId(productId)) {
        return sendError(res, 400, 'A product ID is invalid.')
      }

      if (!Number.isInteger(quantity) || quantity < 1) {
        return sendError(
          res,
          400,
          'Each product quantity must be a positive whole number.'
        )
      }

      quantities.set(
        productId,
        (quantities.get(productId) || 0) + quantity
      )
    }

    let createdSale

    await session.withTransaction(async () => {
      const saleItems = []
      let subtotal = 0

      for (const [productId, quantity] of quantities.entries()) {
        const product = await Product.findOne({
          _id: productId,
          isActive: true,
        }).session(session)

        if (!product) {
          throw new Error(`Product ${productId} was not found or is inactive.`)
        }

        if (product.stock < quantity) {
          throw new Error(
            `Insufficient stock for "${product.name}". Available: ${product.stock}.`
          )
        }

        const unitPrice = roundMoney(product.sellingPrice)
        const costPrice = roundMoney(product.costPrice)
        const lineTotal = roundMoney(unitPrice * quantity)

        subtotal = roundMoney(subtotal + lineTotal)

        saleItems.push({
          product: product._id,
          productName: product.name,
          sku: product.sku,
          quantity,
          unitPrice,
          costPrice,
          lineTotal,
        })
      }

      const safeDiscount = roundMoney(Number(discount))
      const safeTaxRate = Number(taxRate)

      if (safeDiscount > subtotal) {
        throw new Error('Discount cannot exceed the subtotal.')
      }

      const taxableAmount = roundMoney(subtotal - safeDiscount)
      const taxAmount = roundMoney(taxableAmount * safeTaxRate / 100)
      const totalAmount = roundMoney(taxableAmount + taxAmount)
      const received = roundMoney(Number(amountReceived))

      if (received < totalAmount) {
        throw new Error(
          `Insufficient payment. The total is ₹${totalAmount.toFixed(2)}.`
        )
      }

      // Decrement stock only if the requested quantity is still available.
      for (const item of saleItems) {
        const stockUpdate = await Product.updateOne(
          {
            _id: item.product,
            isActive: true,
            stock: { $gte: item.quantity },
          },
          {
            $inc: { stock: -item.quantity },
          },
          { session }
        )

        if (stockUpdate.modifiedCount !== 1) {
          throw new Error(
            `Stock changed for "${item.productName}". Refresh the cart and try again.`
          )
        }
      }

      const sale = new Sale({
        invoiceNumber: makeInvoiceNumber(),
        items: saleItems,
        customerName: customerName.trim() || 'Walk-in Customer',
        customerPhone: customerPhone.trim(),
        subtotal,
        discount: safeDiscount,
        taxRate: safeTaxRate,
        taxAmount,
        totalAmount,
        paymentMethod,
        amountReceived: received,
        changeDue: roundMoney(received - totalAmount),
        paymentStatus: 'paid',
        notes: notes.trim(),
      })

      await sale.save({ session })
      createdSale = sale
    })

    return res.status(201).json({
      success: true,
      message: 'Sale completed successfully.',
      sale: createdSale,
    })
  } catch (error) {
    if (
      error.message?.includes('Insufficient stock') ||
      error.message?.includes('not found or is inactive') ||
      error.message?.includes('Discount cannot') ||
      error.message?.includes('Insufficient payment') ||
      error.message?.includes('Stock changed')
    ) {
      return sendError(res, 400, error.message)
    }

    console.error('Create sale error:', error)

    return sendError(
      res,
      500,
      'Unable to complete the sale. Please try again.'
    )
  } finally {
    await session.endSession()
  }
}

// GET /api/sales
export const getSales = async (req, res) => {
  try {
    const {
      search = '',
      paymentMethod = '',
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

    const filter = {}

    if (paymentMethod) {
      if (
        !['cash', 'upi', 'card', 'bank_transfer', 'other'].includes(
          paymentMethod
        )
      ) {
        return sendError(res, 400, 'Invalid payment method filter.')
      }

      filter.paymentMethod = paymentMethod
    }

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
        { invoiceNumber: regex },
        { customerName: regex },
        { customerPhone: regex },
      ]
    }

    const [sales, total, summary] = await Promise.all([
      Sale.find(filter)
        .sort({ createdAt: -1 })
        .skip((currentPage - 1) * pageSize)
        .limit(pageSize)
        .lean(),

      Sale.countDocuments(filter),

      Sale.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            totalSales: { $sum: '$totalAmount' },
            totalInvoices: { $sum: 1 },
          },
        },
      ]),
    ])

    return res.json({
      success: true,
      sales,
      pagination: {
        total,
        page: currentPage,
        limit: pageSize,
        pages: Math.ceil(total / pageSize),
      },
      summary: {
        totalSales: summary[0]?.totalSales || 0,
        totalInvoices: summary[0]?.totalInvoices || 0,
      },
    })
  } catch (error) {
    console.error('Get sales error:', error)
    return sendError(res, 500, 'Unable to fetch sales.')
  }
}

// GET /api/sales/:id
export const getSaleById = async (req, res) => {
  try {
    const { id } = req.params

    if (!mongoose.isValidObjectId(id)) {
      return sendError(res, 400, 'Invalid sale ID.')
    }

    const sale = await Sale.findById(id).lean()

    if (!sale) {
      return sendError(res, 404, 'Sale not found.')
    }

    return res.json({
      success: true,
      sale,
    })
  } catch (error) {
    console.error('Get sale error:', error)
    return sendError(res, 500, 'Unable to fetch sale.')
  }
}

// GET /api/sales/invoice/:invoiceNumber
export const getSaleByInvoice = async (req, res) => {
  try {
    const invoiceNumber = String(req.params.invoiceNumber || '').trim()

    if (!invoiceNumber) {
      return sendError(res, 400, 'Invoice number is required.')
    }

    const sale = await Sale.findOne({ invoiceNumber }).lean()

    if (!sale) {
      return sendError(res, 404, 'Invoice not found.')
    }

    return res.json({
      success: true,
      sale,
    })
  } catch (error) {
    console.error('Get sale by invoice error:', error)
    return sendError(res, 500, 'Unable to fetch invoice.')
  }
}
