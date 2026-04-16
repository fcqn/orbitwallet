const fs = require('fs');
const path = require('path');
const db = require('./database');

function isIgnorableAlterError(error) {
    const message = String(error?.message || '').toLowerCase();
    return (
        message.includes('duplicate') ||
        message.includes('already exists') ||
        message.includes("can't drop") ||
        message.includes('check that column/key exists')
    );
}

function parseSqlStatements(sqlContent) {
    return sqlContent
        .replace(/\r\n/g, '\n')
        .split(/;\s*\n/g)
        .map((statement) => statement.trim())
        .filter(Boolean)
        .filter((statement) => {
            const normalized = statement
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line && !line.startsWith('--'))
                .join('\n')
                .toUpperCase();

            if (!normalized) {
                return false;
            }

            return !normalized.startsWith('CREATE DATABASE') && !normalized.startsWith('USE ');
        });
}

async function ensureBaseSchema() {
    const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
    const schemaSql = await fs.promises.readFile(schemaPath, 'utf8');
    const statements = parseSqlStatements(schemaSql);

    for (const statement of statements) {
        try {
            await db.query(statement);
        } catch (error) {
            if (!isIgnorableAlterError(error)) {
                throw error;
            }
        }
    }
}

async function runMigrations() {
    await ensureBaseSchema();

    try {
        await db.query('ALTER TABLE users ADD COLUMN exchanger_terms TEXT NULL AFTER username');
    } catch (error) {
        if (!isIgnorableAlterError(error)) {
            throw error;
        }
    }

    try {
        await db.query('ALTER TABLE users ADD COLUMN last_withdrawn_at TIMESTAMP NULL AFTER total_withdrawn');
    } catch (error) {
        if (!isIgnorableAlterError(error)) {
            throw error;
        }
    }

    await db.query(
        `CREATE TABLE IF NOT EXISTS exchanger_payment_terms (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            method_key VARCHAR(50) NOT NULL,
            terms_text TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_user_method_terms (user_id, method_key),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )`
    );

    try {
        await db.query('DROP TABLE IF EXISTS exchanger_payment_methods');
    } catch (error) {
        if (!isIgnorableAlterError(error)) {
            throw error;
        }
    }

    await db.query(
        `CREATE TABLE IF NOT EXISTS exchanger_owner_balances (
            user_id INT NOT NULL,
            currency_code VARCHAR(16) NOT NULL,
            hidden_owner_balance DECIMAL(20, 8) NOT NULL DEFAULT 0.00000000,
            last_withdrawn_at TIMESTAMP NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, currency_code),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )`
    );

    await db.query(
        `CREATE TABLE IF NOT EXISTS owner_commission_ledger (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            ticket_id VARCHAR(20) NOT NULL,
            currency_code VARCHAR(16) NOT NULL,
            service_fee_amount DECIMAL(20, 8) NOT NULL,
            owner_commission_amount DECIMAL(20, 8) NOT NULL,
            exchanger_profit_amount DECIMAL(20, 8) NOT NULL,
            status ENUM('PENDING', 'TRANSFERRED') DEFAULT 'PENDING',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            transferred_at TIMESTAMP NULL,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (ticket_id) REFERENCES tickets(ticket_id),
            UNIQUE KEY uniq_ticket_commission (ticket_id)
        )`
    );

    await db.query(
        `CREATE TABLE IF NOT EXISTS exchanger_stats (
            user_id INT PRIMARY KEY,
            total_deals INT DEFAULT 0,
            completed_deals INT DEFAULT 0,
            disputed_deals INT DEFAULT 0,
            total_volume_ltc DECIMAL(20, 8) DEFAULT 0.00000000,
            total_volume_eur DECIMAL(20, 8) DEFAULT 0.00000000,
            last_active TIMESTAMP NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )`
    );

    // Backward-compatible add for release routing by receive side
    try {
        await db.query('ALTER TABLE tickets ADD COLUMN receive_method VARCHAR(100) NULL');
    } catch (error) {
        if (!isIgnorableAlterError(error)) {
            throw error;
        }
    }

    const ticketColumnAdds = [
        'ALTER TABLE tickets ADD COLUMN amount_from DECIMAL(20, 8) NULL AFTER seller_id',
        'ALTER TABLE tickets ADD COLUMN amount_to DECIMAL(20, 8) NULL AFTER amount_from',
        'ALTER TABLE tickets ADD COLUMN source_currency VARCHAR(16) NULL AFTER amount_to',
        'ALTER TABLE tickets ADD COLUMN service_fee_amount DECIMAL(20, 8) NULL AFTER total_ltc',
        'ALTER TABLE tickets ADD COLUMN service_fee_currency VARCHAR(16) NULL AFTER service_fee_amount',
        'ALTER TABLE tickets ADD COLUMN collateral_required BOOLEAN NOT NULL DEFAULT TRUE AFTER service_fee_currency',
        'ALTER TABLE tickets ADD COLUMN collateral_locked BOOLEAN NOT NULL DEFAULT FALSE AFTER collateral_required',
        'ALTER TABLE tickets ADD COLUMN owner_commission_amount DECIMAL(20, 8) NULL AFTER service_fee_currency',
        'ALTER TABLE tickets ADD COLUMN exchanger_profit_amount DECIMAL(20, 8) NULL AFTER owner_commission_amount',
        'ALTER TABLE tickets ADD COLUMN fee_processed_at TIMESTAMP NULL AFTER exchanger_profit_amount'
    ];

    for (const statement of ticketColumnAdds) {
        try {
            await db.query(statement);
        } catch (error) {
            if (!isIgnorableAlterError(error)) {
                throw error;
            }
        }
    }

    try {
        await db.query(
            `UPDATE tickets
             SET collateral_locked = CASE
                 WHEN status IN ('CLAIMED', 'PAID', 'RELEASED') AND seller_id IS NOT NULL THEN 1
                 ELSE collateral_locked
             END`
        );
    } catch (error) {
        if (!isIgnorableAlterError(error)) {
            throw error;
        }
    }

    try {
        await db.query('ALTER TABLE exchanger_stats ADD COLUMN total_volume_eur DECIMAL(20, 8) NOT NULL DEFAULT 0.00000000 AFTER total_volume_ltc');
    } catch (error) {
        if (!isIgnorableAlterError(error)) {
            throw error;
        }
    }

    // Idempotency key for withdrawal reservations.
    try {
        await db.query('ALTER TABLE withdrawal_queue ADD COLUMN request_key VARCHAR(128) NULL AFTER processed_by');
    } catch (error) {
        if (!isIgnorableAlterError(error)) {
            throw error;
        }
    }

    try {
        await db.query('CREATE UNIQUE INDEX uniq_withdraw_request_key ON withdrawal_queue (request_key)');
    } catch (error) {
        if (!isIgnorableAlterError(error)) {
            throw error;
        }
    }

    // Fix deposit uniqueness to support same txid paying multiple internal addresses.
    try {
        await db.query('ALTER TABLE pending_deposits DROP INDEX unique_txid');
    } catch (error) {
        if (!isIgnorableAlterError(error)) {
            throw error;
        }
    }

    try {
        await db.query('CREATE UNIQUE INDEX unique_txid_address ON pending_deposits (txid, address)');
    } catch (error) {
        if (!isIgnorableAlterError(error)) {
            throw error;
        }
    }

    // Track release payout lifecycle for reliable reconciliation.
    await db.query(
        `CREATE TABLE IF NOT EXISTS release_jobs (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            ticket_id VARCHAR(20) NOT NULL,
            initiated_by VARCHAR(50) NOT NULL,
            ltc_address VARCHAR(255) NOT NULL,
            amount_ltc DECIMAL(20, 8) NOT NULL,
            status ENUM('PROCESSING', 'COMPLETED', 'FAILED', 'CHAIN_SENT_DB_SYNC_REQUIRED') DEFAULT 'PROCESSING',
            txid VARCHAR(64) NULL,
            last_error TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            processed_at TIMESTAMP NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_release_ticket (ticket_id),
            FOREIGN KEY (ticket_id) REFERENCES tickets(ticket_id)
        )`
    );

    await db.query(
        `CREATE TABLE IF NOT EXISTS pending_claim_confirmations (
            ticket_id VARCHAR(20) PRIMARY KEY,
            seller_id INT NOT NULL,
            message_id VARCHAR(100) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (ticket_id) REFERENCES tickets(ticket_id),
            FOREIGN KEY (seller_id) REFERENCES users(id)
        )`
    );

    await db.query(
        `CREATE TABLE IF NOT EXISTS exchanger_payment_configs (
            user_id INT NOT NULL,
            method_key VARCHAR(50) NOT NULL,
            payment_details TEXT NOT NULL,
            approved_by VARCHAR(50) NULL,
            approved_at TIMESTAMP NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, method_key),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )`
    );

    await db.query(
        `CREATE TABLE IF NOT EXISTS payment_config_requests (
            request_id VARCHAR(20) PRIMARY KEY,
            user_id INT NOT NULL,
            method_key VARCHAR(50) NOT NULL,
            payment_details TEXT NOT NULL,
            request_action ENUM('UPSERT', 'DELETE') DEFAULT 'UPSERT',
            status ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') DEFAULT 'PENDING',
            log_message_id VARCHAR(100) NULL,
            review_note TEXT NULL,
            reviewed_by VARCHAR(50) NULL,
            requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            reviewed_at TIMESTAMP NULL,
            FOREIGN KEY (user_id) REFERENCES users(id),
            INDEX idx_payment_config_requests_user_status (user_id, status)
        )`
    );

    await db.query(
        `CREATE TABLE IF NOT EXISTS claim_whitelist (
            user_id INT PRIMARY KEY,
            added_by VARCHAR(50) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )`
    );

    try {
        await db.query(
            `ALTER TABLE payment_config_requests
             ADD COLUMN request_action ENUM('UPSERT', 'DELETE') DEFAULT 'UPSERT' AFTER payment_details`
        );
    } catch (error) {
        if (!isIgnorableAlterError(error)) {
            throw error;
        }
    }
}

module.exports = {
    runMigrations
};
