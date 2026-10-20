
import 'dotenv/config'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import User from './models/User.js'

async function seedAdmin() {
  try {
    await mongoose.connect(process.env.MONGODB_URI)

    const email = 'admin123@gmail.com'
    const password = '12345678'
    const hashedPassword = await bcrypt.hash(password, 12)
    const now = new Date()

    await User.collection.updateOne(
      { email },
      {
        $set: {
          name: 'ThreadPOS Admin',
          email,
          password: hashedPassword,
          role: 'admin',
          isActive: true,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true }
    )

    console.log('Admin account created or updated.')
    console.log('Email: admin123@gmail.com')
    console.log('Password: 12345678')
  } catch (error) {
    console.error('Failed to create admin:', error.message)
    process.exitCode = 1
  } finally {
    await mongoose.disconnect()
  }
}

seedAdmin()
