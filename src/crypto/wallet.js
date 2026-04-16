const db = require('../core/database');
const rpc = require('../core/rpc');

class WalletManager {
    async createWallet(discordId, username) {
        // Check if exists
        const [existing] = await db.query(
            'SELECT ltc_deposit_address FROM users WHERE discord_id = ?',
            [discordId]
        );
        
        if (existing.length > 0) {
            return { exists: true, address: existing[0].ltc_deposit_address };
        }

        // Create new address
        const address = await rpc.createNewAddress();
        if (!address) throw new Error('Failed to create address');

        // Save to DB
        await db.query(
            'INSERT INTO users (discord_id, username, ltc_deposit_address) VALUES (?, ?, ?)',
            [discordId, username, address]
        );

        return { exists: false, address };
    }

    async getBalance(discordId) {
        const [rows] = await db.query(
            'SELECT balance_available, balance_escrow, total_deposited, total_withdrawn FROM users WHERE discord_id = ?',
            [discordId]
        );
        
        if (rows.length === 0) return null;
        
        const user = rows[0];
        return {
            available: parseFloat(user.balance_available),
            escrow: parseFloat(user.balance_escrow),
            total: parseFloat(user.balance_available) + parseFloat(user.balance_escrow),
            deposited: parseFloat(user.total_deposited),
            withdrawn: parseFloat(user.total_withdrawn)
        };
    }

    async lockFunds(userId, amount) {
        await db.query('START TRANSACTION');
        await db.query(
            'UPDATE users SET balance_available = balance_available - ?, balance_escrow = balance_escrow + ? WHERE id = ?',
            [amount, amount, userId]
        );
        await db.query('COMMIT');
    }

    async releaseFunds(userId, amount) {
        await db.query('START TRANSACTION');
        await db.query(
            'UPDATE users SET balance_escrow = balance_escrow - ? WHERE id = ?',
            [amount, userId]
        );
        await db.query('COMMIT');
    }

    async addFunds(userId, amount) {
        await db.query(
            `UPDATE users 
             SET balance_available = balance_available + ?,
                 total_deposited = total_deposited + ?,
                 updated_at = NOW()
             WHERE id = ?`,
            [amount, amount, userId]
        );
    }

    async deductFunds(userId, amount) {
        await db.query(
            `UPDATE users 
             SET balance_available = balance_available - ?,
                 total_withdrawn = total_withdrawn + ?,
                 updated_at = NOW()
             WHERE id = ?`,
            [amount, amount, userId]
        );
    }
}

module.exports = new WalletManager();