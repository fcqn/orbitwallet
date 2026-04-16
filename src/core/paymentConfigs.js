const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./database');
const appConfig = require('../config/appConfig');

const PAYMENT_METHOD_CHOICES = [
    { name: 'PayPal', value: 'paypal' },
    { name: 'CashApp', value: 'cashapp' },
    { name: 'Zelle', value: 'zelle' },
    { name: 'Wise', value: 'wise' },
    { name: 'Revolut', value: 'revolut' },
    { name: 'Bank', value: 'bank' },
    { name: 'PaysafeCard', value: 'paysafecard' },
    { name: 'Crypto', value: 'crypto' },
    { name: 'LTC', value: 'ltc' },
    { name: 'USDT', value: 'usdt' },
    { name: 'BTC', value: 'btc' },
    { name: 'ETH', value: 'eth' },
    { name: 'SOL', value: 'sol' }
];

function normalizeMethodKey(rawValue) {
    const normalized = String(rawValue || '').trim().toLowerCase();
    if (!normalized) return null;

    if (normalized.includes('paypal')) return 'paypal';
    if (normalized.includes('cashapp')) return 'cashapp';
    if (normalized.includes('zelle')) return 'zelle';
    if (normalized.includes('wise')) return 'wise';
    if (normalized.includes('revolut')) return 'revolut';
    if (normalized.includes('paysafecard')) return 'paysafecard';
    if (normalized.includes('bank')) return 'bank';
    if (normalized.includes('usdt')) return 'usdt';
    if (normalized.includes('btc') || normalized.includes('bitcoin')) return 'btc';
    if (normalized.includes('eth') || normalized.includes('ethereum')) return 'eth';
    if (normalized.includes('sol') || normalized.includes('solana')) return 'sol';
    if (normalized.includes('ltc') || normalized.includes('litecoin')) return 'ltc';
    if (normalized.includes('crypto')) return 'crypto';

    return normalized.replace(/[^a-z0-9]+/g, '_');
}

function createPaymentRequestId() {
    return `PAYCFG-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function formatMethodName(methodKey) {
    return String(methodKey || '').replace(/_/g, ' ').toUpperCase();
}

async function resolvePaymentConfigForTicket(userId, paymentMethod) {
    const normalizedMethod = normalizeMethodKey(paymentMethod);
    const methodsToCheck = normalizedMethod ? [normalizedMethod] : [];

    if (normalizedMethod && ['ltc', 'usdt', 'btc', 'eth', 'sol'].includes(normalizedMethod)) {
        methodsToCheck.push('crypto');
    }

    for (const methodKey of methodsToCheck) {
        const [rows] = await db.query(
            'SELECT payment_details, method_key FROM exchanger_payment_configs WHERE user_id = ? AND method_key = ? LIMIT 1',
            [userId, methodKey]
        );
        if (rows.length && String(rows[0].payment_details || '').trim()) {
            return {
                methodKey: rows[0].method_key,
                paymentDetails: String(rows[0].payment_details).trim()
            };
        }
    }

    return null;
}

function buildPaymentRequestEmbed(request) {
    const actionLabel = request.request_action === 'DELETE' ? 'Delete Config' : 'Create / Update Config';
    return new EmbedBuilder()
        .setTitle('Orbit Trade | Payment Config Request')
        .setDescription(
            `> Request ID: \`${request.request_id}\`\n` +
            `> Exchanger: <@${request.discord_id}>\n` +
            `> Method: **${formatMethodName(request.method_key)}**\n` +
            `> Action: **${actionLabel}**\n` +
            `> Status: **${request.status}**\n` +
            `> Details:\n${request.payment_details}`
        )
        .setColor(appConfig.brand.color)
        .setFooter({ text: appConfig.brand.name })
        .setTimestamp(new Date(request.requested_at || Date.now()));
}

function buildPaymentRequestActionRow(requestId, disabled = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`paymentcfgapprove_${requestId}`)
            .setLabel('Approve')
            .setStyle(ButtonStyle.Success)
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(`paymentcfgreject_${requestId}`)
            .setLabel('Reject')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(disabled)
    );
}

async function fetchPaymentRequest(requestId) {
    const [rows] = await db.query(
        `SELECT r.*, u.discord_id, u.username
         FROM payment_config_requests r
         JOIN users u ON u.id = r.user_id
         WHERE r.request_id = ?
         LIMIT 1`,
        [requestId]
    );
    return rows[0] || null;
}

