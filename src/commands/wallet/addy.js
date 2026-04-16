const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    InteractionContextType,
    MessageFlags
} = require('discord.js');
const db = require('../../core/database');
const { exchOnly } = require('../../config/permissions');
const appConfig = require('../../config/appConfig');
const emojis = require('../../config/emojis');

module.exports = {
    dmCapable: true,
    data: new SlashCommandBuilder()
        .setName('addy')
        .setDescription('Show your LTC deposit address')
        .setContexts(
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        )
        .setDMPermission(true),

    execute: exchOnly(async (interaction) => {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const [rows] = await db.query(
                'SELECT ltc_deposit_address FROM users WHERE discord_id = ?',
                [interaction.user.id]
            );

            if (!rows.length) {
                return interaction.editReply({
                    content: 'No wallet found. Use `/register` to create one first.'
                });
            }

            const address = rows[0].ltc_deposit_address;
            if (!address) {
                return interaction.editReply({
                    content: 'No LTC deposit address is available for this wallet yet.'
                });
            }

            const embed = new EmbedBuilder()
                .setColor(appConfig.brand.color)
                .setTitle(emojis.withEmoji('depositAddress', 'Orbit Trade | Deposit Address'))
                .setDescription(`> Your LTC deposit address is ready.\n\n\`${address}\``)
                .setFooter({
                    text: 'Orbit Trade',
                    iconURL: interaction.client.user.displayAvatarURL()
                })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`copy_addy_${interaction.id}`)
                    .setLabel('Copy Address')
                    .setEmoji(emojis.getComponent('copyAddress'))
                    .setStyle(ButtonStyle.Secondary)
            );

            await interaction.editReply({ embeds: [embed], components: [row] });
            const response = await interaction.fetchReply();
            const collector = response.createMessageComponentCollector({
                componentType: ComponentType.Button,
                filter: (i) => i.user.id === interaction.user.id,
                time: 60000
            });

            collector.on('collect', async (i) => {
                if (i.customId !== `copy_addy_${interaction.id}`) {
                    return;
                }

                await i.reply({
                    content: address,
                    flags: MessageFlags.Ephemeral
                }).catch(() => {});
            });

            collector.on('end', async () => {
                await interaction.editReply({
                    embeds: [embed],
                    components: []
                }).catch(() => {});
            });
        } catch (error) {
            console.error('Addy command failed:', error);
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({
                    content: 'Failed to fetch your LTC address.',
                    embeds: []
                }).catch(() => {});
                return;
            }

            await interaction.reply({
                content: 'Failed to fetch your LTC address.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }
    }, { allowDm: true })
};
