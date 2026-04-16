const mysql = require('mysql2/promise');
const env = require('../config/env');

function databaseDisabledError() {
    const error = new Error('Database is disabled. Set DB_ENABLED=true to enable MySQL features.');
    error.code = 'DB_DISABLED';
    return error;
}

if (!env.DB_ENABLED) {
    console.log('Database disabled: running in test mode without MySQL');

    const disabledDb = {
        isEnabled: false,
        async query() {
            throw databaseDisabledError();
        },
        async execute() {
            throw databaseDisabledError();
        },
        async getConnection() {
            throw databaseDisabledError();
        },
        async end() {
            return undefined;
        }
    };

    module.exports = disabledDb;
    return;
}

const pool = mysql.createPool({
    host: env.DB_HOST,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});
pool.isEnabled = true;

// Test connection
pool.getConnection()
    .then(conn => {
        console.log('✅ MySQL Database Connected');
        conn.release();
    })
    .catch(err => {
        console.error('❌ Database connection failed:', err.message);
    });

module.exports = pool;
