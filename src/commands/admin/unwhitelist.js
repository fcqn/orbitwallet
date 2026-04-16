const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { adminOnly } = require('../../config/permissions');
const { removeWhitelistByDiscordId } = require('../../core/claimWhitelist');
const { auditAdminAction } = require('../../core/adminTools');

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('unwhitelist')
        .setDescription('Admin: remove an exchanger from the no-collateral claim whitelist')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption((option) =>
            option.setName('user')
                .setDescription('Exchanger account to remove')
                .setRequired(true)
        ),

    execute: adminOnly(async (interaction) => {
        const user = interaction.options.getUser('user', true);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const result = await removeWhitelistByDiscordId(user.id);
        if (!result.user || !result.deleted) {
            await interaction.editReply({
                content: `<@${user.id}> is not currently whitelisted.`
            });
            return;
        }

        await auditAdminAction(
            interaction,
            'unwhitelist',
            `Target: <@${user.id}>\nOrbit User ID: ${result.user.id}`
        );
        await interaction.editReply({
            content: `<@${user.id}> was removed from the no-collateral whitelist.`
        });
    })
};
