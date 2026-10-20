
import Category from '../models/Category.js'
import Product from '../models/Product.js'

export const getCategories = async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true })
      .sort({ name: 1 })

    res.status(200).json({
      success: true,
      categories,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch categories',
    })
  }
}

export const createCategory = async (req, res) => {
  try {
    const name = req.body.name?.trim()
    const description = req.body.description?.trim() || ''

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Category name is required',
      })
    }

    if (name.length > 60 || description.length > 300) {
      return res.status(400).json({
        success: false,
        message: 'Category name or description is too long',
      })
    }

    const normalizedName = name.toLowerCase()

    const existing = await Category.findOne({ normalizedName })

    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'This category already exists',
      })
    }

    const category = await Category.create({
      name,
      normalizedName,
      description,
    })

    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      category,
    })
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'This category already exists',
      })
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create category',
    })
  }
}

export const updateCategory = async (req, res) => {
  try {
    const { name, description } = req.body
    const updates = {}

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 60) {
        return res.status(400).json({
          success: false,
          message: 'Enter a valid category name',
        })
      }

      updates.name = name.trim()
      updates.normalizedName = name.trim().toLowerCase()
    }

    if (description !== undefined) {
      if (typeof description !== 'string' || description.length > 300) {
        return res.status(400).json({
          success: false,
          message: 'Description must be 300 characters or fewer',
        })
      }

      updates.description = description.trim()
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No category changes provided',
      })
    }

    const category = await Category.findOneAndUpdate(
      { _id: req.params.id, isActive: true },
      { $set: updates },
      { new: true, runValidators: true }
    )

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found',
      })
    }

    res.status(200).json({
      success: true,
      message: 'Category updated successfully',
      category,
    })
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'A category with this name already exists',
      })
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update category',
    })
  }
}

export const deleteCategory = async (req, res) => {
  try {
    const category = await Category.findOne({
      _id: req.params.id,
      isActive: true,
    })

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found',
      })
    }

    const usedByProducts = await Product.exists({
      category: { $regex: `^${category.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
      isActive: true,
    })

    if (usedByProducts) {
      return res.status(409).json({
        success: false,
        message: 'This category is used by products. Reassign those products before deleting it.',
      })
    }

    category.isActive = false
    await category.save()

    res.status(200).json({
      success: true,
      message: 'Category deleted successfully',
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete category',
    })
  }
}
