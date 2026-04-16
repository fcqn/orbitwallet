const db = require('../core/database');
const rpc = require('../core/rpc');
const wallet = require('./wallet');

class DepositScanner {
    constructor() {
        this.interval = null;
    }

    async scan() {
        try {
            console.log('\n🔍 Starting deposit scan...');
            
            const utxos = await rpc.listUnspent();
            
            for (const utxo of utxos) {
                await this.processUtxo(utxo);
            }
            
            console.log(`✅ Scan complete. Processed ${utxos.length} UTXOs`);
        } catch (error) {
            console.error('❌ Scan error:', error);
        }
    }

    async processUtxo(utxo) {
        const { address, value, prevout_hash: txid } = utxo;

        // Check if already processed
        const [existing] = await db.query(
            'SELECT id FROM wallet_ledger WHERE txid = ? AND action_type = "DEPOSIT"',
            [txid]
        );
        
        if (existing.length > 0) {
            console.log(`⏭️ Already credited: ${txid}`);
            return;
        }

        // Find user
        const [users] = await db.query(
            'SELECT id, discord_id FROM users WHERE ltc_deposit_address = ?',
            [address]
        );

        if (users.length === 0) {
            console.log(`⚠️ No user for address ${address}`);
            return;
        }

        const user = users[0];
        console.log(`📥 New deposit: ${value} LTC for user ${user.discord_id}`);

        // Credit user
        await this.creditDeposit(user.id, value, txid, address);
    }

    async creditDeposit(userId, amount, txid, address) {
        try {
            await db.query('START TRANSACTION');

            await wallet.addFunds(userId, amount);

            await db.query(
                `INSERT INTO wallet_ledger 
                 (user_id, action_type, amount, txid, from_address, status, created_at) 
                 VALUES (?, 'DEPOSIT', ?, ?, ?, 'CONFIRMED', NOW())`,
                [userId, amount, txid, address]
            );

            await db.query('COMMIT');
            console.log(`✅ Credited ${amount} LTC to user ${userId}`);
        } catch (err) {
            await db.query('ROLLBACK');
            console.error('Credit failed:', err);
            throw err;
        }
    }

    start(intervalMs = 60000) {
        console.log(`🛰️ Scanner started (${intervalMs}ms interval)`);
        this.scan(); // First scan
        this.interval = setInterval(() => this.scan(), intervalMs);
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }
}

module.exports = new DepositScanner();