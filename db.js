require('dotenv').config();
const { Pool } = require('pg');
const ssl = /supabase|render|neon/.test(process.env.DATABASE_URL || '') ? { rejectUnauthorized: false } : undefined;
module.exports = new Pool({ connectionString: process.env.DATABASE_URL, max: 10, ssl });
