
import Sale from '../models/Sale.js'
import Purchase from '../models/Purchase.js'
import SupplierPayment from '../models/SupplierPayment.js'
import Return from '../models/Return.js'

const roundMoney = (value) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100

const escapeRegex = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const validDate = (value) => {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const getDateRange = (startDate, endDate) => {
  const start = validDate(startDate)
  const end = validDate(endDate)

  if (startDate && !start) {
    const error = new Error('Invalid start date')
    error.statusCode = 400
    throw error
  }

  if (endDate && !end) {
    const error = new Error('Invalid end date')
    error.statusCode = 400
    throw error
  }

  if (start && end && start > end) {
    const error = new Error('Start date cannot be after end date')
    error.statusCode = 400
    throw error
  }

  // Date-only inputs include the entire selected end date.
  if (endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    end.setUTCHours(23, 59, 59, 999)
  }

  return { start, end }
}

const inDateRange = (dateValue, start, end) => {
  const date = new Date(dateValue)
  if (Number.isNaN(date.getTime())) return false
  if (start && date < start) return false
  if (end && date > end) return false
  return true
}

const money = (value) => roundMoney(value)

const normalizeTransactions = ({
  sales,
  purchases,
  supplierPayments,
  returns,
}) => {
  const saleEntries = sales.map((sale) => ({
    id: `sale-${sale._id}`,
    sourceId: String(sale._id),
    type: 'sale',
    reference: sale.invoiceNumber,
    date: sale.createdAt,
    description: `Sale to ${sale.customerName || 'Walk-in Customer'}`,
    party: sale.customerName || 'Walk-in Customer',
    method: sale.paymentMethod,
    status: sale.paymentStatus || 'paid',
    amount: money(sale.totalAmount),
    direction: 'in',
    notes: sale.notes || '',
    details: {
      customerPhone: sale.customerPhone || '',
      subtotal: money(sale.subtotal),
      discount: money(sale.discount),
      taxAmount: money(sale.taxAmount),
      totalAmount: money(sale.totalAmount),
      amountReceived: money(sale.amountReceived),
      changeDue: money(sale.changeDue),
      items: (sale.items || []).map((item) => ({
        name: item.productName,
        sku: item.sku,
        quantity: item.quantity,
        unitPrice: money(item.unitPrice),
        total: money(item.lineTotal),
      })),
    },
  }))

  const purchaseEntries = purchases.map((purchase) => ({
    id: `purchase-${purchase._id}`,
    sourceId: String(purchase._id),
    type: 'purchase',
    reference: purchase.purchaseNumber,
    date: purchase.receivedAt || purchase.createdAt,
    description: `Purchase from ${purchase.supplierName}`,
    party: purchase.supplierName,
    method: purchase.paymentStatus === 'paid' ? 'paid purchase' : 'credit',
    status: purchase.purchaseStatus,
    amount: money(purchase.totalAmount),
    direction: 'out',
    notes: purchase.notes || '',
    details: {
      subtotal: money(purchase.subtotal),
      discount: money(purchase.discount),
      totalAmount: money(purchase.totalAmount),
      paymentStatus: purchase.paymentStatus,
      purchaseStatus: purchase.purchaseStatus,
      items: (purchase.items || []).map((item) => ({
        name: item.productName,
        sku: item.sku || '',
        quantity: item.quantity,
        unitPrice: money(item.unitCost),
        total: money(item.lineTotal),
      })),
    },
  }))

  const paymentEntries = supplierPayments.map((payment) => ({
    id: `supplier-payment-${payment._id}`,
    sourceId: String(payment._id),
    type: 'supplier_payment',
    reference:
      payment.referenceNumber ||
      `PAY-${String(payment._id).slice(-8).toUpperCase()}`,
    date: payment.paymentDate || payment.createdAt,
    description: `Payment to ${payment.supplier?.name || 'Supplier'}`,
    party: payment.supplier?.name || 'Supplier',
    method: payment.paymentMethod,
    status: 'completed',
    amount: money(payment.amount),
    direction: 'out',
    notes: payment.notes || '',
    details: {
      supplierName: payment.supplier?.name || 'Supplier',
      purchaseNumber: payment.purchase?.purchaseNumber || '',
      purchaseTotal: money(payment.purchase?.totalAmount),
      referenceNumber: payment.referenceNumber || '',
      amount: money(payment.amount),
    },
  }))

  const returnEntries = returns.map((item) => ({
    id: `return-${item._id}`,
    sourceId: String(item._id),
    type: 'return',
    reference: item.returnNumber,
    date: item.createdAt,
    description: `Refund for invoice ${item.invoiceNumber}`,
    party: item.invoiceNumber,
    method: item.refundMethod,
    status: item.status,
    amount: money(item.totalRefund),
    direction: 'out',
    notes: item.notes || '',
    details: {
      invoiceNumber: item.invoiceNumber,
      refundMethod: item.refundMethod,
      totalRefund: money(item.totalRefund),
      items: (item.items || []).map((returnItem) => ({
        name: returnItem.productName,
        sku: returnItem.sku,
        quantity: returnItem.quantity,
        unitPrice: money(returnItem.unitPrice),
        total: money(returnItem.refundAmount),
        reason: returnItem.reason || '',
        restock: Boolean(returnItem.restock),
      })),
    },
  }))

  return [
    ...saleEntries,
    ...purchaseEntries,
    ...paymentEntries,
    ...returnEntries,
  ]
}

export const getTransactions = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      type = 'all',
      search = '',
      page = '1',
      limit = '20',
    } = req.query

    const allowedTypes = [
      'all',
      'sale',
      'purchase',
      'supplier_payment',
      'return',
    ]

    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid transaction type',
      })
    }

    const { start, end } = getDateRange(startDate, endDate)
    const pageNumber = Math.max(1, Number.parseInt(page, 10) || 1)
    const pageSize = Math.min(
      100,
      Math.max(1, Number.parseInt(limit, 10) || 20)
    )

    const [sales, purchases, supplierPayments, returns] =
      await Promise.all([
        Sale.find().sort({ createdAt: -1 }).lean(),
        Purchase.find().sort({ createdAt: -1 }).lean(),
        SupplierPayment.find()
          .populate('supplier', 'name')
          .populate('purchase', 'purchaseNumber totalAmount')
          .sort({ paymentDate: -1 })
          .lean(),
        Return.find({ status: 'completed' })
          .sort({ createdAt: -1 })
          .lean(),
      ])

    let transactions = normalizeTransactions({
      sales,
      purchases,
      supplierPayments,
      returns,
    })

    transactions = transactions.filter((transaction) =>
      inDateRange(transaction.date, start, end)
    )

    if (type !== 'all') {
      transactions = transactions.filter(
        (transaction) => transaction.type === type
      )
    }

    const searchText = String(search).trim().slice(0, 100)

    if (searchText) {
      const regex = new RegExp(escapeRegex(searchText), 'i')

      transactions = transactions.filter((transaction) =>
        [
          transaction.reference,
          transaction.description,
          transaction.party,
          transaction.method,
          transaction.status,
          transaction.notes,
        ].some((value) => regex.test(String(value || '')))
      )
    }

    transactions.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    )

    const summary = transactions.reduce(
      (result, transaction) => {
        result.count += 1

        if (transaction.type === 'sale') {
          result.sales = money(result.sales + transaction.amount)
        } else if (transaction.type === 'purchase') {
          result.purchases = money(result.purchases + transaction.amount)
        } else if (transaction.type === 'supplier_payment') {
          result.supplierPayments = money(
            result.supplierPayments + transaction.amount
          )
        } else if (transaction.type === 'return') {
          result.refunds = money(result.refunds + transaction.amount)
        }

        return result
      },
      {
        count: 0,
        sales: 0,
        purchases: 0,
        supplierPayments: 0,
        refunds: 0,
      }
    )

    summary.netSales = money(summary.sales - summary.refunds)

    const total = transactions.length
    const pages = Math.ceil(total / pageSize)
    const startIndex = (pageNumber - 1) * pageSize
    const paginatedTransactions = transactions.slice(
      startIndex,
      startIndex + pageSize
    )

    return res.status(200).json({
      success: true,
      transactions: paginatedTransactions,
      summary,
      pagination: {
        total,
        page: pageNumber,
        limit: pageSize,
        pages,
      },
    })
  } catch (error) {
    console.error('Get transactions error:', error)

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to fetch transactions',
    })
  }
}