async function syncPaymentRequestMessage(client, requestId) {
    const request = await fetchPaymentRequest(requestId);
    if (!request || !request.log_message_id || !client) return;

    const channel = await client.channels.fetch(appConfig.channels.logs.paymentConfig).catch(() => null);
    if (!channel?.isTextBased?.()) return;

    const message = await channel.messages.fetch(request.log_message_id).catch(() => null);
    if (!message) return;

    const statusLine = request.review_note
        ? `\n> Review Note: ${request.review_note}`
        : '';
    const reviewerLine = request.reviewed_by
        ? `\n> Reviewed By: <@${request.reviewed_by}>`
        : '';

    const embed = buildPaymentRequestEmbed({
        ...request,
        payment_details: `${request.payment_details}${reviewerLine}${statusLine}`
    });

    await message.edit({
        embeds: [embed],
        components: [buildPaymentRequestActionRow(requestId, request.status !== 'PENDING')]
    }).catch(() => {});
}

async function reviewPaymentRequest({ requestId, reviewerDiscordId, action, note = '' }) {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const [requestRows] = await connection.query(
            'SELECT * FROM payment_config_requests WHERE request_id = ? FOR UPDATE',
            [requestId]
        );
        if (!requestRows.length) {
            await connection.rollback();
            return { ok: false, message: 'Payment request not found.' };
        }

        const request = requestRows[0];
        if (request.status !== 'PENDING') {
            await connection.rollback();
            return { ok: false, message: `Request already reviewed with status ${request.status}.` };
        }

        const nextStatus = action === 'approve' ? 'APPROVED' : 'REJECTED';

        if (nextStatus === 'APPROVED') {
            if (request.request_action === 'DELETE') {
                await connection.query(
                    'DELETE FROM exchanger_payment_configs WHERE user_id = ? AND method_key = ?',
                    [request.user_id, request.method_key]
                );
            } else {
                await connection.query(
                    `INSERT INTO exchanger_payment_configs (user_id, method_key, payment_details, approved_by, approved_at)
                     VALUES (?, ?, ?, ?, NOW())
                     ON DUPLICATE KEY UPDATE
                        payment_details = VALUES(payment_details),
                        approved_by = VALUES(approved_by),
                        approved_at = NOW(),
                        updated_at = NOW()`,
                    [request.user_id, request.method_key, request.payment_details, reviewerDiscordId]
                );
            }
        }

        await connection.query(
            `UPDATE payment_config_requests
             SET status = ?, reviewed_at = NOW(), reviewed_by = ?, review_note = ?
             WHERE request_id = ?`,
            [nextStatus, reviewerDiscordId, note || null, requestId]
        );

        await connection.commit();
        return { ok: true, status: nextStatus, request };
    } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
    } finally {
        connection.release();
    }
}

async function dmPaymentRequestReview(client, requestId) {
    const request = await fetchPaymentRequest(requestId);
    if (!request || !client || request.status === 'PENDING') return;

    try {
        const user = await client.users.fetch(request.discord_id);
        const actionLabel = request.request_action === 'DELETE' ? 'delete request' : 'payment config request';
        const resultLabel = request.status === 'APPROVED' ? 'approved' : 'rejected';

        const embed = new EmbedBuilder()
            .setTitle('Orbit Trade | Payment Review Update')
            .setDescription(
                `> Request ID: \`${request.request_id}\`\n` +
                `> Method: **${formatMethodName(request.method_key)}**\n` +
                `> Action: **${request.request_action === 'DELETE' ? 'Delete Config' : 'Create / Update Config'}**\n` +
                `> Result: **${request.status}**\n` +
                `${request.review_note ? `> Note: ${request.review_note}\n` : ''}` +
                `Your ${actionLabel} was ${resultLabel}.`
            )
            .setColor(appConfig.brand.color)
            .setFooter({ text: appConfig.brand.name })
            .setTimestamp();

        await user.send({ embeds: [embed] }).catch(() => {});
    } catch {
        return;
    }
}

async function listApprovedPaymentConfigs(userId) {
    const [rows] = await db.query(
        `SELECT method_key, payment_details, approved_by, approved_at, updated_at
         FROM exchanger_payment_configs
         WHERE user_id = ?
         ORDER BY method_key ASC`,
        [userId]
    );
    return rows;
}

async function listPendingPaymentRequests(userId) {
    const [rows] = await db.query(
        `SELECT request_id, method_key, request_action, status, requested_at
         FROM payment_config_requests
         WHERE user_id = ? AND status = 'PENDING'
         ORDER BY requested_at DESC`,
        [userId]
    );
    return rows;
}

module.exports = {
    PAYMENT_METHOD_CHOICES,
    normalizeMethodKey,
    createPaymentRequestId,
    formatMethodName,
    resolvePaymentConfigForTicket,
    buildPaymentRequestEmbed,
    buildPaymentRequestActionRow,
    fetchPaymentRequest,
    syncPaymentRequestMessage,
    reviewPaymentRequest,
    dmPaymentRequestReview,
    listApprovedPaymentConfigs,
    listPendingPaymentRequests
};
