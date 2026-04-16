const { ActionRowBuilder, ButtonBuilder, MessageFlags } = require('discord.js');
const session = require('../core/session');
const axios = require('axios');
const appConfig = require('../config/appConfig');
const { ButtonStyle } = require('discord.js');
const { formatFiat, formatFiatPerLtc } = require('../core/currency');
const { formatMethodLabel } = require('../core/displayLabels');
const { calculateMarketplaceAmounts } = require('../core/marketplaceFees');
const { AMOUNT_MODAL_CONFIG, getPaymentFeeRate } = require('../core/paymentMethods');
const { makeTicketContainer } = require('../core/ticketVisuals');
const emojis = require('../config/emojis');

async function getLtcPrice(currency = 'eur') {
    try {
        const normalizedCurrency = String(currency || 'eur').toLowerCase();
        const res = await axios.get(
            `https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=${normalizedCurrency}`,
            { timeout: 5000 }
        );
        return Number(res.data?.litecoin?.[normalizedCurrency] || 60);
    } catch (err) {
        console.log('Price fetch failed:', err.message);
        return 60;
    }
}

module.exports = {
    customId: 'amountmodal',

    async execute(interaction) {
        const sessionId = interaction.customId.replace('amountmodal_', '');
        const sessionData = await session.get(sessionId);

        if (!sessionData) {
            return interaction.reply({
                content: 'Session expired. Please start again.',
                flags: MessageFlags.Ephemeral
            });
        }

        const usesExchangeCaptureFlow = Boolean(sessionData.sendingOption && sessionData.receivingOption && sessionData.currency);
        const amountFieldId = usesExchangeCaptureFlow ? 'amount' : AMOUNT_MODAL_CONFIG.fieldId;
        const amountUsdRaw = interaction.fields.getTextInputValue(amountFieldId).trim();
        const amountUsd = parseFloat(amountUsdRaw);

        if (Number.isNaN(amountUsd) || amountUsd <= 0) {
            return interaction.reply({
                content: 'Please enter a valid amount (for example: 100).',
                flags: MessageFlags.Ephemeral
            });
        }

        const feePercent = getPaymentFeeRate(sessionData);
        const selectedCurrency = usesExchangeCaptureFlow ? (sessionData.currency || 'eur') : (sessionData.sourceCurrency || 'EUR').toLowerCase();
        const normalizedCurrency = String(selectedCurrency).toUpperCase();
        const ltcPrice = await getLtcPrice(selectedCurrency);
        const additionalInfo = usesExchangeCaptureFlow
            ? (interaction.fields.getTextInputValue('additional_info') || 'None provided').trim() || 'None provided'
            : 'None provided';

        let marketplaceAmounts;
        try {
            const resolvedPaymentMethod = usesExchangeCaptureFlow ? sessionData.sendingOption : sessionData.paymentMethod;
            const resolvedReceiveMethod = usesExchangeCaptureFlow ? sessionData.receivingOption : sessionData.receiveMethod;
            marketplaceAmounts = calculateMarketplaceAmounts({
                amountFrom: amountUsdRaw,
                feeRate: getPaymentFeeRate({
                    paymentMethod: resolvedPaymentMethod,
                    paymentSub: sessionData.paymentSub,
                    receiveMethod: resolvedReceiveMethod,
                    receiveSub: sessionData.receiveSub
                }),
                ltcPrice,
                fiatCurrency: normalizedCurrency,
                paymentMethod: resolvedPaymentMethod,
                paymentSub: sessionData.paymentSub,
                receiveMethod: resolvedReceiveMethod,
                receiveSub: sessionData.receiveSub
            });
        } catch (error) {
            return interaction.reply({
                content: error.message,
                flags: MessageFlags.Ephemeral
            });
        }

        sessionData.amountUsd = parseFloat(marketplaceAmounts.amountFrom);
        sessionData.amountFrom = marketplaceAmounts.amountFrom;
        sessionData.amountTo = marketplaceAmounts.amountTo;
        sessionData.sourceCurrency = normalizedCurrency;
        sessionData.amountLtc = parseFloat(marketplaceAmounts.amountLtc);
        sessionData.feeLtc = parseFloat(marketplaceAmounts.feeLtc);
        sessionData.totalLtc = parseFloat(marketplaceAmounts.totalLtc);
        sessionData.serviceFeeAmount = marketplaceAmounts.serviceFeeAmount;
        sessionData.serviceFeeCurrency = marketplaceAmounts.serviceFeeCurrency;
        sessionData.ltcPrice = ltcPrice;
        sessionData.feePercent = usesExchangeCaptureFlow ? 0.05 : feePercent;
        sessionData.additionalInfo = additionalInfo;
        if (usesExchangeCaptureFlow) {
            sessionData.paymentMethod = sessionData.sendingOption;
            sessionData.receiveMethod = sessionData.receivingOption;
            sessionData.paymentSub = null;
            sessionData.paymentNetwork = null;
            sessionData.receiveSub = null;
            sessionData.receiveNetwork = null;
        }

        await session.set(sessionId, interaction.user.id, sessionData);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`confirm_${sessionId}`)
                .setLabel('Confirm')
                .setEmoji(emojis.getComponent('confirmAction'))
                .setStyle(appConfig.brand.buttonStyle),
            new ButtonBuilder()
                .setCustomId(`cancel_${sessionId}`)
                .setLabel('Cancel')
                .setEmoji(emojis.getComponent('cancelAction'))
                .setStyle(ButtonStyle.Danger)
        );

        await interaction.reply({
            components: [
                makeTicketContainer(
                    usesExchangeCaptureFlow ? emojis.withEmoji('exchangeFlowTitle', `${getExchangeTitle(sessionData.exchangeType)} Submitted`) : emojis.withEmoji('summaryTitle', 'Order Summary'),
                    usesExchangeCaptureFlow
                        ? [
                            '> Your exchange request has been captured. A staff flow can be connected here next.',
                            `> Type: **${getExchangeLabel(sessionData.exchangeType)}**`,
                            `> Amount: **${amountUsdRaw}**`,
                            `> Currency: **${getAssetLabel(sessionData.currency)}**`,
                            `> Sending Option: **${getAssetLabel(sessionData.sendingOption)}**`,
                            `> Receiving Option: **${getAssetLabel(sessionData.receivingOption)}**`,
                            `> Additional Information: **${additionalInfo}**`
                        ]
                        : [
                            `> You Send: **${getPaymentDisplay(sessionData)}**`,
                            `> You Receive: **${getReceiveDisplay(sessionData)}**`,
                            `> Amount From: **${formatFiat(parseFloat(marketplaceAmounts.amountFrom), normalizedCurrency)}**`,
                            `> Amount To: **${formatFiat(parseFloat(marketplaceAmounts.amountTo), normalizedCurrency)}**`,
                            `> LTC Price: **${formatFiatPerLtc(ltcPrice, normalizedCurrency)}**`,
                            `> Service Fee: **${marketplaceAmounts.serviceFeeAmount} ${marketplaceAmounts.serviceFeeCurrency}**`,
                            `> Escrow Lock: **${parseFloat(marketplaceAmounts.totalLtc).toFixed(8)} LTC**`
                        ],
                    [row]
                )
            ],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
        });
    }
};

