const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SectionBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MediaGalleryBuilder,
    MessageFlags,
    ChannelType,
} = require('discord.js');
const emojis = require('../../config/emojis');
const appConfig = require('../../config/appConfig');

class ExchangePanelBuilder {
    static buildButtons() {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('novaswap_start_exchange')
                .setLabel('Start Exchange')
                .setEmoji(emojis.getComponent('panelStartExchange'))
                .setStyle(ButtonStyle.Secondary),
        );
    }

    static buildContainer() {
        return new ContainerBuilder()
            .setAccentColor(0xb68ced)
            .addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems((item) =>
                    item
                        .setDescription('Orbit Trade exchange artwork')
                        .setURL(appConfig.assets.exchangePanelImage),

                ),
            )
            .addActionRowComponents(this.buildButtons())
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Welcome to Orbit Trade'),
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `> ***${emojis.withEmoji('panelIntroPrimary', 'Orbit Trade provides seamless and secure digital asset exchanges you can rely on.')}***\n` +
                    `> ***${emojis.withEmoji('panelIntroSecondary', 'Built to deliver a fast, efficient, and user-friendly experience.')}***`,
                ),
            )
            .addSeparatorComponents(new SeparatorBuilder())
            .addSectionComponents(
                new SectionBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            emojis.withEmoji('panelTerms', 'Before getting started, we recommend reviewing our [Exchange Terms](https://example/exchange) and [Guidelines](https://discord.com/channels/1474834585626870021/1474837358619922443) to ensure everything runs smoothly and securely.'),
                        ),
                    )
                    .setButtonAccessory(
                        new ButtonBuilder()
                            .setLabel('Learn More')
                            .setEmoji(emojis.getComponent('panelLearnMore'))
                            .setStyle(ButtonStyle.Link)
                            .setURL('https://orbittrade.org/'),
                    ),
            )
            .addSeparatorComponents(new SeparatorBuilder())
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### ${emojis.withEmoji('panelReady', 'Ready to Begin Your Exchange?')}\n> -#  Start your exchange process or reach out for assistance below.`,
                ),
            );
    }

    static async create(channel) {
        return channel.send({
            components: [this.buildContainer()],
            flags: MessageFlags.IsComponentsV2,
        });
    }
}

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('exchange')
        .setDescription('Orbit Trade exchange panel commands')
        .addSubcommand((subcommand) =>
            subcommand
                .setName('panel')
                .setDescription('Send the Orbit Trade exchange intro panel')
                .addChannelOption((option) =>
                    option
                        .setName('channel')
                        .setDescription('The channel where the panel should be sent')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
                ),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand !== 'panel') {
            await interaction.reply({
                content: 'That subcommand is not available yet.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

        if (!targetChannel || !targetChannel.isTextBased()) {
            await interaction.reply({
                content: 'That channel cannot receive this panel.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await ExchangePanelBuilder.create(targetChannel);
        await interaction.editReply({ content: `Panel created in ${targetChannel}.` });
    },
};
