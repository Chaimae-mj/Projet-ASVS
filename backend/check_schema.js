const pool = require('./db');

async function checkSchema() {
    try {
        const [rows] = await pool.execute("DESCRIBE users");
        console.log("SCHEMA:", JSON.stringify(rows));
        process.exit(0);
    } catch (err) {
        console.error("DB_ERROR:", err);
        process.exit(1);
    }
}

checkSchema();
