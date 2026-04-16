const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { adminOnly } = require('../../config/permissions');
const { addWhitelistByDiscordId, getWhitelistEntryByDiscordId } = require('../../core/claimWhitelist');
const { auditAdminAction } = require('../../core/adminTools');

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('whitelist')
        .setDescription('Admin: allow an exchanger to claim tickets without collateral lock')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption((option) =>
            option.setName('user')
                .setDescription('Exchanger account to whitelist')
                .setRequired(true)
        ),

    execute: adminOnly(async (interaction) => {
        const user = interaction.options.getUser('user', true);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const existing = await getWhitelistEntryByDiscordId(user.id);
        if (existing) {
            await interaction.editReply({
                content: `<@${user.id}> is already whitelisted for no-collateral claims.`
            });
            return;
        }

        const storedUser = await addWhitelistByDiscordId(user.id, interaction.user.id);
        await auditAdminAction(
            interaction,
            'whitelist',
            `Target: <@${user.id}>\nOrbit User ID: ${storedUser.id}`
        );
        await interaction.editReply({
            content: `<@${user.id}> is now whitelisted and can claim tickets without collateral lock.`
        });
    })
};
