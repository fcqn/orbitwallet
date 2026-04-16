const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, MessageFlags } = require('discord.js');
const db = require('../core/database');
const appConfig = require('../config/appConfig');
const logger = require('../core/logger');
const { formatFiat } = require('../core/currency');
const { formatMethodLabel } = require('../core/displayLabels');
const { disableClaimMessageForTicket } = require('./claimMessage');
const { applyHiddenOwnerCommission } = require('../core/marketplaceFees');
const { recordCompletedDeal } = require('../core/exchangerStats');
const { makeTicketContainer } = require('../core/ticketVisuals');
const { archiveCompletedTicketWithTranscript } = require('./ticketLifecycle');
const emojis = require('../config/emojis');

function needsOnchainLtcPayout(receiveMethod) {
    if (!receiveMethod) return true; // Backward compatibility for old tickets
    return receiveMethod.toUpperCase().includes('LTC');
}

module.exports = {
    customId: 'confirmrelease_',

    async execute(interaction) {
        const parts = interaction.customId.split('_');
        const ticketId = parts[1];
        const role = parts[2]; // 'exchanger' or 'buyer'

        try {
            // Get confirmation state
            const [confirms] = await db.query(
                'SELECT * FROM release_confirmations WHERE ticket_id = ?',
                [ticketId]
            );

            if (confirms.length === 0) {
                return interaction.reply({ 
                    content: 'Release confirmation expired.', 
                    flags: MessageFlags.Ephemeral 
                });
            }

            const confirm = confirms[0];

            const [ticketRows] = await db.query(
                'SELECT buyer_id, seller_id FROM tickets WHERE ticket_id = ?',
                [ticketId]
            );
            if (!ticketRows.length) {
                return interaction.reply({
                    content: 'Ticket not found for this confirmation.',
                    flags: MessageFlags.Ephemeral
                });
            }
            const ticketRow = ticketRows[0];

            const [buyerRows] = await db.query(
                'SELECT discord_id FROM users WHERE id = ?',
                [ticketRow.buyer_id]
            );
            const [sellerRows] = await db.query(
                'SELECT discord_id FROM users WHERE id = ?',
                [ticketRow.seller_id]
            );
            const buyerDiscordIdForRoleCheck = buyerRows[0]?.discord_id;
            const sellerDiscordIdForRoleCheck = sellerRows[0]?.discord_id;

            if (role === 'buyer' && interaction.user.id !== buyerDiscordIdForRoleCheck) {
                return interaction.reply({
                    content: 'Only the buyer can confirm as buyer.',
                    flags: MessageFlags.Ephemeral
                });
            }
            if (role === 'exchanger' && interaction.user.id !== sellerDiscordIdForRoleCheck) {
                return interaction.reply({
                    content: 'Only the assigned exchanger can confirm as exchanger.',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Update confirmation
            if (role === 'exchanger') {
                await db.query(
                    'UPDATE release_confirmations SET exchanger_confirmed = TRUE WHERE ticket_id = ?',
                    [ticketId]
                );
                confirm.exchanger_confirmed = true;
            } else {
                await db.query(
                    'UPDATE release_confirmations SET buyer_confirmed = TRUE WHERE ticket_id = ?',
                    [ticketId]
                );
                confirm.buyer_confirmed = true;
            }

            // FIX: Convert to Boolean() for setDisabled
            const newRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`confirmrelease_${ticketId}_exchanger`)
                        .setLabel(Boolean(confirm.exchanger_confirmed) ? 'Exchanger Confirmed' : 'Confirm Release (Exchanger)')
                        .setEmoji(emojis.getComponent('releaseConfirmExchanger'))
                        .setStyle(appConfig.brand.buttonStyle)
                        .setDisabled(Boolean(confirm.exchanger_confirmed)),
                    new ButtonBuilder()
                        .setCustomId(`confirmrelease_${ticketId}_buyer`)
                        .setLabel(Boolean(confirm.buyer_confirmed) ? 'Buyer Confirmed' : 'Confirm Release (Buyer)')
                        .setEmoji(emojis.getComponent('releaseConfirmBuyer'))
                        .setStyle(appConfig.brand.buttonStyle)
                        .setDisabled(Boolean(confirm.buyer_confirmed))
                );

            // Check if both confirmed - FIX: Use Boolean() here too
            const bothConfirmed = Boolean(confirm.exchanger_confirmed) && Boolean(confirm.buyer_confirmed);

            if (!bothConfirmed) {
                await interaction.update({
                    components: [
                        makeTicketContainer(
                            emojis.withEmoji('releaseWarning', 'Release Confirmation'),
                            [`> Ticket: \`${ticketId}\``, '> Waiting for both parties to confirm.'],
                            [newRow]
                        )
                    ]
                });
                return;
            }

            await interaction.update({
                components: [
                    makeTicketContainer(
                        emojis.withEmoji('releaseConfirmed', 'Release Confirmed'),
                        [
                            `> Ticket: \`${ticketId}\``,
                            '> Both buyer and exchanger confirmed the release.',
                            '> Preparing the payout step now.'
                        ]
                    )
                ]
            });

            // Get ticket info
            const [tickets] = await db.query(
                'SELECT * FROM tickets WHERE ticket_id = ?',
                [ticketId]
            );
            const ticket = tickets[0];
            const collateralLocked = Boolean(Number(ticket.collateral_locked || 0));

            // Get buyer discord id
            const [buyerRowsForTicket] = await db.query(
                'SELECT discord_id FROM users WHERE id = ?',
                [ticket.buyer_id]
            );
            const buyerDiscordId = buyerRowsForTicket[0].discord_id;
            const ticketChannel = await interaction.guild.channels.fetch(ticket.channel_id);
            const onchainLtc = needsOnchainLtcPayout(ticket.receive_method);

            // Non-LTC receiving side: no blockchain payout, just finalize and unlock collateral
            if (!onchainLtc) {
                const connection = await db.getConnection();
                let feeBreakdown;
                try {
                    await connection.beginTransaction();
                    feeBreakdown = await applyHiddenOwnerCommission(connection, {
                        ticketId,
                        exchangerId: ticket.seller_id,
                        serviceFeeAmount: ticket.service_fee_amount,
                        serviceFeeCurrency: ticket.service_fee_currency || ticket.source_currency || 'EUR'
                    });
                    if (collateralLocked) {
                        await connection.query(
                            `UPDATE users
                                 SET balance_available = balance_available + ?, balance_escrow = GREATEST(balance_escrow - ?, 0)
                                 WHERE id = ?`,
                            [ticket.total_ltc, ticket.total_ltc, ticket.seller_id]
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
                        ticket.seller_id,
                        ticket.amount_ltc,
                        ticket.amount_from || ticket.amount_usd || '0'
                    );
                    await connection.query('DELETE FROM release_confirmations WHERE ticket_id = ?', [ticketId]);
                    await connection.commit();
                } catch (txErr) {
                    await connection.rollback();
                    throw txErr;
                } finally {
                    connection.release();
                }

                try {
                    if (buyerDiscordId && appConfig.roles.completedDeal) {
                        const member = await interaction.guild.members.fetch(buyerDiscordId).catch(() => null);
                        if (member && !member.roles.cache.has(appConfig.roles.completedDeal)) {
                            await member.roles.add(appConfig.roles.completedDeal, `Completed deal ${ticketId}`);
                        }
                    }
                } catch (roleErr) {
                    console.error(`Role grant failed for ${ticketId}:`, roleErr.message);
                }

                const doneEmbed = new EmbedBuilder()
                    .setTitle(emojis.withEmoji('dealCompleted', 'Orbit Trade | Deal Completed'))
                    .setDescription(
                        `> Ticket: \`${ticketId}\`\n` +
                        `> Route: **${formatMethodLabel(ticket.payment_method)} -> ${formatMethodLabel(ticket.receive_method)}**\n` +
                        `> Settlement: **Off-chain**\n` +
                        `> Status: **Completed**\n` +
                        (collateralLocked
                            ? '> Exchanger collateral has been unlocked automatically.'
                            : '> No exchanger collateral was locked for this ticket.')
                    )
                    .setColor(appConfig.brand.color)
                    .setFooter({ text: 'Orbit Release' })
                    .setTimestamp();

                await ticketChannel.send({
                    content: `<@${buyerDiscordId}> <@${interaction.user.id}>`,
                    embeds: [doneEmbed]
                });
                await disableClaimMessageForTicket(interaction.guild, ticketId, 'Completed');

                const trustEmbed = new EmbedBuilder()
                    .setTitle(emojis.withEmoji('dealCompleted', 'Orbit Trade | Deal Completed'))
                    .setDescription(
                        `> Ticket: \`${ticketId}\`\n` +
                        `> Route: **${formatMethodLabel(ticket.payment_method)} -> ${formatMethodLabel(ticket.receive_method)}**\n` +
                        `> Amount: **${formatFiat(ticket.amount_usd || 0, ticket.source_currency || 'EUR')}**\n` +
                        `> Status: **Completed**\n` +
                        `> Settlement: **Off-chain**`
                    )
                    .setColor(appConfig.brand.color)
                    .setImage(appConfig.assets.trustFeedImage)
                    .setFooter({ text: 'Orbit Trust Feed' })
                    .setTimestamp();
                await logger.postTrustSummary(interaction.client, { embeds: [trustEmbed] });
                await logger.logTransaction(
                    interaction.client,
                    `RELEASE (OFFCHAIN) | ticket **${ticketId}** | collateral unlocked ${parseFloat(ticket.total_ltc).toFixed(8)} LTC | service fee ${ticket.service_fee_amount} ${ticket.service_fee_currency || ticket.source_currency || 'EUR'} | owner commission ${feeBreakdown.ownerCommission} ${ticket.service_fee_currency || ticket.source_currency || 'EUR'}`
                );

                await archiveCompletedTicketWithTranscript({
                    interaction,
                    ticketId,
                    reason: 'Deal completed automatically after off-chain release'
                });

                return;
            }

            // Send final confirmation embed and ask for address
            const addressRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`enteraddress_${ticketId}`)
                        .setLabel('Enter LTC Address')
                        .setEmoji(emojis.getComponent('payoutAddress'))
                        .setStyle(appConfig.brand.buttonStyle)
                );

            await ticketChannel.send({
                components: [
                    makeTicketContainer(
                        emojis.withEmoji('payoutAddress', 'Payout Address Needed'),
                        [
                            `> Ticket: \`${ticketId}\``,
                            `> Buyer: <@${buyerDiscordId}>`,
                            `> Amount to Send: **${parseFloat(ticket.amount_ltc).toFixed(8)} LTC**`,
                            `> Network Fee: **${parseFloat(ticket.fee_ltc).toFixed(8)} LTC**`
                        ],
                        [addressRow]
                    )
                ],
                flags: MessageFlags.IsComponentsV2
            });

        } catch (error) {
            console.error('Release confirm error:', error);
            await interaction.reply({ 
                content: 'Error processing confirmation.', 
                flags: MessageFlags.Ephemeral 
            });
        }
    }
};
