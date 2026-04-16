const {
    SlashCommandBuilder,
    EmbedBuilder,
    ButtonBuilder,
    ActionRowBuilder,
    ButtonStyle,
    InteractionContextType,
    MessageFlags
} = require('discord.js');
const db = require('../../core/database');
const { exchOnly } = require('../../config/permissions');
const { sendLtc } = require('../../core/walletOps');
const {
    reserveWithdrawal,
    completeWithdrawal,
    failWithdrawal
} = require('../../core/payoutSafety');
const appConfig = require('../../config/appConfig');
const logger = require('../../core/logger');
const env = require('../../config/env');
const emojis = require('../../config/emojis');

const MAX_WITHDRAWAL = env.MAX_WITHDRAWAL;
const DAILY_LIMIT = env.DAILY_LIMIT;
const UNKNOWN_INTERACTION_CODE = 10062;

function isUnknownInteractionError(error) {
    return Number(error?.code) === UNKNOWN_INTERACTION_CODE;
}

module.exports = {
    dmCapable: true,
    data: new SlashCommandBuilder()
        .setName('withdraw')
        .setDescription('Withdraw LTC from your available balance')
        .setContexts(
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        )
        .setDMPermission(true)
        .addStringOption((option) =>
            option.setName('address').setDescription('External LTC address').setRequired(true)
        )
        .addNumberOption((option) =>
            option
                .setName('amount')
                .setDescription('Amount LTC')
                .setRequired(true)
                .setMinValue(0.001)
                .setMaxValue(MAX_WITHDRAWAL)
        ),

    execute: exchOnly(async (interaction) => {
        const discordId = interaction.user.id;
        const targetAddress = interaction.options.getString('address').trim();
        const amount = interaction.options.getNumber('amount');
        const ltcRegex = /^(L|M|3|ltc1)[a-zA-Z0-9]{26,62}$/;

        if (!ltcRegex.test(targetAddress)) {
            return interaction.reply({ content: 'Invalid LTC address format.', flags: MessageFlags.Ephemeral });
        }

        try {
            const [rows] = await db.query(
                'SELECT id, balance_available, ltc_deposit_address FROM users WHERE discord_id = ?',
                [discordId]
            );
            if (!rows.length) {
                return interaction.reply({
                    content: 'You do not have a wallet yet. Use `/register` first.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const user = rows[0];
            if (targetAddress === user.ltc_deposit_address) {
                return interaction.reply({
                    content: 'You cannot withdraw to your own deposit address.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const [dailyRows] = await db.query(
                `SELECT COALESCE(SUM(amount), 0) as daily_total
                 FROM wallet_ledger
                 WHERE user_id = ?
                 AND action_type = 'WITHDRAWAL'
                 AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
                [user.id]
            );
            const dailyTotal = parseFloat(dailyRows[0].daily_total || 0);
            if (dailyTotal + amount > DAILY_LIMIT) {
                return interaction.reply({
                    content: `Daily limit exceeded. Used ${dailyTotal.toFixed(8)} / ${DAILY_LIMIT} LTC.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const fee = 0.0001;
            const totalNeeded = parseFloat((amount + fee).toFixed(8));
            if (parseFloat(user.balance_available) < totalNeeded) {
                return interaction.reply({
                    content: `Insufficient funds. Need ${totalNeeded.toFixed(8)} LTC total.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const previewEmbed = new EmbedBuilder()
                .setTitle(emojis.withEmoji('withdrawPreview', 'Orbit Trade | Withdrawal Preview'))
                .setColor(appConfig.brand.color)
                .setDescription(
                    `> Amount: \`${amount.toFixed(8)}\` LTC\n` +
                    `> Fee: \`${fee.toFixed(8)}\` LTC\n` +
                    `> Total Debit: \`${totalNeeded.toFixed(8)}\` LTC\n` +
                    `> Destination: \`${targetAddress}\``
                );

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`confirm_withdraw_${interaction.id}`)
                    .setLabel('Confirm')
                    .setEmoji(emojis.getComponent('confirmAction'))
                    .setStyle(appConfig.brand.buttonStyle),
                new ButtonBuilder()
                    .setCustomId(`cancel_withdraw_${interaction.id}`)
                    .setLabel('Cancel')
                    .setEmoji(emojis.getComponent('cancelAction'))
                    .setStyle(ButtonStyle.Danger)
            );

            await interaction.reply({ embeds: [previewEmbed], components: [row], flags: MessageFlags.Ephemeral });
            const response = await interaction.fetchReply();

            const collector = response.createMessageComponentCollector({
                filter: (i) => i.user.id === interaction.user.id,
                time: 60000
            });

            collector.on('collect', async (i) => {
                try {
                    if (i.customId === `cancel_withdraw_${interaction.id}`) {
                        collector.stop('cancelled');
                        await i.update({ content: 'Withdrawal cancelled.', embeds: [], components: [] });
                        return;
                    }

                    if (i.customId !== `confirm_withdraw_${interaction.id}`) {
                        return;
                    }

                    await i.deferUpdate();

                    let reservation;
                    try {
                        reservation = await reserveWithdrawal({
                            userId: user.id,
                            amountLtc: amount,
                            feeLtc: fee,
                            toAddress: targetAddress,
                            processedBy: interaction.user.id,
                            requestKey: `withdraw:${interaction.id}`
                        });

                        const { txid } = await sendLtc({
                            destination: targetAddress,
                            amount
                        });

                        await completeWithdrawal({
                            reservationId: reservation.reservationId,
                            txid,
                            actionType: 'WITHDRAWAL'
                        });

                        const success = new EmbedBuilder()
                            .setTitle(emojis.withEmoji('withdrawBroadcast', 'Orbit Trade | Withdrawal Broadcast'))
                            .setColor(appConfig.brand.color)
                            .setDescription(`> Sent: \`${amount.toFixed(8)}\` LTC\n> TXID: \`${txid}\``);

                        await i.editReply({ embeds: [success], components: [] });
                        collector.stop('done');

                        await logger.logWithdraw(
                            interaction.client,
                            {
                                title: 'Withdrawal Sent',
                                summary: 'A user withdrawal was broadcast successfully.',
                                fields: [
                                    { name: 'User', value: `<@${interaction.user.id}>`, inline: true },
                                    { name: 'Amount', value: `${amount.toFixed(8)} LTC`, inline: true },
                                    { name: 'Fee', value: `${fee.toFixed(8)} LTC`, inline: true },
                                    { name: 'Destination', value: targetAddress, inline: false },
                                    { name: 'TXID', value: txid, inline: false }
                                ]
                            }
                        );
                        await logger.logTransaction(
                            interaction.client,
                            {
                                title: 'Wallet Withdrawal',
                                summary: 'Funds were withdrawn from an exchanger wallet.',
                                fields: [
                                    { name: 'User', value: `<@${interaction.user.id}>`, inline: true },
                                    { name: 'Amount', value: `${amount.toFixed(8)} LTC`, inline: true },
                                    { name: 'TXID', value: txid, inline: true }
                                ]
                            }
                        );
                        await interaction.user.send({
                            embeds: [
                                new EmbedBuilder()
                                    .setTitle(emojis.withEmoji('withdrawSent', 'Orbit Trade | Withdrawal Sent'))
                                    .setColor(appConfig.brand.color)
                                    .setDescription(
                                        `> Amount: \`${amount.toFixed(8)}\` LTC\n` +
                                        `> Destination: \`${targetAddress}\`\n` +
                                        `> TXID: \`${txid}\``
                                    )
                                    .setTimestamp()
                            ]
                        }).catch(() => {});
                    } catch (error) {
                        if (reservation?.reservationId) {
                            await failWithdrawal({ reservationId: reservation.reservationId }).catch(() => {});
                        }
                        console.error('Withdraw execution error:', error);
                        await i.editReply({ content: `Withdrawal failed: ${error.message}`, embeds: [], components: [] }).catch(() => {});
                        collector.stop('error');
                    }
                } catch (error) {
                    if (isUnknownInteractionError(error)) {
                        collector.stop('stale_interaction');
                        return;
                    }

                    console.error('Withdraw interaction error:', error);
                    collector.stop('error');
                }
            });

            collector.on('end', async (_, reason) => {
                if (reason === 'time') {
                    await interaction.editReply({
                        content: 'Withdrawal request expired.',
                        embeds: [],
                        components: []
                    }).catch(() => {});
                }
            });
        } catch (error) {
            console.error('Withdraw command failed:', error);
            await logger.logError(interaction.client, {
                title: 'Withdraw Failed',
                summary: 'The withdraw command failed.',
                fields: [
                    { name: 'User', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Context', value: interaction.inGuild() ? 'Guild' : 'DM', inline: true },
                    { name: 'Error', value: error.message, inline: false }
                ]
            });
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'Withdrawal failed.' }).catch(() => {});
            } else {
                await interaction.reply({ content: 'Withdrawal failed.', flags: MessageFlags.Ephemeral }).catch(() => {});
            }
        }
    }, { allowDm: true })
};
