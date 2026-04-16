const db = require('../core/database');
const rpc = require('../core/rpc');
const wallet = require('./wallet');

class TransactionManager {
    async withdraw(userId, targetAddress, amount, fee = 0.0001) {
        const total = amount + fee;

        // Check balance
        const balance = await wallet.getBalance(userId);
        if (balance.available < total) {
            throw new Error('Insufficient funds');
        }

        // Send via RPC
        const txid = await rpc.sendLTC(targetAddress, amount);

        // Update DB
        await db.query('START TRANSACTION');
        await wallet.deductFunds(userId, total);
        await db.query(
            `INSERT INTO wallet_ledger 
             (user_id, action_type, amount, fee_amount, txid, to_address, status, created_at) 
             VALUES (?, 'WITHDRAWAL', ?, ?, ?, ?, 'CONFIRMED', NOW())`,
            [userId, amount, fee, txid, targetAddress]
        );
        await db.query('COMMIT');

        return { txid, amount, fee };
    }

    async releaseToBuyer(ticketId, sellerId, buyerAddress, amount, fee) {
        // Send LTC
        const txid = await rpc.sendLTC(buyerAddress, amount);

        // Update seller's escrow
        await wallet.releaseFunds(sellerId, amount + fee);

        // Log
        await db.query(
            `INSERT INTO wallet_ledger 
             (user_id, action_type, amount, fee_amount, txid, to_address, status, created_at) 
             VALUES (?, 'PAYOUT', ?, ?, ?, ?, 'CONFIRMED', NOW())`,
            [sellerId, amount, fee, txid, buyerAddress]
        );

        return txid;
    }
}

module.exports = new TransactionManager();