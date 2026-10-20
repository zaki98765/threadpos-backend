import Product from '../models/Product.js'
export const getProducts = async (req, res) => {
  try {
    const {
      search = '',
      category = '',
      stockStatus = '',
      page = 1,
      limit = 20,
    } = req.query

    const filter = { isActive: true }

    if (search.trim()) {
      filter.$or = [
        { name: { $regex: search.trim(), $options: 'i' } },
        { sku: { $regex: search.trim(), $options: 'i' } },
        { category: { $regex: search.trim(), $options: 'i' } },
      ]
    }

    if (category.trim()) {
      filter.category = category.trim()
    }

    if (stockStatus === 'low') {
      filter.$expr = {
        $and: [
          { $gt: ['$stock', 0] },
          { $lte: ['$stock', '$lowStockThreshold'] },
        ],
      }
    } else if (stockStatus === 'out') {
      filter.stock = 0
    }

    const currentPage = Math.max(1, Number(page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(limit) || 20))

    const [products, total] = await Promise.all([
      Product.find(filter)
        .sort({ createdAt: -1 })
        .skip((currentPage - 1) * pageSize)
        .limit(pageSize),
      Product.countDocuments(filter),
    ])

    res.status(200).json({
      success: true,
      products,
      pagination: {
        total,
        page: currentPage,
        pages: Math.ceil(total / pageSize),
        limit: pageSize,
      },
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch products',
    })
  }
}

export const createProduct = async (req, res) => {
  try {
    const {
      name,
      sku,
      category,
      sellingPrice,
      costPrice,
      stock,
      lowStockThreshold,
      description,
      imageUrl,
    } = req.body

    if (
      !name?.trim() ||
      !sku?.trim() ||
      !category?.trim() ||
      sellingPrice === undefined ||
      sellingPrice === ''
    ) {
      return res.status(400).json({
        success: false,
        message: 'Name, SKU, category, and selling price are required',
      })
    }

    const price = Number(sellingPrice)
    const cost = Number(costPrice ?? 0)
    const quantity = Number(stock ?? 0)
    const threshold = Number(lowStockThreshold ?? 5)

    if (
      !Number.isFinite(price) ||
      !Number.isFinite(cost) ||
      !Number.isInteger(quantity) ||
      !Number.isInteger(threshold) ||
      price < 0 ||
      cost < 0 ||
      quantity < 0 ||
      threshold < 0
    ) {
      return res.status(400).json({
        success: false,
        message: 'Enter valid prices and non-negative whole-number quantities',
      })
    }

    const existingSku = await Product.findOne({
      sku: sku.trim().toUpperCase(),
    })

    if (existingSku) {
      return res.status(409).json({
        success: false,
        message: 'A product with this SKU already exists',
      })
    }

    const product = await Product.create({
      name,
      sku,
      category,
      sellingPrice: price,
      costPrice: cost,
      stock: quantity,
      lowStockThreshold: threshold,
      description,
      imageUrl,
    })

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      product,
    })
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'SKU already exists',
      })
    }

    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: error.message,
      })
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create product',
    })
  }
}

export const updateProduct = async (req, res) => {
  try {
    const allowedFields = [
      'name',
      'sku',
      'category',
      'sellingPrice',
      'costPrice',
      'stock',
      'lowStockThreshold',
      'description',
      'imageUrl',
    ]

    const updates = {}

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field]
      }
    }

    for (const field of [
      'sellingPrice',
      'costPrice',
      'stock',
      'lowStockThreshold',
    ]) {
      if (updates[field] !== undefined) {
        const value = Number(updates[field])

        if (
          updates[field] === '' ||
          !Number.isFinite(value) ||
          value < 0 ||
          (['stock', 'lowStockThreshold'].includes(field) &&
            !Number.isInteger(value))
        ) {
          return res.status(400).json({
            success: false,
            message: `Invalid value for ${field}`,
          })
        }

        updates[field] = value
      }
    }

    if (updates.sku !== undefined) {
      updates.sku = String(updates.sku).trim().toUpperCase()
    }

    if (updates.name !== undefined) {
      updates.name = String(updates.name).trim()
    }

    if (updates.category !== undefined) {
      updates.category = String(updates.category).trim()
    }

    if (
      ('name' in updates && !updates.name) ||
      ('sku' in updates && !updates.sku) ||
      ('category' in updates && !updates.category)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Name, SKU, and category cannot be empty',
      })
    }

    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, isActive: true },
      { $set: updates },
      { new: true, runValidators: true }
    )

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      })
    }

    res.status(200).json({
      success: true,
      message: 'Product updated successfully',
      product,
    })
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'SKU already exists',
      })
    }

    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: error.message,
      })
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update product',
    })
  }
}

export const deleteProduct = async (req, res) => {
  try {
    // Soft-delete to preserve historical billing records.
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, isActive: true },
      { $set: { isActive: false } },
      { new: true }
    )

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      })
    }

    res.status(200).json({
      success: true,
      message: 'Product removed from inventory',
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete product',
    })
  }
}
