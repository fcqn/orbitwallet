const { MessageFlags } = require('discord.js');
const { closeTicketWithTranscript } = require('./ticketLifecycle');

module.exports = {
    customId: 'close',

    async execute(interaction) {
        const ticketId = interaction.customId.replace('close_', '');

        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const result = await closeTicketWithTranscript({
                interaction,
                ticketId,
                reason: 'Closed via ticket button'
            });

            if (!result.ok) {
                return interaction.editReply({
                    content: result.message
                });
            }

            const transcriptText = result.transcriptSent
                ? (result.transcriptMessageUrl
                    ? `Transcript: ${result.transcriptMessageUrl}`
                    : 'Transcript saved, but no Discord message URL was returned.')
                : `Transcript failed: ${result.transcriptError || 'unknown reason'}.`;

            return interaction.editReply({
                content: `Ticket **${ticketId}** closed.\n${transcriptText}`
            });
        } catch (error) {
            console.error('close ticket button failed:', error);
            if (interaction.deferred || interaction.replied) {
                return interaction.editReply({ content: 'Failed to close ticket.' }).catch(() => {});
            }
            return interaction.reply({
                content: 'Failed to close ticket.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }
    }
};
