const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { adminOnly } = require('../../config/permissions');
const { getWhitelistEntryByDiscordId, listWhitelistEntries } = require('../../core/claimWhitelist');
const appConfig = require('../../config/appConfig');

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('viewwhitelist')
        .setDescription('Admin: view the no-collateral claim whitelist')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption((option) =>
            option.setName('user')
                .setDescription('Optional user to check directly')
                .setRequired(false)
        ),

    execute: adminOnly(async (interaction) => {
        const user = interaction.options.getUser('user');
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (user) {
            const entry = await getWhitelistEntryByDiscordId(user.id);
            if (!entry) {
                await interaction.editReply({
                    content: `<@${user.id}> is not whitelisted.`
                });
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle('Claim Whitelist')
                .setColor(appConfig.brand.color)
                .setDescription(
                    `> User: <@${entry.discord_id}>\n` +
                    `> Orbit User ID: \`${entry.user_id}\`\n` +
                    `> Added By: ${entry.added_by ? `<@${entry.added_by}>` : 'Unknown'}`
                )
                .setTimestamp(new Date(entry.created_at || Date.now()));

            await interaction.editReply({ embeds: [embed] });
            return;
        }

        const entries = await listWhitelistEntries();
        if (!entries.length) {
            await interaction.editReply({ content: 'The whitelist is currently empty.' });
            return;
        }

        const lines = entries.slice(0, 20).map((entry) =>
            `> <@${entry.discord_id}> | Orbit ID: \`${entry.id}\` | Added By: ${entry.added_by ? `<@${entry.added_by}>` : 'Unknown'}`
        );

        const embed = new EmbedBuilder()
            .setTitle('Claim Whitelist')
            .setColor(appConfig.brand.color)
            .setDescription(lines.join('\n'))
            .setFooter({ text: entries.length > 20 ? `Showing 20 of ${entries.length} entries` : `${entries.length} whitelisted account(s)` })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    })
};
