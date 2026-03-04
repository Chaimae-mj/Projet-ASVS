const pool = require('./db');

async function checkUsers() {
    try {
        const [rows] = await pool.execute("SELECT id, name, email, role FROM users");
        console.log("USERS_COUNT:", rows.length);
        console.log("USERS_DATA:", JSON.stringify(rows));
        process.exit(0);
    } catch (err) {
        console.error("DB_ERROR:", err);
        process.exit(1);
    }
}

checkUsers();
