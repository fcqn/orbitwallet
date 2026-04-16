const { MessageFlags } = require('discord.js');
const axios = require('axios');
const db = require('../core/database');
const { formatFiat } = require('../core/currency');
const { calculateMarketplaceAmounts } = require('../core/marketplaceFees');
const { buildDealThreadCard } = require('../core/dealCards');
const { updateClaimMessage } = require('./claimMessage');

async function getLtcPrice(currency = 'eur') {
    try {
        const normalizedCurrency = String(currency || 'eur').toLowerCase();
        const res = await axios.get(
            `https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=${normalizedCurrency}`,
            { timeout: 5000 }
        );
        return Number(res.data?.litecoin?.[normalizedCurrency] || 60);
    } catch {
        return 60;
    }
}

module.exports = {
    customId: 'changeamountmodal',

    async execute(interaction) {
        const ticketId = interaction.customId.replace('changeamountmodal_', '');
        const amountRaw = interaction.fields.getTextInputValue('new_amount_usd').trim();
        const amountUsd = Number(amountRaw);

        if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
            return interaction.reply({
                content: 'Enter a valid amount.',
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            const [tickets] = await db.query(
                `SELECT t.ticket_id, t.status, t.amount_ltc, t.fee_ltc, t.service_fee_amount, t.amount_from,
                        t.payment_method, t.receive_method, t.channel_id, t.claim_message_id,
                        t.service_fee_currency, t.source_currency, t.amount_to, u.discord_id as buyer_discord_id
                 FROM tickets t
                 JOIN users u ON u.id = t.buyer_id
                 WHERE t.ticket_id = ?`,
                [ticketId]
            );

            if (!tickets.length) {
                return interaction.reply({
                    content: 'Ticket not found.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const ticket = tickets[0];
            const sourceCurrency = String(ticket.source_currency || 'EUR').toUpperCase();
            if (ticket.status !== 'OPEN') {
                return interaction.reply({
                    content: 'Amount can only be changed before claim.',
                    flags: MessageFlags.Ephemeral
                });
            }

            if (ticket.buyer_discord_id !== interaction.user.id) {
                return interaction.reply({
                    content: 'Only the ticket opener can change the amount.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const previousAmountFrom = Number(ticket.amount_from || amountUsd);
            const previousServiceFeeAmount = Number(ticket.service_fee_amount || 0);
            const feePercent = previousAmountFrom > 0 ? previousServiceFeeAmount / previousAmountFrom : 0.05;

            const ltcPrice = await getLtcPrice(sourceCurrency);
            const marketplaceAmounts = calculateMarketplaceAmounts({
                amountFrom: amountRaw,
                feeRate: feePercent,
                ltcPrice,
                fiatCurrency: sourceCurrency,
                paymentMethod: ticket.payment_method,
                receiveMethod: ticket.receive_method
            });

            await db.query(
                `UPDATE tickets
                 SET amount_from = ?, amount_to = ?, source_currency = ?, amount_usd = ?, amount_ltc = ?, fee_ltc = ?, total_ltc = ?,
                     service_fee_amount = ?, service_fee_currency = ?
                 WHERE ticket_id = ? AND status = 'OPEN'`,
                [
                    marketplaceAmounts.amountFrom,
                    marketplaceAmounts.amountTo,
                    sourceCurrency,
                    amountUsd,
                    marketplaceAmounts.amountLtc,
                    marketplaceAmounts.feeLtc,
                    marketplaceAmounts.totalLtc,
                    marketplaceAmounts.serviceFeeAmount,
                    marketplaceAmounts.serviceFeeCurrency,
                    ticketId
                ]
            );

            const thread = await interaction.guild.channels.fetch(ticket.channel_id);
            await refreshTicketCard(thread, {
                ticketId,
                paymentMethod: ticket.payment_method,
                receiveMethod: ticket.receive_method,
                amountFromLabel: formatFiat(parseFloat(marketplaceAmounts.amountFrom), sourceCurrency),
                amountToLabel: formatFiat(parseFloat(marketplaceAmounts.amountTo), sourceCurrency),
                serviceFeeLabel: `${marketplaceAmounts.serviceFeeAmount} ${marketplaceAmounts.serviceFeeCurrency}`
            });

            await updateClaimMessage(interaction.guild, {
                ticket_id: ticketId,
                claim_message_id: ticket.claim_message_id
            }, 'Claim Ticket', false);

            return interaction.reply({
                content: `Amount updated to ${formatFiat(amountUsd, sourceCurrency)}.`,
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error('change amount modal failed:', error);
            return interaction.reply({
                content: 'Could not update the amount right now.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }
    }
};

async function refreshTicketCard(thread, { ticketId, paymentMethod, receiveMethod, amountFromLabel, amountToLabel, serviceFeeLabel }) {
    const messages = await thread.messages.fetch({ limit: 30 }).catch(() => null);
    if (!messages) return;

    for (const message of messages.values()) {
        const firstContainer = message.components?.[0];
        const content = firstContainer?.content || firstContainer?.components?.[0]?.content || '';
        const isTicketHeader =
            message.author?.id === thread.client.user.id &&
            typeof content === 'string' &&
            content.includes(`> Ticket: \`${ticketId}\``);

        if (!isTicketHeader) {
            continue;
        }

        await message.edit({
            components: [
                buildDealThreadCard({
                    ticketId,
                    paymentMethod,
                    receiveMethod,
                    amountFromLabel,
                    amountToLabel,
                    serviceFeeLabel
                })
            ],
            flags: MessageFlags.IsComponentsV2
        }).catch(() => {});
        return;
    }
}
