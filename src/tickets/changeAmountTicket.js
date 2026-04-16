const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    MessageFlags
} = require('discord.js');
const db = require('../core/database');

module.exports = {
    customId: 'change_amount',

    async execute(interaction) {
        const ticketId = interaction.customId.replace('change_amount_', '');

        try {
            const [tickets] = await db.query(
                `SELECT t.ticket_id, t.status, u.discord_id as buyer_discord_id
                 FROM tickets t
                 JOIN users u ON u.id = t.buyer_id
                 WHERE t.ticket_id = ?`,
                [ticketId]
            );

            if (!tickets.length) {
                return interaction.reply({
                    content: 'Ticket not found.',
                    flags: MessageFlags.Ephemeral
                });
            }

            if (tickets[0].status !== 'OPEN') {
                return interaction.reply({
                    content: 'Amount can only be changed before the ticket is claimed.',
                    flags: MessageFlags.Ephemeral
                });
            }

            if (tickets[0].buyer_discord_id !== interaction.user.id) {
                return interaction.reply({
                    content: 'Only the ticket opener can change the amount.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const modal = new ModalBuilder()
                .setCustomId(`changeamountmodal_${ticketId}`)
                .setTitle(`Change Amount - ${ticketId}`);

            const sourceCurrency = String(tickets[0].source_currency || 'EUR').toUpperCase();

            const amountInput = new TextInputBuilder()
                .setCustomId('new_amount_usd')
                .setLabel(`New Amount (${sourceCurrency})`)
                .setPlaceholder('Example: 250')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(10);

            modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
            await interaction.showModal(modal);
        } catch (error) {
            console.error('change amount button failed:', error);
            await interaction.reply({
                content: 'Unable to open amount form right now.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }
    }
};
