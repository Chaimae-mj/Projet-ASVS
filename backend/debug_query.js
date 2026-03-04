const pool = require('./db');

async function debugQuery() {
    try {
        console.log("Attempting query: SELECT id, name, email, role, created_at FROM users");
        const [rows] = await pool.execute("SELECT id, name, email, role, created_at FROM users");
        console.log("SUCCESS:", rows.length, "users found.");
        process.exit(0);
    } catch (err) {
        console.error("QUERY_FAILED:", err.message);
        try {
            const [columns] = await pool.execute("SHOW COLUMNS FROM users");
            console.log("COLUMNS_EXISTING:", JSON.stringify(columns.map(c => c.Field)));
        } catch (e) {
            console.error("COLUMNS_CHECK_FAILED:", e.message);
        }
        process.exit(1);
    }
}

debugQuery();
