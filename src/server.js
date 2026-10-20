import express from 'express'
import dotenv from 'dotenv'
import cors from 'cors'
import helmet from 'helmet'
import connectDB from './config/db.js'
import authRoutes from "./routes/authRoutes.js"
import productRoutes from './routes/productRoutes.js'
import categoryRoutes from './routes/categoryRoutes.js'
import supplierRoutes from './routes/supplierRoutes.js'
import purchaseRoutes from './routes/purchaseRoutes.js'
import supplierPaymentRoutes from './routes/supplierPaymentRoutes.js'
import saleRoutes from './routes/saleRoutes.js'
import returnRoutes from './routes/returnRouter.js'
import staffRoutes from './routes/staffRoutes.js'
import reportRoutes from './routes/reportRoutes.js'
import transactionRoutes from './routes/transactionRoutes.js'
dotenv.config()

const app = express()

app.use(helmet())

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}))

app.use(express.json())

app.get('/', (req, res) => {
  res.status(200).json({
    message: 'ThreadPOS API is running!',
  })
})

const startServer = async () => {
  try {
    await connectDB()

    const PORT = process.env.PORT || 5000

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`)
    })
  } catch (error) {
    console.error('Server startup failed:', error.message)
    process.exit(1)
  }
}
app.use('/api/auth',authRoutes)
app.use('/api/products', productRoutes)
app.use('/api/categories', categoryRoutes)
app.use('/api/suppliers', supplierRoutes)
app.use('/api/purchases', purchaseRoutes)
app.use('/api/supplier-payments', supplierPaymentRoutes)
app.use('/api/sales', saleRoutes)
app.use('/api/returns', returnRoutes)
app.use('/api/staff', staffRoutes)
app.use('/api/reports', reportRoutes)
app.use('/api/transactions', transactionRoutes)
startServer()