const { SlashCommandBuilder, AttachmentBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { adminOnly } = require('../../config/permissions');
const { exportDatabase } = require('../../core/dbExport');

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('exportdb')
        .setDescription('Export the full database to a SQL file')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    execute: adminOnly(async (interaction) => {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const { outputPath, fileName, method } = await exportDatabase();
            const attachment = new AttachmentBuilder(outputPath, { name: fileName });

            await interaction.editReply({
                content: `Database export completed with ${method}: \`${fileName}\``,
                files: [attachment]
            });
        } catch (error) {
            console.error('exportdb failed:', error);
            await interaction.editReply(`Database export failed: ${error.message}`);
        }
    })
};
