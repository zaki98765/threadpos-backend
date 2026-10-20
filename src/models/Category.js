
import mongoose from 'mongoose'

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Category name is required'],
      trim: true,
      maxlength: 60,
    },
    normalizedName: {
      type: String,
      required: true,
      unique: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 300,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
)

categorySchema.pre('validate', function () {
  if (this.name) {
    this.normalizedName = this.name.trim().toLowerCase()
  }
})

const Category = mongoose.model('Category', categorySchema)

export default Category
