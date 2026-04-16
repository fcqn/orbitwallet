const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../../core/database');
const { adminOnly } = require('../../config/permissions');
const { sendLtc } = require('../../core/walletOps');
const logger = require('../../core/logger');
const appConfig = require('../../config/appConfig');
const { formatFiat } = require('../../core/currency');
const { formatMethodLabel } = require('../../core/displayLabels');
const { disableClaimMessageForTicket } = require('../../tickets/claimMessage');
const { applyHiddenOwnerCommission } = require('../../core/marketplaceFees');
const { recordCompletedDeal } = require('../../core/exchangerStats');
const { auditAdminAction } = require('../../core/adminTools');
const {
    beginReleaseJob,
    markReleaseJobFailed,
    markReleaseJobDbSyncRequired,
    markReleaseJobCompleted
} = require('../../core/payoutSafety');

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('forcerelease')
        .setDescription('Admin: force complete/release a ticket')
        .setDefaultMemberPermissions('0')
        .addStringOption((option) =>
            option.setName('ticketid').setDescription('Ticket ID').setRequired(true)
        )
        .addStringOption((option) =>
            option.setName('address').setDescription('Buyer LTC address (required for LTC payouts)').setRequired(false)
        ),

    execute: adminOnly(async (interaction) => {
        const ticketId = interaction.options.getString('ticketid').trim().toUpperCase();
        const address = interaction.options.getString('address')?.trim() || null;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const [tickets] = await db.query('SELECT * FROM tickets WHERE ticket_id = ?', [ticketId]);
            if (!tickets.length) return interaction.editReply('Ticket not found.');

            const ticket = tickets[0];
            const collateralLocked = Boolean(Number(ticket.collateral_locked || 0));
            if (!['CLAIMED', 'PAID'].includes(ticket.status)) {
                return interaction.editReply(`Ticket must be CLAIMED/PAID. Current: ${ticket.status}`);
            }

            const needsOnchain = !ticket.receive_method || ticket.receive_method.toUpperCase().includes('LTC');
            let txid = null;
            const amount = parseFloat(ticket.amount_ltc);
            if (needsOnchain) {
                if (!address) {
                    return interaction.editReply('Address is required for LTC payout deals.');
                }
                await beginReleaseJob({
                    ticketId,
                    initiatedBy: interaction.user.id,
                    ltcAddress: address,
                    amountLtc: amount
                });
                try {
                    const result = await sendLtc({
                        destination: address,
                        amount
                    });
                    txid = result.txid;
                } catch (sendError) {
                    await markReleaseJobFailed({ ticketId, errorMessage: sendError.message }).catch(() => {});
                    throw sendError;
                }
            }

            const connection = await db.getConnection();
            let feeBreakdown;
            try {
                await connection.beginTransaction();
                const [ticketRows] = await connection.query(
                    'SELECT * FROM tickets WHERE ticket_id = ? FOR UPDATE',
                    [ticketId]
                );
                if (!ticketRows.length) {
                    throw new Error('Ticket not found during force release finalization');
                }
                const liveTicket = ticketRows[0];
                if (liveTicket.status === 'RELEASED') {
                    if (needsOnchain && txid) {
                        await markReleaseJobCompleted({ ticketId, txid, connection });
                    }
                    await connection.commit();
                    return interaction.editReply('Ticket is already released.');
                }

                feeBreakdown = await applyHiddenOwnerCommission(connection, {
                    ticketId,
                    exchangerId: liveTicket.seller_id,
                    serviceFeeAmount: liveTicket.service_fee_amount || liveTicket.fee_ltc,
                    serviceFeeCurrency: liveTicket.service_fee_currency || (needsOnchain ? 'LTC' : (liveTicket.source_currency || 'EUR'))
                });

                if (needsOnchain) {
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
                        [address, txid, feeBreakdown.ownerCommission, feeBreakdown.exchangerProfit, ticketId]
                    );
                    await connection.query(
                        `INSERT INTO wallet_ledger (user_id, action_type, amount, fee_amount, txid, to_address, status, created_at)
                         VALUES (?, 'PAYOUT', ?, ?, ?, ?, 'CONFIRMED', NOW())`,
                        [liveTicket.seller_id, liveTicket.amount_ltc, liveTicket.fee_ltc, txid, address]
                    );
                    await recordCompletedDeal(
                        connection,
                        liveTicket.seller_id,
                        liveTicket.amount_ltc,
                        liveTicket.amount_from || liveTicket.amount_usd || '0'
                    );
                    await markReleaseJobCompleted({ ticketId, txid, connection });
                } else {
                    if (collateralLocked) {
                        await connection.query(
                            'UPDATE users SET balance_available = balance_available + ?, balance_escrow = GREATEST(balance_escrow - ?, 0) WHERE id = ?',
                            [liveTicket.total_ltc, liveTicket.total_ltc, liveTicket.seller_id]
                        );
                    }
                    await connection.query(
                        `UPDATE tickets
                         SET status = "RELEASED",
                             released_at = NOW(),
                             collateral_locked = 0,
                             owner_commission_amount = ?,
                             exchanger_profit_amount = ?,
                             fee_processed_at = NOW()
                         WHERE ticket_id = ?`,
                        [feeBreakdown.ownerCommission, feeBreakdown.exchangerProfit, ticketId]
                    );
                    await recordCompletedDeal(
                        connection,
                        liveTicket.seller_id,
                        liveTicket.amount_ltc,
                        liveTicket.amount_from || liveTicket.amount_usd || '0'
                    );
                }

                await connection.query('DELETE FROM release_confirmations WHERE ticket_id = ?', [ticketId]);
                await connection.commit();
            } catch (txErr) {
                await connection.rollback();
                if (needsOnchain && txid) {
                    await markReleaseJobDbSyncRequired({
                        ticketId,
                        txid,
                        errorMessage: txErr.message
                    }).catch(() => {});
                    throw new Error(
                        `LTC broadcast succeeded (txid: ${txid}) but database sync failed. Ticket flagged for manual reconciliation.`
                    );
                }
                throw txErr;
            } finally {
                connection.release();
            }
            await disableClaimMessageForTicket(interaction.guild, ticketId, 'Completed');

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
                            `Force release completed for ${ticketId}`
                        );
                    }
                }
            } catch (roleErr) {
                console.error(`Force release role grant failed (${ticketId}):`, roleErr.message);
            }

            await interaction.editReply(
                needsOnchain
                    ? `Force release done. txid: \`${txid}\``
                    : 'Force release done (off-chain completion, no LTC payout transaction).'
            );
            await logger.logTransaction(
                interaction.client,
                needsOnchain
                    ? `FORCE_RELEASE | ticket **${ticketId}** | by <@${interaction.user.id}> | tx \`${txid}\` | owner commission ${feeBreakdown.ownerCommission} ${ticket.service_fee_currency || 'LTC'}`
                    : `FORCE_RELEASE (OFFCHAIN) | ticket **${ticketId}** | by <@${interaction.user.id}> | owner commission ${feeBreakdown.ownerCommission} ${ticket.service_fee_currency || ticket.source_currency || 'EUR'}`
            );
            await auditAdminAction(
                interaction,
                'forcerelease',
                `Ticket: ${ticketId}\nSettlement: ${txid ? 'On-chain' : 'Off-chain'}${txid ? `\nTXID: ${txid}` : ''}`
            );
            const trustDescription =
                `> Ticket: \`${ticketId}\`\n` +
                `> Route: **${formatMethodLabel(ticket.payment_method)} -> ${formatMethodLabel(ticket.receive_method)}**\n` +
                `> Amount: **${formatFiat(ticket.amount_usd || 0, ticket.source_currency || 'EUR')}**\n` +
                `> Status: **Completed**\n` +
                `> Settlement: **${txid ? 'On-chain' : 'Off-chain'}**` +
                (txid ? `\n> TXID: \`${txid}\`` : '');
            await logger.postTrustSummary(interaction.client, {
                embeds: [{
                    title: appConfig.text.dealCompletedTitle,
                    description: trustDescription,
                    color: appConfig.brand.color,
                    footer: { text: appConfig.text.trustFeedFooter },
                    image: { url: appConfig.assets.trustFeedImage },
                    timestamp: new Date().toISOString()
                }]
            });
        } catch (error) {
            console.error('forcerelease failed:', error);
            await logger.logError(interaction.client, `forcerelease failed for ${ticketId}: \`${error.message}\``);
            await interaction.editReply(`Force release failed: ${error.message}`);
        }
    })
};