function getPaymentDisplay(sessionData) {
    let display = formatMethodLabel(sessionData.paymentMethod || 'UNKNOWN');
    if (sessionData.paymentSub) {
        display += ` (${formatMethodLabel(sessionData.paymentSub)})`;
    }
    if (sessionData.paymentNetwork) {
        const net = sessionData.paymentNetwork.split('_').pop();
        display += ` [${formatMethodLabel(net)}]`;
    }
    return display;
}

function getReceiveDisplay(sessionData) {
    let display = formatMethodLabel(sessionData.receiveMethod || 'UNKNOWN');
    if (sessionData.receiveSub) {
        display += ` (${formatMethodLabel(sessionData.receiveSub)})`;
    }
    if (sessionData.receiveNetwork) {
        const net = sessionData.receiveNetwork.split('_').pop();
        display += ` (${formatMethodLabel(net)})`;
    }
    return display;
}

function getAssetLabel(value) {
    return formatMethodLabel(value || 'Unknown');
}

function getExchangeLabel(value) {
    return {
        buy: 'Buy',
        sell: 'Sell',
        swap: 'Swap',
        fiat_to_fiat: 'Fiat to Fiat'
    }[value] || value;
}

function getExchangeTitle(value) {
    return {
        buy: 'Buy Exchange',
        sell: 'Sell Exchange',
        swap: 'Swap Exchange',
        fiat_to_fiat: 'Fiat to Fiat Exchange'
    }[value] || 'Exchange';
}
