-- Database creation is handled outside the app in production setup.

-- 1. Users Table (With Hold System)
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    discord_id VARCHAR(50) UNIQUE NOT NULL,
    username VARCHAR(100),
    exchanger_terms TEXT,
    ltc_deposit_address VARCHAR(255) UNIQUE, 
    ltc_private_key TEXT,
    balance_available DECIMAL(20, 8) DEFAULT 0.00000000,
    balance_escrow DECIMAL(20, 8) DEFAULT 0.00000000,
    total_deposited DECIMAL(20, 8) DEFAULT 0.00000000,
    total_withdrawn DECIMAL(20, 8) DEFAULT 0.00000000,
    last_withdrawn_at TIMESTAMP NULL,
    is_held BOOLEAN DEFAULT FALSE,
    held_reason TEXT,
    held_by VARCHAR(50),
    held_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 2. Payment Methods Table
CREATE TABLE IF NOT EXISTS payment_methods (
    id INT AUTO_INCREMENT PRIMARY KEY,
    method_name VARCHAR(50) UNIQUE,
    service_fee_pct DECIMAL(5, 2),
    commission_pct DECIMAL(5, 2)
);

-- 3. Tickets Table (FIXED - added missing columns)
CREATE TABLE IF NOT EXISTS tickets (
    ticket_id VARCHAR(20) PRIMARY KEY,
    buyer_id INT NOT NULL,
    seller_id INT DEFAULT NULL,
    amount_from DECIMAL(20, 8) DEFAULT NULL,
    amount_to DECIMAL(20, 8) DEFAULT NULL,
    source_currency VARCHAR(16) DEFAULT NULL,
    amount_usd DECIMAL(10, 2) NOT NULL,
    amount_ltc DECIMAL(20, 8) NOT NULL,
    fee_ltc DECIMAL(20, 8) NOT NULL,
    total_ltc DECIMAL(20, 8) NOT NULL,
    service_fee_amount DECIMAL(20, 8) DEFAULT NULL,
    service_fee_currency VARCHAR(16) DEFAULT NULL,
    collateral_required BOOLEAN NOT NULL DEFAULT TRUE,
    collateral_locked BOOLEAN NOT NULL DEFAULT FALSE,
    owner_commission_amount DECIMAL(20, 8) DEFAULT NULL,
    exchanger_profit_amount DECIMAL(20, 8) DEFAULT NULL,
    fee_processed_at TIMESTAMP NULL,
    payment_method VARCHAR(50),
    receive_method VARCHAR(100),
    status ENUM('OPEN', 'CLAIMED', 'PAID', 'RELEASED', 'CANCELLED', 'DISPUTED') DEFAULT 'OPEN',
    buyer_ltc_address VARCHAR(255),
    payment_proof TEXT,
    channel_id VARCHAR(100),           -- ADDED: Discord channel ID
    claim_message_id VARCHAR(100),     -- ADDED: Claim message ID
    final_txid VARCHAR(64),            -- ADDED: Final release txid
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    claimed_at TIMESTAMP NULL,
    paid_at TIMESTAMP NULL,
    released_at TIMESTAMP NULL,
    FOREIGN KEY (buyer_id) REFERENCES users(id),
    FOREIGN KEY (seller_id) REFERENCES users(id)
);

-- 4. Wallet Ledger
CREATE TABLE IF NOT EXISTS wallet_ledger (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    action_type ENUM('DEPOSIT', 'WITHDRAWAL', 'P2P_LOCK', 'P2P_RELEASE', 'SERVICE_FEE', 'COMMISSION', 'PAYOUT', 'NETWORK_FEE'),
    amount DECIMAL(20, 8) NOT NULL,
    fee_amount DECIMAL(20, 8) DEFAULT 0.00000000,
    txid VARCHAR(64),
    to_address VARCHAR(255),
    from_address VARCHAR(255),
    deal_id VARCHAR(100),
    status ENUM('PENDING', 'CONFIRMED', 'FAILED') DEFAULT 'CONFIRMED',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    INDEX idx_user_time (user_id, created_at),
    INDEX idx_txid (txid)
);

