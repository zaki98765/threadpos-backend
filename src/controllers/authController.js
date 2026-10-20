import jwt from 'jsonwebtoken'
import User from '../models/User.js'

const createToken = (user) =>
    jwt.sign(
        { id: user._id.toString() },
        process.env.JWT_SECRET,
        { expiresIn: '1d' }
    )

const getPublicUser = (user) => ({
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
})

export const register = async (req, res) => {
    try {
        const { name, email, password } = req.body

        if (!name?.trim() || !email?.trim() || !password) {
            return res.status(400).json({
                message: 'Name, email and password are required.',
            })
        }

        if (password.length < 8) {
            return res.status(400).json({
                message: 'Password must contain at least 8 characters.',
            })
        }

        const normalizedEmail = email.trim().toLowerCase()

        const existingUser = await User.findOne({
            email: normalizedEmail,
        })

        if (existingUser) {
            return res.status(409).json({
                message: 'An account with this email already exists.',
            })
        }

        // Public registration can NEVER create an admin account.
        // New accounts remain staff accounts; consider admin approval.
        const user = await User.create({
            name: name.trim(),
            email: normalizedEmail,
            password,
            role: 'staff',
        })

        return res.status(201).json({
            message: 'Account created successfully. Contact your administrator for access.',
            user: getPublicUser(user),
        })
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({
                message: 'An account with this email already exists.',
            })
        }

        console.error('Registration error:', error.message)

        return res.status(500).json({
            message: 'Unable to create account.',
        })
    }
}

export const login = async (req, res) => {
    try {
        const { email, password } = req.body

        if (!email?.trim() || !password) {
            return res.status(400).json({
                message: 'Email and password are required.',
            })
        }

        const user = await User.findOne({
            email: email.trim().toLowerCase(),
        }).select('+password')

        if (!user || !(await user.comparePassword(password))) {
            return res.status(401).json({
                message: 'Invalid email or password.',
            })
        }

        if (!user.isActive) {
            return res.status(403).json({
                message: 'Your account has been deactivated.',
            })
        }

        const token = createToken(user)

        // HttpOnly cookie: JavaScript cannot read the authentication token.


        res.cookie('threadpos_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 24 * 60 * 60 * 1000,
            path: '/',
        })


        return res.status(200).json({
            message: 'Login successful.',
            user: getPublicUser(user),
        })
    } catch (error) {
        console.error('Login error:', error.message)

        return res.status(500).json({
            message: 'Unable to log in.',
        })
    }
}


export const logout = (req, res) => {
    res.clearCookie('threadpos_token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        path: '/',
    })

    return res.status(200).json({
        message: 'Logged out successfully.',
    })
}
