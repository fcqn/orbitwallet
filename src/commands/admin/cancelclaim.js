const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../../core/database');
const { exchOnly, hasAdmin } = require('../../config/permissions');
const { restoreClaimMessage } = require('../../tickets/claimMessage');
const claimTicketHandler = require('../../tickets/claimTicket');
const { auditAdminAction, requireExactConfirmation } = require('../../core/adminTools');

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('cancelclaim')
        .setDescription('Cancel your pending claim and restore ticket availability if no funds are locked')
        .setDefaultMemberPermissions(PermissionFlagsBits.ViewChannel)
        .addStringOption((option) =>
            option.setName('ticketid')
                .setDescription('Ticket ID')
                .setRequired(true)
        )
        .addStringOption((option) =>
            option.setName('confirm')
                .setDescription('Type CANCEL to confirm')
                .setRequired(true)
        ),

    execute: exchOnly(async (interaction) => {
        const ticketId = interaction.options.getString('ticketid').trim().toUpperCase();
        const confirmation = interaction.options.getString('confirm').trim();

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (!(await requireExactConfirmation(interaction, confirmation, 'CANCEL', 'Cancel claim'))) {
            return;
        }

        const connection = await db.getConnection();
        let sellerDiscordId = null;
        let ticket = null;

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

            // Never allow cancelclaim once escrow has been locked or the ticket moved past OPEN.
            if (ticket.status !== 'OPEN' || ticket.seller_id) {
                await connection.rollback();
                await interaction.editReply({
                    content: 'This claim cannot be cancelled because funds are already locked or the ticket is no longer open.'
                });
                return;
            }

            const [pendingRows] = await connection.query(
                'SELECT seller_id FROM pending_claim_confirmations WHERE ticket_id = ? FOR UPDATE',
                [ticketId]
            );
            if (!pendingRows.length) {
                await connection.rollback();
                await interaction.editReply({ content: 'No pending claim exists for that ticket.' });
                return;
            }

            const [sellerRows] = await connection.query(
                'SELECT discord_id FROM users WHERE id = ? LIMIT 1',
                [pendingRows[0].seller_id]
            );
            sellerDiscordId = sellerRows[0]?.discord_id || null;

            const isAdminUser = hasAdmin(interaction.member);
            if (!isAdminUser && interaction.user.id !== sellerDiscordId) {
                await connection.rollback();
                await interaction.editReply({
                    content: 'Only the exchanger who started this pending claim or an admin can cancel it.'
                });
                return;
            }

            await connection.query('DELETE FROM pending_claim_confirmations WHERE ticket_id = ?', [ticketId]);
            await connection.commit();
        } catch (error) {
            await connection.rollback().catch(() => {});
            throw error;
        } finally {
            connection.release();
        }

        if (ticket?.status === 'OPEN') {
            await restoreClaimMessage(interaction.guild, ticket);
        }

        if (ticket?.channel_id && sellerDiscordId) {
            const thread = await interaction.guild.channels.fetch(ticket.channel_id).catch(() => null);
            if (thread) {
                await claimTicketHandler.revokeTicketAccess(thread, sellerDiscordId);
            }
        }

        await auditAdminAction(interaction, 'cancelclaim', `Ticket: ${ticketId}`);
        await interaction.editReply({
            content: `Pending claim cleared for **${ticketId}**. The claim button has been restored in deals.`
        });
    })
};
