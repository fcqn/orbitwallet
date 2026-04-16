const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../../core/database');
const { adminOnly } = require('../../config/permissions');
const { updateClaimMessage } = require('../../tickets/claimMessage');
const claimTicketHandler = require('../../tickets/claimTicket');
const { auditAdminAction, requireExactConfirmation } = require('../../core/adminTools');

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('reassignticket')
        .setDescription('Admin: move a claimed/paid ticket from one exchanger to another')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) =>
            option.setName('ticketid')
                .setDescription('Ticket ID')
                .setRequired(true)
        )
        .addUserOption((option) =>
            option.setName('to')
                .setDescription('New exchanger account')
                .setRequired(true)
        )
        .addStringOption((option) =>
            option.setName('confirm')
                .setDescription('Type REASSIGN to confirm')
                .setRequired(true)
        ),

    execute: adminOnly(async (interaction) => {
        const ticketId = interaction.options.getString('ticketid').trim().toUpperCase();
        const newExchangerUser = interaction.options.getUser('to');
        const confirmation = interaction.options.getString('confirm').trim();

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (!(await requireExactConfirmation(interaction, confirmation, 'REASSIGN', 'Reassign ticket'))) {
            return;
        }

        const connection = await db.getConnection();
        let oldSellerDiscordId = null;
        let newSellerId = null;
        let ticket = null;
        let collateralLocked = false;

        try {
            await connection.beginTransaction();

            const [ticketRows] = await connection.query(
                'SELECT * FROM tickets WHERE ticket_id = ? FOR UPDATE',
                [ticketId]
            );
            if (!ticketRows.length) {
                await connection.rollback();
                await interaction.editReply({ content: 'Ticket not found.' });
                return;
            }

            ticket = ticketRows[0];
            ticket.total_ltc = parseFloat(ticket.total_ltc || 0);
            collateralLocked = Boolean(Number(ticket.collateral_locked || 0));

            if (!['CLAIMED', 'PAID'].includes(ticket.status)) {
                await connection.rollback();
                await interaction.editReply({ content: `Ticket must be CLAIMED or PAID. Current status: ${ticket.status}` });
                return;
            }

            if (!ticket.seller_id) {
                await connection.rollback();
                await interaction.editReply({ content: 'This ticket does not currently have an assigned exchanger.' });
                return;
            }

            const [oldSellerRows] = await connection.query(
                'SELECT discord_id FROM users WHERE id = ? FOR UPDATE',
                [ticket.seller_id]
            );
            oldSellerDiscordId = oldSellerRows[0]?.discord_id || null;

            const [newSellerRows] = await connection.query(
                'SELECT id, balance_available, is_held FROM users WHERE discord_id = ? FOR UPDATE',
                [newExchangerUser.id]
            );
            if (!newSellerRows.length) {
                await connection.rollback();
                await interaction.editReply({ content: 'The new exchanger does not have a registered profile.' });
                return;
            }

            const newSeller = newSellerRows[0];
            newSellerId = Number(newSeller.id);
            if (newSellerId === Number(ticket.seller_id)) {
                await connection.rollback();
                await interaction.editReply({ content: 'That exchanger already owns this ticket.' });
                return;
            }

            if (ticket.buyer_id === newSellerId) {
                await connection.rollback();
                await interaction.editReply({ content: 'The buyer cannot be assigned as the exchanger.' });
                return;
            }

            if (Boolean(newSeller.is_held)) {
                await connection.rollback();
                await interaction.editReply({ content: 'The target exchanger is currently on hold.' });
                return;
            }

            if (collateralLocked && parseFloat(newSeller.balance_available || 0) < ticket.total_ltc) {
                await connection.rollback();
                await interaction.editReply({ content: 'The target exchanger does not have enough available balance to take over this ticket.' });
                return;
            }

            if (collateralLocked) {
                await connection.query(
                    'UPDATE users SET balance_available = balance_available + ?, balance_escrow = GREATEST(balance_escrow - ?, 0) WHERE id = ?',
                    [ticket.total_ltc, ticket.total_ltc, ticket.seller_id]
                );
                await connection.query(
                    'UPDATE users SET balance_available = balance_available - ?, balance_escrow = balance_escrow + ? WHERE id = ?',
                    [ticket.total_ltc, ticket.total_ltc, newSellerId]
                );
            }
            await connection.query(
                'UPDATE tickets SET seller_id = ? WHERE ticket_id = ?',
                [newSellerId, ticketId]
            );
            await connection.query(
                `INSERT INTO exchanger_stats (user_id, total_deals, last_active)
                 VALUES (?, 1, NOW())
                 ON DUPLICATE KEY UPDATE total_deals = total_deals + 1, last_active = NOW()`,
                [newSellerId]
            );
            await connection.query(
                'UPDATE exchanger_stats SET total_deals = GREATEST(total_deals - 1, 0), last_active = NOW() WHERE user_id = ?',
                [ticket.seller_id]
            );
            await connection.query(
                'DELETE FROM pending_claim_confirmations WHERE ticket_id = ?',
                [ticketId]
            );

            await connection.commit();
        } catch (error) {
            await connection.rollback().catch(() => {});
            throw error;
        } finally {
            connection.release();
        }

        if (ticket?.channel_id) {
            const thread = await interaction.guild.channels.fetch(ticket.channel_id).catch(() => null);
            if (thread) {
                if (oldSellerDiscordId) {
                    await claimTicketHandler.revokeTicketAccess(thread, oldSellerDiscordId);
                }
                await claimTicketHandler.grantTicketAccess(thread, newExchangerUser.id);
                await thread.send({
                    content:
                        `Ticket **${ticketId}** was reassigned by <@${interaction.user.id}>.\n` +
                        `Previous exchanger: ${oldSellerDiscordId ? `<@${oldSellerDiscordId}>` : 'Unknown'}\n` +
                        `New exchanger: <@${newExchangerUser.id}>`
                }).catch(() => {});
            }
        }

        await updateClaimMessage(interaction.guild, ticket, 'Claimed');
        await auditAdminAction(
            interaction,
            'reassignticket',
            `Ticket: ${ticketId}\nFrom seller user ID: ${ticket.seller_id}\nTo seller user ID: ${newSellerId}`
        );
        await interaction.editReply({
            content: collateralLocked
                ? `Ticket **${ticketId}** was reassigned to <@${newExchangerUser.id}> and escrow was moved to the new exchanger.`
                : `Ticket **${ticketId}** was reassigned to <@${newExchangerUser.id}>. No collateral move was needed for this whitelisted claim.`
        });
    })
};
