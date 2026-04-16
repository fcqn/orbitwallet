require('dotenv').config();

function required(name) {
    const value = process.env[name];
    if (!value || !String(value).trim()) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return String(value).trim();
}

function optional(name, fallback = '') {
    const value = process.env[name];
    if (value === undefined || value === null || String(value).trim() === '') {
        return fallback;
    }
    return String(value).trim();
}

function requiredAny(names) {
    for (const name of names) {
        const value = process.env[name];
        if (value && String(value).trim()) {
            return String(value).trim();
        }
    }
    throw new Error(`Missing required environment variable. Set one of: ${names.join(', ')}`);
}

function firstAvailable(names, fallback = '') {
    for (const name of names) {
        const value = process.env[name];
        if (value && String(value).trim()) {
            return String(value).trim();
        }
    }
    return fallback;
}

function parseNumber(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid numeric environment variable: ${name}`);
    }
    return parsed;
}

function parseBoolean(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        return fallback;
    }

    const normalized = String(raw).trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) {
        return true;
    }
    if (['false', '0', 'no', 'off'].includes(normalized)) {
        return false;
    }

    throw new Error(`Invalid boolean environment variable: ${name}`);
}

const defaultWalletPath = '';

module.exports = {
    NODE_ENV: optional('NODE_ENV', 'development'),

    // Discord
    DISCORD_TOKEN: required('DISCORD_TOKEN'),
    CLIENT_ID: required('CLIENT_ID'),

    // Discord IDs
    CHANNEL_DEALS_ID: firstAvailable(['CHANNEL_DEALS_ID'], ''),
    CHANNEL_SUPPORT_ID: firstAvailable(['CHANNEL_SUPPORT_ID'], ''),
    CHANNEL_CLAIM_ID: firstAvailable(['CHANNEL_CLAIM_ID', 'CLAIM_CHANNEL_ID'], ''),
    CHANNEL_TRUST_FEED_ID: firstAvailable(['CHANNEL_TRUST_FEED_ID'], ''),
    CHANNEL_LOG_WITHDRAW_ID: firstAvailable(['CHANNEL_LOG_WITHDRAW_ID'], ''),
    CHANNEL_LOG_DEPOSIT_ID: firstAvailable(['CHANNEL_LOG_DEPOSIT_ID'], ''),
    CHANNEL_LOG_DEALS_CLOSE_ID: firstAvailable(['CHANNEL_LOG_DEALS_CLOSE_ID'], ''),
    CHANNEL_LOG_SUPPORT_CLOSE_ID: firstAvailable(['CHANNEL_LOG_SUPPORT_CLOSE_ID'], ''),
    CHANNEL_LOG_TRANSACTIONS_ID: firstAvailable(['CHANNEL_LOG_TRANSACTIONS_ID'], ''),
    CHANNEL_LOG_ERRORS_ID: firstAvailable(['CHANNEL_LOG_ERRORS_ID'], ''),
    CHANNEL_LOG_PAYMENT_CONFIG_ID: firstAvailable(['CHANNEL_LOG_PAYMENT_CONFIG_ID'], ''),
    CHANNEL_LOG_ADMIN_ID: firstAvailable(['CHANNEL_LOG_ADMIN_ID', 'CHANNEL_LOG_AUDIT_ID'], ''),
    ROLE_EXCHANGER_ID: firstAvailable(['ROLE_EXCHANGER_ID', 'EXCHANGER_ROLE_ID']),
    ROLE_SUPPORT_ID: firstAvailable(['ROLE_SUPPORT_ID', 'SUPPORT_ROLE_ID']),
    ROLE_COMPLETED_DEAL_ID: firstAvailable(['ROLE_COMPLETED_DEAL_ID'], ''),

    // Database
    DB_ENABLED: parseBoolean('DB_ENABLED', true),
    DB_HOST: optional('DB_HOST', ''),
    DB_USER: optional('DB_USER', ''),
    DB_PASSWORD: firstAvailable(['DB_PASSWORD', 'DB_PASS'], ''),
    DB_NAME: optional('DB_NAME', ''),

    // Electrum-LTC RPC
    LTC_RPC_URL: optional('LTC_RPC_URL', ''),
    RPC_USER: requiredAny(['RPC_USER', 'LTC_RPC_USER']),
    RPC_PASS: requiredAny(['RPC_PASS', 'LTC_RPC_PASSWORD']),
    WALLET_PATH: optional('WALLET_PATH', defaultWalletPath),

    // Limits
    MAX_WITHDRAWAL: parseNumber('MAX_WITHDRAWAL', 10.0),
    DAILY_LIMIT: parseNumber('DAILY_LIMIT', 50.0),
    MAX_OPEN_TICKETS_PER_USER: parseInt(optional('MAX_OPEN_TICKETS_PER_USER', '2'), 10)
};
