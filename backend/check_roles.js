const pool = require('./db');
const jwt = require('jsonwebtoken');
require('dotenv').config();

async function checkRoles() {
    try {
        const [rows] = await pool.execute("SELECT id, name, email, role FROM users");
        console.log("USERS_ROLES:", JSON.stringify(rows));
        process.exit(0);
    } catch (err) {
        console.error("DB_ERROR:", err);
        process.exit(1);
    }
}

checkRoles();
