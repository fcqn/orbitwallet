const appConfig = require('../config/appConfig');
const { EmbedBuilder } = require('discord.js');
const { makeEmbed, decorateDescription } = require('./ui');

function truncateFieldValue(value, limit = 1024) {
    const text = String(value ?? '');
    if (text.length <= limit) return text;
    return `${text.slice(0, limit - 3)}...`;
}

function normalizeLogPayload(defaultTitle, input, fallbackColor = appConfig.brand.color) {
    if (typeof input === 'string') {
        return { embeds: [makeEmbed(defaultTitle, input)] };
    }

    const {
        title = defaultTitle,
        summary = '',
        description = '',
        color = fallbackColor,
        fields = [],
        footer,
        timestamp = true
    } = input || {};

    const embed = new EmbedBuilder()
        .setTitle(title ? `Orbit Trade | ${title}` : 'Orbit Trade')
        .setColor(color)
        .setFooter({ text: footer || appConfig.brand.name });

    const body = summary || description;
    if (body) {
        embed.setDescription(decorateDescription(body));
    }

    if (Array.isArray(fields) && fields.length) {
        embed.addFields(
            fields
                .filter((field) => field?.name && field?.value !== undefined && field?.value !== null)
                .slice(0, 25)
                .map((field) => ({
                    name: truncateFieldValue(field.name, 256),
                    value: truncateFieldValue(field.value, 1024),
                    inline: Boolean(field.inline)
                }))
        );
    }

    if (timestamp) {
        embed.setTimestamp(typeof timestamp === 'string' || timestamp instanceof Date ? timestamp : new Date());
    }

    return { embeds: [embed] };
}

async function sendToChannel(client, channelId, payload) {
    if (!client || !channelId) return;
    try {
        const channel = await client.channels.fetch(channelId);
        if (channel?.isTextBased?.() && typeof channel.send === 'function') {
            return await channel.send(payload);
        }
    } catch (error) {
        console.error(`[LOGGER] Failed sending log to ${channelId}:`, error.message);
    }
}

async function logWithdraw(client, content) {
    await sendToChannel(client, appConfig.channels.logs.withdraw, normalizeLogPayload('Withdraw Log', content));
}

async function logDeposit(client, content) {
    await sendToChannel(client, appConfig.channels.logs.deposit, normalizeLogPayload('Deposit Log', content));
}

async function logTransaction(client, content) {
    await sendToChannel(client, appConfig.channels.logs.transactions, normalizeLogPayload('Transaction Log', content));
}

async function logError(client, content) {
    await sendToChannel(client, appConfig.channels.logs.errors, normalizeLogPayload('Error Log', content, 0xe74c3c));
}

async function logDealClose(client, payload) {
    return await sendToChannel(client, appConfig.channels.logs.dealsClose, payload);
}

async function logSupportClose(client, payload) {
    return await sendToChannel(client, appConfig.channels.logs.supportClose, payload);
}

async function logPaymentConfig(client, content) {
    await sendToChannel(client, appConfig.channels.logs.paymentConfig, normalizeLogPayload('Payment Method Update', content));
}

async function postPaymentConfig(client, payload) {
    return await sendToChannel(client, appConfig.channels.logs.paymentConfig, payload);
}

async function logAdminAction(client, content) {
    await sendToChannel(client, appConfig.channels.logs.admin, normalizeLogPayload('Admin Audit', content));
}

async function postTrustSummary(client, payload) {
    return await sendToChannel(client, appConfig.channels.trustFeed, payload);
}

module.exports = {
    logWithdraw,
    logDeposit,
    logTransaction,
    logError,
    logDealClose,
    logSupportClose,
    logPaymentConfig,
    postPaymentConfig,
    logAdminAction,
    postTrustSummary
};
