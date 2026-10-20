
import Sale from '../models/Sale.js'
import Return from '../models/Return.js'
import Product from '../models/Product.js'
import Purchase from '../models/Purchase.js'

const roundMoney = (value) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100

const parseDateRange = (startDate, endDate) => {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/

  if (
    typeof startDate !== 'string' ||
    typeof endDate !== 'string' ||
    !datePattern.test(startDate) ||
    !datePattern.test(endDate)
  ) {
    return null
  }

  const start = new Date(`${startDate}T00:00:00.000Z`)
  const end = new Date(`${endDate}T00:00:00.000Z`)

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start.toISOString().slice(0, 10) !== startDate ||
    end.toISOString().slice(0, 10) !== endDate ||
    start > end
  ) {
    return null
  }

  // Date-only inputs are interpreted as calendar dates in India.
  const startUtc = new Date(`${startDate}T00:00:00.000Z`)
  const endExclusiveUtc = new Date(
    new Date(`${endDate}T00:00:00.000Z`).getTime() +
      24 * 60 * 60 * 1000
  )

  return {
    $gte: new Date(startUtc.getTime() - 330 * 60 * 1000),
    $lt: new Date(endExclusiveUtc.getTime() - 330 * 60 * 1000),
  }
}

// GET /api/reports/overview?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
export const getReportOverview = async (req, res) => {
  try {
    const { startDate, endDate } = req.query

    const dateRange = parseDateRange(startDate, endDate)

    if (!dateRange) {
      return res.status(400).json({
        success: false,
        message: 'Provide valid startDate and endDate in YYYY-MM-DD format. The start date must not be after the end date.',
      })
    }

    const saleFilter = {
      createdAt: dateRange,
      paymentStatus: 'paid',
    }

    const returnFilter = {
      createdAt: dateRange,
      status: 'completed',
    }

    const purchaseFilter = {
      createdAt: dateRange,
      purchaseStatus: 'received',
    }

    const [
      salesSummaryRows,
      dailySales,
      paymentBreakdown,
      topProducts,
      returnsSummaryRows,
      inventorySummaryRows,
      lowStockProducts,
      purchaseSummaryRows,
      recentSales,
    ] = await Promise.all([
      Sale.aggregate([
        { $match: saleFilter },
        {
          $project: {
            totalAmount: 1,
            subtotal: 1,
            discount: 1,
            taxAmount: 1,
            itemCost: {
              $sum: {
                $map: {
                  input: { $ifNull: ['$items', []] },
                  as: 'item',
                  in: {
                    $multiply: [
                      { $ifNull: ['$$item.costPrice', 0] },
                      { $ifNull: ['$$item.quantity', 0] },
                    ],
                  },
                },
              },
            },
          },
        },
        {
          $group: {
            _id: null,
            totalSales: { $sum: '$totalAmount' },
            subtotal: { $sum: '$subtotal' },
            discounts: { $sum: '$discount' },
            taxes: { $sum: '$taxAmount' },
            costOfGoods: { $sum: '$itemCost' },
            transactions: { $sum: 1 },
          },
        },
      ]),

      Sale.aggregate([
        { $match: saleFilter },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$createdAt',
                timezone: 'Asia/Kolkata',
              },
            },
            sales: { $sum: '$totalAmount' },
            transactions: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        {
          $project: {
            _id: 0,
            date: '$_id',
            sales: 1,
            transactions: 1,
          },
        },
      ]),

      Sale.aggregate([
        { $match: saleFilter },
        {
          $group: {
            _id: '$paymentMethod',
            amount: { $sum: '$totalAmount' },
            count: { $sum: 1 },
          },
        },
        { $sort: { amount: -1 } },
      ]),

      Sale.aggregate([
        { $match: saleFilter },
        { $unwind: '$items' },
        {
          $group: {
            _id: {
              product: '$items.product',
              name: '$items.productName',
              sku: '$items.sku',
            },
            quantitySold: { $sum: '$items.quantity' },
            revenue: { $sum: '$items.lineTotal' },
            cost: {
              $sum: {
                $multiply: [
                  { $ifNull: ['$items.costPrice', 0] },
                  { $ifNull: ['$items.quantity', 0] },
                ],
              },
            },
          },
        },
        { $sort: { quantitySold: -1, revenue: -1 } },
        { $limit: 10 },
        {
          $project: {
            _id: 0,
            productId: '$_id.product',
            name: '$_id.name',
            sku: '$_id.sku',
            quantitySold: 1,
            revenue: 1,
            estimatedGrossProfitBeforeDiscount: {
              $subtract: ['$revenue', '$cost'],
            },
          },
        },
      ]),

      Return.aggregate([
        { $match: returnFilter },
        {
          $group: {
            _id: null,
            totalRefunds: { $sum: '$totalRefund' },
            returnCount: { $sum: 1 },
          },
        },
      ]),

      Product.aggregate([
        {
          $group: {
            _id: null,
            totalProducts: { $sum: 1 },
            activeProducts: {
              $sum: { $cond: ['$isActive', 1, 0] },
            },
            stockUnits: { $sum: '$stock' },
            inventoryCostValue: {
              $sum: {
                $multiply: ['$stock', '$costPrice'],
              },
            },
            inventoryRetailValue: {
              $sum: {
                $multiply: ['$stock', '$sellingPrice'],
              },
            },
          },
        },
      ]),

      Product.find({
        isActive: true,
        $expr: { $lte: ['$stock', '$lowStockThreshold'] },
      })
        .select('name sku stock lowStockThreshold costPrice sellingPrice')
        .sort({ stock: 1, name: 1 })
        .limit(10)
        .lean(),

      Purchase.aggregate([
        { $match: purchaseFilter },
        {
          $group: {
            _id: null,
            receivedPurchaseValue: { $sum: '$totalAmount' },
            receivedPurchaseCount: { $sum: 1 },
          },
        },
      ]),

      Sale.find(saleFilter)
        .select('invoiceNumber customerName totalAmount paymentMethod createdAt')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
    ])

    const sales = salesSummaryRows[0] || {}
    const returns = returnsSummaryRows[0] || {}
    const inventory = inventorySummaryRows[0] || {}
    const purchases = purchaseSummaryRows[0] || {}

    const totalSales = roundMoney(sales.totalSales)
    const totalRefunds = roundMoney(returns.totalRefunds)
    const netSales = roundMoney(totalSales - totalRefunds)
    const costOfGoods = roundMoney(sales.costOfGoods)
    const discounts = roundMoney(sales.discounts)

    // Excludes tax and does not allocate returns to historical product cost.
    // Use this as an estimate, not a final accounting profit figure.
    const estimatedGrossProfitBeforeRefunds = roundMoney(
      Number(sales.subtotal || 0) -
        discounts -
        costOfGoods
    )

    return res.status(200).json({
      success: true,
      period: { startDate, endDate },
      summary: {
        totalSales,
        transactions: sales.transactions || 0,
        averageBillValue: sales.transactions
          ? roundMoney(totalSales / sales.transactions)
          : 0,
        subtotal: roundMoney(sales.subtotal),
        discounts,
        taxes: roundMoney(sales.taxes),
        totalRefunds,
        returnCount: returns.returnCount || 0,
        netSales,
        costOfGoods,
        estimatedGrossProfitBeforeRefunds,
      },
      dailySales: dailySales.map((item) => ({
        ...item,
        sales: roundMoney(item.sales),
      })),
      paymentBreakdown: paymentBreakdown.map((item) => ({
        method: item._id || 'other',
        amount: roundMoney(item.amount),
        count: item.count,
      })),
      topProducts: topProducts.map((item) => ({
        ...item,
        revenue: roundMoney(item.revenue),
        estimatedGrossProfitBeforeDiscount: roundMoney(
          item.estimatedGrossProfitBeforeDiscount
        ),
      })),
      inventory: {
        totalProducts: inventory.totalProducts || 0,
        activeProducts: inventory.activeProducts || 0,
        stockUnits: inventory.stockUnits || 0,
        inventoryCostValue: roundMoney(inventory.inventoryCostValue),
        inventoryRetailValue: roundMoney(inventory.inventoryRetailValue),
      },
      lowStockProducts,
      purchases: {
        receivedPurchaseValue: roundMoney(purchases.receivedPurchaseValue),
        receivedPurchaseCount: purchases.receivedPurchaseCount || 0,
      },
      recentSales,
    })
  } catch (error) {
    console.error('Reports overview error:', error)
    return res.status(500).json({
      success: false,
      message: 'Unable to generate reports.',
    })
  }
}
