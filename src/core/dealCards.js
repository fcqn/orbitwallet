const {
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder
} = require('discord.js');
const appConfig = require('../config/appConfig');
const emojis = require('../config/emojis');

function buildDealThreadCard({
    ticketId,
    paymentMethod,
    receiveMethod,
    amountFromLabel,
    amountToLabel,
    serviceFeeLabel,
    includeControls = true
}) {
    const container = new ContainerBuilder()
        .setAccentColor(appConfig.brand.color)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## Orbit Trade Ticket\n` +
                `> Ticket: \`${ticketId}\`\n` +
                `> Flow: **${paymentMethod} -> ${receiveMethod}**`
            )
        )
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `> Amount From: **${amountFromLabel}**\n` +
                `> Amount To: **${amountToLabel}**\n` +
                `> Service Fee: **${serviceFeeLabel}**`
            )
        );

    if (includeControls) {
        container
            .addSeparatorComponents(new SeparatorBuilder())
            .addActionRowComponents(
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`change_amount_${ticketId}`)
                        .setLabel('Change Amount')
                        .setEmoji(emojis.getComponent('dealChangeAmount'))
                        .setStyle(appConfig.brand.buttonStyle),
                    new ButtonBuilder()
                        .setCustomId(`support_${ticketId}`)
                        .setLabel('Request Support')
                        .setEmoji(emojis.getComponent('dealSupport'))
                        .setStyle(appConfig.brand.buttonStyle),
                    new ButtonBuilder()
                        .setCustomId(`close_${ticketId}`)
                        .setLabel('Close Ticket')
                        .setEmoji(emojis.getComponent('dealClose'))
                        .setStyle(ButtonStyle.Danger)
                )
            );
    }

    return container;
}

function buildClaimActionRow({
    ticketId,
    buttonLabel = 'Claim Ticket',
    disabled = false
}) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`claim_${ticketId}`)
            .setLabel(buttonLabel)
            .setEmoji(emojis.getComponent('dealClaim'))
            .setStyle(appConfig.brand.buttonStyle)
            .setDisabled(disabled)
    );
}

function buildClaimCard({
    ticketId,
    buyerMention,
    amountFromLabel,
    amountToLabel,
    paymentMethod,
    receiveMethod,
    collateralLabel,
    serviceFeeLabel
}) {
    return new EmbedBuilder()
        .setColor(appConfig.brand.color)
        .setTitle('Orbit Trade Ticket')
        .setDescription(
            `> Ticket: \`${ticketId}\`\n` +
            `> Buyer: ${buyerMention}\n` +
            `> Amount From: **${amountFromLabel}**\n` +
            `> Amount To: **${amountToLabel}**\n` +
            `> Payment: **${paymentMethod}**\n` +
            `> Receive: **${receiveMethod}**\n` +
            `> Collateral Lock: **${collateralLabel}**\n` +
            `> Service Fee: **${serviceFeeLabel}**`
        )
        .setImage(appConfig.assets.claimTicketImage);
}

module.exports = {
    buildDealThreadCard,
    buildClaimCard,
    buildClaimActionRow
};
