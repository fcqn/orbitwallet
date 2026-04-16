const { EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../core/database');
const { sendLtc } = require('../core/walletOps');
const {
    beginReleaseJob,
    markReleaseJobFailed,
    markReleaseJobDbSyncRequired,
    markReleaseJobCompleted
} = require('../core/payoutSafety');
const appConfig = require('../config/appConfig');
const logger = require('../core/logger');
const { formatFiat } = require('../core/currency');
const { formatMethodLabel } = require('../core/displayLabels');
const { disableClaimMessageForTicket } = require('./claimMessage');
const { applyHiddenOwnerCommission } = require('../core/marketplaceFees');
const { recordCompletedDeal } = require('../core/exchangerStats');
const { archiveCompletedTicketWithTranscript } = require('./ticketLifecycle');

module.exports = {
    customId: 'releaseaddress_',

    async execute(interaction) {
        const ticketId = interaction.customId.split('_')[1];
        const ltcAddress = interaction.fields.getTextInputValue('ltc_address').trim();

        const ltcRegex = /^(L|M|3|ltc1)[a-zA-Z0-9]{26,42}$/;
        if (!ltcRegex.test(ltcAddress)) {
            return interaction.reply({ 
                content: 'Invalid LTC address format.', 
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            const [tickets] = await db.query(
                'SELECT * FROM tickets WHERE ticket_id = ?',
                [ticketId]
            );

            if (tickets.length === 0) {
                return interaction.reply({ 
                    content: 'Ticket not found', 
                    flags: MessageFlags.Ephemeral
                });
            }

            const ticket = tickets[0];
            const collateralLocked = Boolean(Number(ticket.collateral_locked || 0));
            if (!['CLAIMED', 'PAID'].includes(ticket.status)) {
                return interaction.reply({
                    content: `Cannot release ticket in status ${ticket.status}.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const [buyerRows] = await db.query(
                'SELECT discord_id FROM users WHERE id = ?',
                [ticket.buyer_id]
            );
            const buyerDiscordId = buyerRows[0]?.discord_id;
            if (!buyerDiscordId || buyerDiscordId !== interaction.user.id) {
                return interaction.reply({
                    content: 'Only the buyer can submit the payout address.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const amountLtc = parseFloat(ticket.amount_ltc);
            await beginReleaseJob({
                ticketId,
                initiatedBy: interaction.user.id,
                ltcAddress,
                amountLtc
            });

            let txid;
            try {
                const result = await sendLtc({
                    destination: ltcAddress,
                    amount: amountLtc
                });
                txid = result.txid;
            } catch (sendError) {
                await markReleaseJobFailed({ ticketId, errorMessage: sendError.message }).catch(() => {});
                throw sendError;
            }

            // Database updates
            const connection = await db.getConnection();
            let feeBreakdown;
            try {
                await connection.beginTransaction();

                const [ticketRows] = await connection.query(
                    'SELECT * FROM tickets WHERE ticket_id = ? FOR UPDATE',
                    [ticketId]
                );
                if (!ticketRows.length) {
                    throw new Error('Ticket not found during release finalization');
                }
                const liveTicket = ticketRows[0];
                if (liveTicket.status === 'RELEASED') {
                    await markReleaseJobCompleted({ ticketId, txid, connection });
                    await connection.commit();
                    return interaction.reply({
                        content: `Ticket already released. Existing txid: \`${liveTicket.final_txid || txid}\``,
                        flags: MessageFlags.Ephemeral
                    });
                }

                feeBreakdown = await applyHiddenOwnerCommission(connection, {
                    ticketId,
                    exchangerId: liveTicket.seller_id,
                    serviceFeeAmount: liveTicket.service_fee_amount || liveTicket.fee_ltc,
                    serviceFeeCurrency: liveTicket.service_fee_currency || 'LTC'
                });

                if (collateralLocked) {
                    await connection.query(
                        'UPDATE users SET balance_escrow = GREATEST(balance_escrow - ?, 0) WHERE id = ?',
                        [liveTicket.total_ltc, liveTicket.seller_id]
                    );
                }

                await connection.query(
                    `UPDATE tickets
                     SET status = "RELEASED",
                         released_at = NOW(),
                         collateral_locked = 0,
                         buyer_ltc_address = ?,
                         final_txid = ?,
                         owner_commission_amount = ?,
                         exchanger_profit_amount = ?,
                         fee_processed_at = NOW()
                     WHERE ticket_id = ?`,
                    [ltcAddress, txid, feeBreakdown.ownerCommission, feeBreakdown.exchangerProfit, ticketId]
                );

                await connection.query(
                    `INSERT INTO wallet_ledger (user_id, action_type, amount, fee_amount, txid, to_address, status, created_at) 
                     VALUES (?, 'PAYOUT', ?, ?, ?, ?, 'CONFIRMED', NOW())`,
                    [liveTicket.seller_id, liveTicket.amount_ltc, liveTicket.fee_ltc, txid, ltcAddress]
                );

                await recordCompletedDeal(
                    connection,
                    liveTicket.seller_id,
                    liveTicket.amount_ltc,
                    liveTicket.amount_from || liveTicket.amount_usd || '0'
                );
                await connection.query('DELETE FROM release_confirmations WHERE ticket_id = ?', [ticketId]);
                await markReleaseJobCompleted({ ticketId, txid, connection });
                await connection.commit();
            } catch (txErr) {
                await connection.rollback();
                await markReleaseJobDbSyncRequired({
                    ticketId,
                    txid,
                    errorMessage: txErr.message
                }).catch(() => {});
                throw new Error(
                    `LTC broadcast succeeded (txid: ${txid}) but database sync failed. Ticket flagged for manual reconciliation.`
                );
            } finally {
                connection.release();
            }
            await disableClaimMessageForTicket(interaction.guild, ticketId, 'Completed');

            // Grant role after a successful completed deal.
            try {
                const [buyerRows] = await db.query(
                    'SELECT discord_id FROM users WHERE id = ?',
                    [ticket.buyer_id]
                );
                const buyerDiscordId = buyerRows[0]?.discord_id;
                if (buyerDiscordId && appConfig.roles.completedDeal) {
                    const member = await interaction.guild.members.fetch(buyerDiscordId).catch(() => null);
                    if (member && !member.roles.cache.has(appConfig.roles.completedDeal)) {
                        await member.roles.add(
                            appConfig.roles.completedDeal,
                            `Completed deal ${ticketId}`
                        );
                    }
                }
            } catch (roleErr) {
                console.error(`Role grant failed for ${ticketId}:`, roleErr.message);
            }

            const successEmbed = new EmbedBuilder()
                .setTitle(`Orbit Trade | Payout Sent`)
                .setDescription(
                    `> Ticket: \`${ticketId}\`\n` +
                    `> Route: **${formatMethodLabel(ticket.payment_method)} -> ${formatMethodLabel(ticket.receive_method)}**\n` +
                    `> Amount Sent: **${parseFloat(ticket.amount_ltc).toFixed(8)} LTC**\n` +
                    `> Buyer Address: \`${ltcAddress}\`\n` +
                    `> TXID: \`${txid}\`\n` +
                    `> Explorer: [Open Transaction](${appConfig.links.ltcExplorerBase}${txid})`
                )
                .setColor(appConfig.brand.color)
                .setFooter({ text: appConfig.text.releaseFooter })
                .setTimestamp();

            await interaction.reply({ embeds: [successEmbed] });
            await logger.logTransaction(
                interaction.client,
                {
                    title: 'On-chain Release Completed',
                    summary: 'A deal payout was completed on-chain.',
                    fields: [
                        { name: 'Ticket ID', value: ticketId, inline: true },
                        { name: 'Buyer', value: `<@${interaction.user.id}>`, inline: true },
                        { name: 'Amount Sent', value: `${parseFloat(ticket.amount_ltc).toFixed(8)} LTC`, inline: true },
                        { name: 'Route', value: `${formatMethodLabel(ticket.payment_method)} -> ${formatMethodLabel(ticket.receive_method)}`, inline: false },
                        { name: 'TXID', value: txid, inline: false },
                        { name: 'Owner Commission', value: `${feeBreakdown.ownerCommission} ${ticket.service_fee_currency || 'LTC'}`, inline: true }
                    ]
                }
            );
            const trustEmbed = new EmbedBuilder()
                .setTitle(appConfig.text.dealCompletedTitle)
                .setDescription(
                    `> Ticket: \`${ticketId}\`\n` +
                    `> Route: **${formatMethodLabel(ticket.payment_method)} -> ${formatMethodLabel(ticket.receive_method)}**\n` +
                    `> Amount: **${formatFiat(ticket.amount_usd || 0, ticket.source_currency || 'EUR')}**\n` +
                    `> Status: **Completed**\n` +
                    `> Settlement: **On-chain**\n` +
                    `> TXID: \`${txid}\``
                )
                .setColor(appConfig.brand.color)
                .setImage(appConfig.assets.trustFeedImage)
                .setFooter({ text: appConfig.text.trustFeedFooter })
                .setTimestamp();
            await logger.postTrustSummary(interaction.client, { embeds: [trustEmbed] });

            await archiveCompletedTicketWithTranscript({
                interaction,
                ticketId,
                reason: 'Deal completed automatically after on-chain payout'
            });

        } catch (err) {
            console.error('Release error:', err);
            await logger.logError(interaction.client, {
                title: 'Release Address Failed',
                summary: 'Submitting the buyer payout address or completing release failed.',
                fields: [
                    { name: 'Ticket ID', value: ticketId, inline: true },
                    { name: 'User', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Error', value: err.message, inline: false }
                ]
            });
            await interaction.reply({ 
                content: `Failed to send LTC: ${err.message}`, 
                flags: MessageFlags.Ephemeral
            });
        }
    }
};
