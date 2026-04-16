const { SlashCommandBuilder, EmbedBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const db = require('../../core/database');
const axios = require('axios');
const env = require('../../config/env');
const { exchOnly } = require('../../config/permissions');
const { formatEur, formatEurPerLtc } = require('../../core/currency');
const appConfig = require('../../config/appConfig');
const demoStore = require('../../core/demoStore');

const PRICE_API = 'https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=eur';

module.exports = {
    dmCapable: true,
    data: new SlashCommandBuilder()
        .setName('balance')
        .setDescription('Check your Orbit Wallet balance')
        .setContexts(
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        )
        .setDMPermission(true),

    execute: exchOnly(async (interaction) => {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            let rows;
            if (env.DB_ENABLED) {
                [rows] = await db.query(
                    `SELECT id, balance_available, balance_escrow, ltc_deposit_address
                     FROM users
                     WHERE discord_id = ?`,
                    [interaction.user.id]
                );
            } else {
                const demoUser = demoStore.ensureUser(interaction.user.id, interaction.user.username);
                rows = demoUser ? [demoUser] : [];
            }

            if (!rows.length) {
                return interaction.editReply({
                    content: 'No wallet found. Use `/cwallet` to create one.'
                });
            }

            const user = rows[0];
            const availableLtc = parseFloat(user.balance_available || 0);
            const escrowLtc = parseFloat(user.balance_escrow || 0);
            const totalLtc = availableLtc + escrowLtc;

            let ltcPriceEur = 0;
            try {
                const priceRes = await axios.get(PRICE_API, { timeout: 5000 });
                ltcPriceEur = Number(priceRes.data?.litecoin?.eur || 0);
            } catch (err) {
                console.log('Price fetch failed:', err.message);
            }

            const availableEur = availableLtc * ltcPriceEur;
            const escrowEur = escrowLtc * ltcPriceEur;
            const totalEur = totalLtc * ltcPriceEur;

            const embed = new EmbedBuilder()
                .setColor(appConfig.brand.color)
                .setTitle('Orbit Trade | Wallet Balance')
                .setDescription(
                    `> Total Balance: \`${totalLtc.toFixed(8)}\` LTC\n` +
                    `> EUR Value: ${formatEur(totalEur)}\n` +
                    `> Available: \`${availableLtc.toFixed(8)}\` LTC\n` +
                    `> Available EUR: ${formatEur(availableEur)}\n` +
                    `> LTC Price: ${formatEurPerLtc(ltcPriceEur)}`
                )
                .addFields(
                    {
                        name: 'Reserved Amount',
                        value: `\`${escrowLtc.toFixed(8)}\` LTC\n${formatEur(escrowEur)}`,
                        inline: false
                    },
                    {
                        name: 'Deposit Address',
                        value: `\`${user.ltc_deposit_address || 'Not generated'}\``,
                        inline: false
                    }
                )
                .setFooter({
                    text: `${env.DB_ENABLED ? 'Orbit Trade' : 'Orbit Demo'} | Auto-Deletes in 60s`,
                    iconURL: interaction.client.user.displayAvatarURL()
                })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Balance error:', error);
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({
                    content: 'Error fetching balance.',
                    embeds: []
                }).catch(() => {});
                return;
            }

            await interaction.reply({
                content: 'Error fetching balance.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }
    }, { allowDm: true })
};
