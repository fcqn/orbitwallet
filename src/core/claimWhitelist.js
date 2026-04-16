const db = require('./database');

async function isWhitelistedByUserId(userId) {
    if (!userId) return false;
    const [rows] = await db.query(
        'SELECT 1 AS ok FROM claim_whitelist WHERE user_id = ? LIMIT 1',
        [userId]
    );
    return rows.length > 0;
}

async function getWhitelistEntryByDiscordId(discordId) {
    const [rows] = await db.query(
        `SELECT cw.user_id, u.discord_id, u.username, cw.added_by, cw.created_at
         FROM claim_whitelist cw
         JOIN users u ON u.id = cw.user_id
         WHERE u.discord_id = ?
         LIMIT 1`,
        [discordId]
    );
    return rows[0] || null;
}

async function addWhitelistByDiscordId(discordId, addedBy) {
    const [users] = await db.query(
        'SELECT id, discord_id, username FROM users WHERE discord_id = ? LIMIT 1',
        [discordId]
    );
    if (!users.length) {
        throw new Error('That user does not have a registered profile yet.');
    }

    const user = users[0];
    await db.query(
        'INSERT IGNORE INTO claim_whitelist (user_id, added_by) VALUES (?, ?)',
        [user.id, addedBy]
    );

    return user;
}

async function removeWhitelistByDiscordId(discordId) {
    const [users] = await db.query(
        'SELECT id, discord_id, username FROM users WHERE discord_id = ? LIMIT 1',
        [discordId]
    );
    if (!users.length) {
        return { deleted: 0, user: null };
    }

    const user = users[0];
    const [result] = await db.query(
        'DELETE FROM claim_whitelist WHERE user_id = ?',
        [user.id]
    );

    return { deleted: Number(result.affectedRows || 0), user };
}

async function listWhitelistEntries() {
    const [rows] = await db.query(
        `SELECT u.id, u.discord_id, u.username, cw.added_by, cw.created_at
         FROM claim_whitelist cw
         JOIN users u ON u.id = cw.user_id
         ORDER BY cw.created_at DESC`
    );
    return rows;
}

module.exports = {
    isWhitelistedByUserId,
    getWhitelistEntryByDiscordId,
    addWhitelistByDiscordId,
    removeWhitelistByDiscordId,
    listWhitelistEntries
};
