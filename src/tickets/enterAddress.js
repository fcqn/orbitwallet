const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } = require('discord.js');

module.exports = {
    customId: 'enteraddress_',

    async execute(interaction) {
        const ticketId = interaction.customId.split('_')[1];

        const modal = new ModalBuilder()
            .setCustomId(`releaseaddress_${ticketId}`)
            .setTitle('Enter LTC Address');

        const addressInput = new TextInputBuilder()
            .setCustomId('ltc_address')
            .setLabel('Your LTC Address')
            .setPlaceholder('e.g., LTC1q... or M... or ltc1...')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMinLength(26)
            .setMaxLength(43);

        modal.addComponents(new ActionRowBuilder().addComponents(addressInput));

        await interaction.showModal(modal);
    }
};