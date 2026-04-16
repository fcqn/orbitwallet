const {
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    ActionRowBuilder,
    ButtonBuilder
} = require('discord.js');
const appConfig = require('../config/appConfig');

function makeTicketContainer(title, lines = [], rows = []) {
    const container = new ContainerBuilder().setAccentColor(appConfig.brand.color);

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## ${title}`)
    );

    if (lines.length) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(lines.join('\n'))
        );
    }

    if (rows.length) {
        container.addSeparatorComponents(new SeparatorBuilder());
        for (const row of rows) {
            container.addActionRowComponents(row);
        }
    }

    return container;
}

function makeSingleButtonRow({ customId, label, style, disabled = false }) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(customId)
            .setLabel(label)
            .setStyle(style)
            .setEmoji(arguments[0].emoji || undefined)
            .setDisabled(disabled)
    );
}

module.exports = {
    makeTicketContainer,
    makeSingleButtonRow
};
