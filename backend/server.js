const express = require('express');
const path = require('path');
require('dotenv').config();
const cors = require('cors');
const morgan = require('morgan'); 

const authRoutes = require('./routes/authRoutes');

const app = express();

// ✅ MIDDLEWARE ORDER MATTERS
app.use(morgan('dev'));
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth', authRoutes);


const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
    console.log(`[SYSTEM ONLINE] The Infinite Soul Loop backend is active on port http://localhost:${PORT}`);
});