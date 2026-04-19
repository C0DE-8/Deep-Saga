const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
require('dotenv').config();

const router = express.Router();

// /api/auth/register
router.post('/register', async (req, res) => {
    const { email, username, password } = req.body;

    // Basic validation to ensure no empty fields
    if (!email || !username || !password) {
        return res.status(400).json({ error: "Please provide email, username, and password." });
    }

    try {
        // Hash the password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Insert only into the users table
        const [result] = await db.execute(
            'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
            [email, username, hashedPassword]
        );

        res.status(201).json({ 
            message: "User registered successfully.",
            userId: result.insertId 
        });
    } catch (err) {
        // Handle duplicate email or username
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: "Email or Username already exists." });
        }
        res.status(500).json({ error: "Server error during registration." });
    }
});

// /api/auth/login
router.post('/login', async (req, res) => {
    const { identifier, password } = req.body; // identifier can be email OR username

    if (!identifier || !password) {
        return res.status(400).json({ error: "Please provide credentials." });
    }
    
    try {
        // Find user by email or username
        const [rows] = await db.execute(
            'SELECT * FROM users WHERE email = ? OR username = ?', 
            [identifier, identifier]
        );
        
        if (rows.length === 0) {
            return res.status(400).json({ error: "Invalid email/username or password." });
        }
        
        const user = rows[0];

        // Compare password with hashed version in DB
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(400).json({ error: "Invalid email/username or password." });
        }

        // Generate JWT
        const token = jwt.sign(
            { userId: user.id, username: user.username }, 
            process.env.JWT_SECRET, 
            { expiresIn: '24h' }
        );

        // Send token and basic user info (exclude password_hash)
        res.json({ 
            message: "Login successful.", 
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email
            }
        });
    } catch (err) {
        res.status(500).json({ error: "Server error during login." });
    }
});

module.exports = router;