const { EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../core/database');

module.exports = {
    customId: 'cancelrelease_',

    async execute(interaction) {
        const ticketId = interaction.customId.split('_')[1];

        try {
            await db.query('DELETE FROM release_confirmations WHERE ticket_id = ?', [ticketId]);

            const cancelEmbed = new EmbedBuilder()
                .setTitle('Release Cancelled')
                .setDescription(`Release for ticket **${ticketId}** has been cancelled.`)
                .setColor(0xe74c3c);

            await interaction.update({ 
                embeds: [cancelEmbed], 
                components: [] 
            });

        } catch (error) {
            console.error('Cancel release error:', error);
            await interaction.reply({ 
                content: 'Error cancelling release.', 
                flags: MessageFlags.Ephemeral 
            });
        }
    }
};