// core/session.js
const db = require('./database');
const env = require('../config/env');

const memorySessions = new Map();

function pruneExpiredSessions() {
    const now = Date.now();
    for (const [sessionId, record] of memorySessions.entries()) {
        if (record.expiresAt <= now) {
            memorySessions.delete(sessionId);
        }
    }
}

module.exports = {
    async get(sessionId) {
        if (!env.DB_ENABLED) {
            pruneExpiredSessions();
            const record = memorySessions.get(sessionId);
            return record ? record.data : null;
        }

        const [rows] = await db.query(
            'SELECT * FROM ticket_temp_data WHERE data_id = ? AND expires_at > NOW()',
            [sessionId]
        );
        return rows.length > 0 ? JSON.parse(rows[0].data_json) : null;
    },

    async set(sessionId, userId, data) {
        if (!env.DB_ENABLED) {
            memorySessions.set(sessionId, {
                userId,
                data,
                expiresAt: Date.now() + (60 * 60 * 1000)
            });
            return;
        }

        await db.query(
            `INSERT INTO ticket_temp_data (data_id, user_id, data_json, expires_at) 
             VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR)) 
             ON DUPLICATE KEY UPDATE data_json = ?, expires_at = DATE_ADD(NOW(), INTERVAL 1 HOUR)`,
            [sessionId, userId, JSON.stringify(data), JSON.stringify(data)]
        );
    },

    async delete(sessionId) {
        if (!env.DB_ENABLED) {
            memorySessions.delete(sessionId);
            return;
        }

        await db.query(
            'DELETE FROM ticket_temp_data WHERE data_id = ?',
            [sessionId]
        );
    }
};
