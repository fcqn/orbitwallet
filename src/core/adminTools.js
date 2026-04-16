const { MessageFlags } = require('discord.js');
const logger = require('./logger');

async function requireExactConfirmation(interaction, actualValue, expectedValue, actionLabel) {
    if (String(actualValue || '').trim() === expectedValue) {
        return true;
    }

    await interaction.editReply({
        content: `${actionLabel} cancelled. Type \`${expectedValue}\` exactly in the confirm field.`
    });
    return false;
}

async function replyEphemeral(interaction, content) {
    const payload = { content, flags: MessageFlags.Ephemeral };

    if (interaction.deferred || interaction.replied) {
        return interaction.editReply(payload).catch(() => {});
    }

    return interaction.reply(payload).catch(() => {});
}

async function auditAdminAction(interaction, action, details) {
    const body = [
        `Admin: <@${interaction.user.id}>`,
        `Action: ${action}`,
        details
    ].filter(Boolean).join('\n');

    await logger.logAdminAction(interaction.client, body);
}

module.exports = {
    requireExactConfirmation,
    replyEphemeral,
    auditAdminAction
};
