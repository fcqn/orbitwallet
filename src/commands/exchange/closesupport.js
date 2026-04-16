const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { staffOnly } = require('../../config/permissions');
const { createTranscriptAttachment } = require('../../core/transcript');
const { makeEmbed } = require('../../core/ui');
const logger = require('../../core/logger');

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('closesupport')
        .setDescription('Close current support thread and save transcript')
        .setDefaultMemberPermissions('0'),

    execute: staffOnly(async (interaction) => {
        const thread = interaction.channel;
        if (!thread?.isThread?.()) {
            return interaction.reply({
                content: 'Use this command inside a support thread.',
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const transcript = await createTranscriptAttachment(thread, thread.name || thread.id);
            const payload = {
                embeds: [
                    makeEmbed(
                        `Support Transcript - ${thread.name}`,
                        `Closed by <@${interaction.user.id}>`
                    )
                ],
                files: [transcript]
            };
            await logger.logSupportClose(interaction.client, payload);

            if (!thread.archived) await thread.setArchived(true, 'Support closed');
            if (!thread.locked) await thread.setLocked(true, 'Support closed');

            await interaction.editReply('Support thread closed and transcript logged.');
        } catch (error) {
            console.error('closesupport failed:', error);
            await logger.logError(interaction.client, `closesupport failed: \`${error.message}\``);
            await interaction.editReply(`Failed to close support thread: ${error.message}`);
        }
    })
};
