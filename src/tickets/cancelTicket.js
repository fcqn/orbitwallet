const { MessageFlags } = require('discord.js');

module.exports = {
    customId: 'cancel',

    async execute(interaction) {
        const customId = interaction.customId;
        const sessionId = customId.replace('cancel_', '');

        // Clean up session
        if (interaction.client.ticketSessions?.has(sessionId)) {
            interaction.client.ticketSessions.delete(sessionId);
        }

        await interaction.update({
            content: '❌ Cancelled.',
            embeds: [],
            components: []
        });
    }
};