-- 5. Ticket Temp Data (Session storage)
CREATE TABLE IF NOT EXISTS ticket_temp_data (
    data_id VARCHAR(100) PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    data_json TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    INDEX idx_expires (expires_at)
);

-- 6. Pending Deposits
CREATE TABLE IF NOT EXISTS pending_deposits (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    address VARCHAR(255) NOT NULL,
    txid VARCHAR(64) NOT NULL,
    amount DECIMAL(20, 8) NOT NULL,
    confirmations INT DEFAULT 0,
    status ENUM('PENDING', 'CONFIRMED', 'CANCELLED') DEFAULT 'PENDING',
    detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    confirmed_at TIMESTAMP NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE KEY unique_txid_address (txid, address)
);

-- 7. Withdrawal Queue (REMOVED DUPLICATE)
CREATE TABLE IF NOT EXISTS withdrawal_queue (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    amount DECIMAL(20, 8) NOT NULL,
    fee_amount DECIMAL(20, 8) NOT NULL,
    to_address VARCHAR(255) NOT NULL,
    status ENUM('PENDING', 'APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED') DEFAULT 'PENDING',
    txid VARCHAR(64),
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP NULL,
    processed_by VARCHAR(50),
    request_key VARCHAR(128),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE UNIQUE INDEX uniq_withdraw_request_key ON withdrawal_queue (request_key);

-- 8. Admin Users
CREATE TABLE IF NOT EXISTS admins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    discord_id VARCHAR(50) UNIQUE NOT NULL,
    username VARCHAR(100),
    can_approve_withdrawals BOOLEAN DEFAULT FALSE,
    can_ban_users BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9. Exchanger Stats
CREATE TABLE IF NOT EXISTS exchanger_stats (
    user_id INT PRIMARY KEY,
    total_deals INT DEFAULT 0,
    completed_deals INT DEFAULT 0,
    disputed_deals INT DEFAULT 0,
    total_volume_ltc DECIMAL(20, 8) DEFAULT 0,
    total_volume_eur DECIMAL(20, 8) DEFAULT 0,
    last_active TIMESTAMP NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 10. Release Confirmations (NEW)
CREATE TABLE IF NOT EXISTS release_confirmations (
    ticket_id VARCHAR(20) PRIMARY KEY,
    message_id VARCHAR(100),
    exchanger_confirmed BOOLEAN DEFAULT FALSE,
    buyer_confirmed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticket_id) REFERENCES tickets(ticket_id)
);

CREATE TABLE IF NOT EXISTS pending_claim_confirmations (
    ticket_id VARCHAR(20) PRIMARY KEY,
    seller_id INT NOT NULL,
    message_id VARCHAR(100) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticket_id) REFERENCES tickets(ticket_id),
    FOREIGN KEY (seller_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS exchanger_payment_terms (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    method_key VARCHAR(50) NOT NULL,
    terms_text TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_user_method_terms (user_id, method_key),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS exchanger_owner_balances (
    user_id INT NOT NULL,
    currency_code VARCHAR(16) NOT NULL,
    hidden_owner_balance DECIMAL(20, 8) NOT NULL DEFAULT 0.00000000,
    last_withdrawn_at TIMESTAMP NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, currency_code),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS owner_commission_ledger (
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
);

CREATE TABLE IF NOT EXISTS exchanger_payment_configs (
    user_id INT NOT NULL,
    method_key VARCHAR(50) NOT NULL,
    payment_details TEXT NOT NULL,
    approved_by VARCHAR(50) NULL,
    approved_at TIMESTAMP NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, method_key),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS payment_config_requests (
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
);

CREATE TABLE IF NOT EXISTS release_jobs (
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
);

CREATE TABLE IF NOT EXISTS claim_whitelist (
    user_id INT PRIMARY KEY,
    added_by VARCHAR(50) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Insert default payment methods
INSERT IGNORE INTO payment_methods (method_name, service_fee_pct, commission_pct) VALUES 
('PayPal', 10.00, 5.00),
('CashApp', 12.00, 6.00),
('Zelle', 8.00, 4.00),
('Bank Transfer', 15.00, 8.00);
