const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { staffOnly } = require('../../config/permissions');
const { closeTicketWithTranscript } = require('../../tickets/ticketLifecycle');

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('close')
        .setDescription('Close a deal ticket and archive its thread with transcript')
        .setDefaultMemberPermissions('0')
        .addStringOption((option) =>
            option
                .setName('ticketid')
                .setDescription('Ticket ID (example: ORBIT-ABC123)')
                .setRequired(true)
        ),

    execute: staffOnly(async (interaction) => {
        const ticketId = interaction.options.getString('ticketid').trim().toUpperCase();
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const result = await closeTicketWithTranscript({
            interaction,
            ticketId,
            reason: `Closed via /close by ${interaction.user.tag}`
        });

        if (!result.ok) {
            return interaction.editReply({ content: result.message });
        }

        const transcriptText = result.transcriptSent
            ? (result.transcriptMessageUrl
                ? `Transcript: ${result.transcriptMessageUrl}`
                : 'Transcript saved, but no Discord message URL was returned.')
            : `Transcript failed: ${result.transcriptError || 'unknown reason'}.`;

        return interaction.editReply({
            content: `Ticket **${ticketId}** closed.\n${transcriptText}`
        });
    })
};
