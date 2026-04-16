const { EmbedBuilder } = require('discord.js');
const appConfig = require('../config/appConfig');

function decorateDescription(description) {
    if (!description) return null;
    return String(description)
        .split('\n')
        .map((line) => line.trim() ? `> ${line}` : '')
        .join('\n');
}

function makeEmbed(title, description) {
    return new EmbedBuilder()
        .setTitle(title ? `Orbit Trade | ${title}` : 'Orbit Trade')
        .setDescription(decorateDescription(description))
        .setColor(appConfig.brand.color)
        .setFooter({ text: appConfig.brand.name })
        .setTimestamp();
}

module.exports = {
    makeEmbed,
    decorateDescription
};
