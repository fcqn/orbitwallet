const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { adminOnly } = require('../../config/permissions');
const { closeTicketWithTranscript } = require('../../tickets/ticketLifecycle');
const { auditAdminAction, requireExactConfirmation } = require('../../core/adminTools');

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('refundticket')
        .setDescription('Admin: cancel a ticket, archive it, and unlock escrow back to the exchanger')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) =>
            option.setName('ticketid')
                .setDescription('Ticket ID')
                .setRequired(true)
        )
        .addStringOption((option) =>
            option.setName('confirm')
                .setDescription('Type REFUND to confirm')
                .setRequired(true)
        ),

    execute: adminOnly(async (interaction) => {
        const ticketId = interaction.options.getString('ticketid').trim().toUpperCase();
        const confirmation = interaction.options.getString('confirm').trim();

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (!(await requireExactConfirmation(interaction, confirmation, 'REFUND', 'Refund'))) {
            return;
        }

        const result = await closeTicketWithTranscript({
            interaction,
            ticketId,
            reason: `Refund/cancel by admin ${interaction.user.tag}`
        });

        if (!result.ok) {
            await interaction.editReply({ content: result.message });
            return;
        }

        await auditAdminAction(
            interaction,
            'refundticket',
            `Ticket: ${ticketId}\nResult: ${result.alreadyClosed ? 'Already closed' : 'Cancelled and escrow unlocked'}`
        );

        await interaction.editReply({
            content: result.alreadyClosed
                ? `Ticket **${ticketId}** was already closed.`
                : `Ticket **${ticketId}** was refunded/cancelled and any held escrow was unlocked.`
        });
    })
};
