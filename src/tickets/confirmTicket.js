const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    PermissionFlagsBits,
    MessageFlags,
    EmbedBuilder
} = require('discord.js');
const session = require('../core/session');
const db = require('../core/database');
const env = require('../config/env');
const appConfig = require('../config/appConfig');
const logger = require('../core/logger');
const demoStore = require('../core/demoStore');
const { formatFiat } = require('../core/currency');
const { formatMethodLabel } = require('../core/displayLabels');
const { compareDecimal } = require('../core/marketplaceFees');
const { buildDealThreadCard, buildClaimCard, buildClaimActionRow } = require('../core/dealCards');
const { makeTicketContainer } = require('../core/ticketVisuals');
const UNKNOWN_INTERACTION_CODE = 10062;

async function createFallbackDealChannel({ guild, ticketId, buyerUserId, botUserId, appConfig }) {
    const permissionOverwrites = [
        {
            id: guild.id,
            deny: [PermissionFlagsBits.ViewChannel]
        },
        {
            id: botUserId,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.SendMessagesInThreads,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ManageMessages
            ]
        },
        {
            id: buyerUserId,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.SendMessagesInThreads,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.ReadMessageHistory
            ]
        }
    ];

    if (appConfig.roles.exchanger) {
        permissionOverwrites.push({
            id: appConfig.roles.exchanger,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.SendMessagesInThreads,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.ReadMessageHistory
            ]
        });
    }

    if (appConfig.roles.support) {
        permissionOverwrites.push({
            id: appConfig.roles.support,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.SendMessagesInThreads,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.ReadMessageHistory
            ]
        });
    }

    return guild.channels.create({
        name: `deal-${ticketId.toLowerCase()}`,
        type: ChannelType.GuildText,
        parent: process.env.TICKET_CATEGORY_ID || null,
        permissionOverwrites,
        reason: `Fallback deal channel for ${ticketId}`
    });
}

async function grantDealAccess(channel, userId) {
    if (!channel || !userId) return;

    if (channel.isThread?.()) {
        const parentChannel = channel.parent;
        if (parentChannel && typeof parentChannel.permissionOverwrites?.edit === 'function') {
            await parentChannel.permissionOverwrites.edit(userId, {
                ViewChannel: true,
                SendMessages: true,
                SendMessagesInThreads: true,
                AttachFiles: true,
                ReadMessageHistory: true
            }).catch((err) => {
                console.error(`Could not grant parent access to ${userId} on ${parentChannel.id}`, err.message);
            });
        }

        try {
            if (channel.archived) {
                await channel.setArchived(false, 'Granting opener access to ticket thread');
            }
            await channel.members.add(userId);
        } catch (err) {
            console.error(`Could not add opener ${userId} to ${channel.id}`, err.message);
            throw err;
        }

        return;
    }

    if (typeof channel.permissionOverwrites?.edit === 'function') {
        await channel.permissionOverwrites.edit(userId, {
            ViewChannel: true,
            SendMessages: true,
            AttachFiles: true,
            ReadMessageHistory: true
        }).catch((err) => {
            console.error(`Could not grant channel access to ${userId} on ${channel.id}`, err.message);
        });
    }
}

module.exports = {
    customId: 'confirm',

    async execute(interaction) {
        let ticketId = null;
        let ticketInserted = false;
        let dealChannel = null;
        let claimMsg = null;

        try {
            await interaction.deferUpdate();
            const sessionId = interaction.customId.replace('confirm_', '');
            await interaction.editReply({
                content: null,
                embeds: [],
                attachments: [],
                components: [
                    makeTicketContainer('Creating Ticket', [
                        '> Creating your ticket...'
                    ])
                ],
                flags: MessageFlags.IsComponentsV2
            }).catch(() => {});

            const sessionData = await session.get(sessionId);
            if (!sessionData) {
                return interaction.editReply({
                    content: null,
                    embeds: [],
                    attachments: [],
                    components: [
                        makeTicketContainer('Ticket Expired', [
                            '> This ticket action is no longer available.',
                            '> Please open a new ticket from the panel.'
                        ])
                    ],
                    flags: MessageFlags.IsComponentsV2
                }).catch(() => {});
            }

            let user;
            let openCount = 0;

            if (env.DB_ENABLED) {
                let [users] = await db.query(
                    'SELECT id FROM users WHERE discord_id = ?',
                    [interaction.user.id]
                );

                // Tickets still need an internal buyer record, but this does not create a wallet.
                if (users.length === 0) {
                    await db.query(
                        `INSERT INTO users (
                            discord_id,
                            balance_available,
                            balance_escrow,
                            total_deposited,
                            total_withdrawn,
                            created_at
                        ) VALUES (?, 0.00000000, 0.00000000, 0.00000000, 0.00000000, NOW())`,
                        [interaction.user.id]
                    );

                    [users] = await db.query(
                        'SELECT id FROM users WHERE discord_id = ?',
                        [interaction.user.id]
                    );
                }

                user = users[0];
                const [openCountRows] = await db.query(
                    `SELECT COUNT(*) as active_count
                     FROM tickets
                     WHERE buyer_id = ?
                     AND status IN ('OPEN', 'CLAIMED', 'PAID', 'DISPUTED')`,
                    [user.id]
                );
                openCount = Number(openCountRows[0]?.active_count || 0);
            } else {
                user = demoStore.ensureUser(interaction.user.id, interaction.user.username);
                openCount = demoStore.countActiveTicketsForBuyer(user.id);
            }

            const maxAllowed = Number(appConfig.limits.maxOpenTicketsPerUser || 2);

            if (openCount >= maxAllowed) {
                return interaction.followUp({
                    content: `You can only have ${maxAllowed} active tickets at once. Close a ticket first.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            ticketId = `ORBIT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
            const paymentMethod = this.buildPaymentString(sessionData);
            const receiveMethod = this.buildReceiveString(sessionData);
            const amountUsd = parseFloat(sessionData.amountUsd);
            const amountLtc = parseFloat(sessionData.amountLtc);
            const feeLtc = parseFloat(sessionData.feeLtc);
            const totalLtc = parseFloat(sessionData.totalLtc);
            const amountFrom = sessionData.amountFrom || sessionData.amountUsd;
            const amountTo = sessionData.amountTo;
            const sourceCurrency = sessionData.sourceCurrency || 'EUR';
            const serviceFeeAmount = sessionData.serviceFeeAmount;
            const serviceFeeCurrency = sessionData.serviceFeeCurrency || sourceCurrency;

            if (!amountTo || !serviceFeeAmount) {
                return interaction.followUp({
                    content: 'Fee data is missing. Please restart ticket creation.',
                    flags: MessageFlags.Ephemeral
                });
            }

            if (compareDecimal(amountTo, amountFrom) >= 0) {
                return interaction.followUp({
                    content: 'Received amount must be lower than sent amount.',
                    flags: MessageFlags.Ephemeral
                });
            }

            if (compareDecimal(serviceFeeAmount, '0') <= 0) {
                return interaction.followUp({
                    content: 'Service fee must be greater than zero.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const guild = interaction.guild;
            const threadParentId = appConfig.channels.deals;
            const threadParent = await guild.channels.fetch(threadParentId);

            if (!threadParent || !threadParent.threads) {
                throw new Error('Deal threads channel is missing or not thread-enabled.');
            }

            const botMember = guild.members.me || await guild.members.fetch(interaction.client.user.id);
            const botPerms = threadParent.permissionsFor(botMember);
            const botHasThreadPerms =
                botPerms?.has(PermissionFlagsBits.ViewChannel) &&
                botPerms?.has(PermissionFlagsBits.SendMessagesInThreads) &&
                (botPerms?.has(PermissionFlagsBits.CreatePrivateThreads) || botPerms?.has(PermissionFlagsBits.ManageThreads));

            if (!botHasThreadPerms) {
                return interaction.followUp({
                    content: 'Ticket setup error: bot is missing thread permissions in the deals channel.',
                    flags: MessageFlags.Ephemeral
                });
            }

            if (env.DB_ENABLED) {
                await db.query(
                    `INSERT INTO tickets (
                        ticket_id, buyer_id, amount_from, amount_to, source_currency, amount_usd, amount_ltc, fee_ltc, total_ltc,
                        service_fee_amount, service_fee_currency, payment_method, receive_method, status, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', NOW())`,
                    [
                        ticketId,
                        user.id,
                        amountFrom,
                        amountTo,
                        sourceCurrency,
                        amountUsd,
                        amountLtc,
                        feeLtc,
                        totalLtc,
                        serviceFeeAmount,
                        serviceFeeCurrency,
                        paymentMethod,
                        receiveMethod
                    ]
                );
            } else {
                demoStore.createTicket({
                    ticket_id: ticketId,
                    buyer_id: user.id,
                    seller_id: null,
                    channel_id: null,
                    claim_message_id: null,
                    amount_from: amountFrom,
                    amount_to: amountTo,
                    source_currency: sourceCurrency,
                    amount_usd: amountUsd,
                    amount_ltc: amountLtc,
                    fee_ltc: feeLtc,
                    total_ltc: totalLtc,
                    service_fee_amount: serviceFeeAmount,
                    service_fee_currency: serviceFeeCurrency,
                    payment_method: paymentMethod,
                    receive_method: receiveMethod,
                    status: 'OPEN'
                });
            }
            ticketInserted = true;

            dealChannel = await threadParent.threads.create({
                name: `deal-${ticketId.toLowerCase()}`,
                autoArchiveDuration: 1440,
                type: ChannelType.PrivateThread,
                invitable: false,
                reason: `Deal thread for ${ticketId}`
            });

            try {
                await grantDealAccess(dealChannel, interaction.user.id);
            } catch (memberErr) {
                console.error(`Could not add opener ${interaction.user.id} to ${dealChannel.id}`, memberErr.message);
                await dealChannel.delete('Fallback to private channel due thread member access issue').catch(() => {});
                dealChannel = await createFallbackDealChannel({
                    guild,
                    ticketId,
                    buyerUserId: interaction.user.id,
                    botUserId: interaction.client.user.id,
                    appConfig
                });
            }

            if (env.DB_ENABLED) {
                await db.query(
                    'UPDATE tickets SET channel_id = ? WHERE ticket_id = ?',
                    [dealChannel.id, ticketId]
                );
            } else {
                demoStore.updateTicket(ticketId, { channel_id: dealChannel.id });
            }

            await dealChannel.send({
                components: [
                    buildDealThreadCard({
                        ticketId,
                        paymentMethod,
                        receiveMethod,
                        amountFromLabel: formatFiat(parseFloat(amountFrom), sourceCurrency),
                        amountToLabel: formatFiat(parseFloat(amountTo), sourceCurrency),
                        serviceFeeLabel: `${serviceFeeAmount} ${serviceFeeCurrency}`
                    })
                ],
                flags: MessageFlags.IsComponentsV2
            });
            const openerPing = await dealChannel.send({
                content: `<@${interaction.user.id}>`
            }).catch(() => null);
            if (openerPing) {
                setTimeout(() => {
                    openerPing.delete().catch(() => {});
                }, 2500);
            }
            const dealRolePing = await dealChannel.send({
                content: '<@&1490121469336879243>'
            }).catch(() => null);
            if (dealRolePing) {
                setTimeout(() => {
                    dealRolePing.delete().catch(() => {});
                }, 2500);
            }

            const claimChannel = await guild.channels.fetch(appConfig.channels.claim);
            claimMsg = await claimChannel.send({
                content: appConfig.roles.exchanger ? `<@&${appConfig.roles.exchanger}>` : null,
                embeds: [
                    buildClaimCard({
                        ticketId,
                        buyerMention: `<@${interaction.user.id}>`,
                        amountFromLabel: formatFiat(parseFloat(amountFrom), sourceCurrency),
                        amountToLabel: formatFiat(parseFloat(amountTo), sourceCurrency),
                        paymentMethod,
                        receiveMethod,
                        collateralLabel: `${totalLtc.toFixed(8)} LTC`,
                        serviceFeeLabel: `${serviceFeeAmount} ${serviceFeeCurrency}`
                    })
                ],
                components: [
                    buildClaimActionRow({
                        ticketId
                    })
                ]
            });

            if (env.DB_ENABLED) {
                await db.query(
                    'UPDATE tickets SET claim_message_id = ? WHERE ticket_id = ?',
                    [claimMsg.id, ticketId]
                );
            } else {
                demoStore.updateTicket(ticketId, { claim_message_id: claimMsg.id });
            }

            try {
                const threadUrl = `https://discord.com/channels/${guild.id}/${dealChannel.id}`;
                const dmEmbed = new EmbedBuilder()
                    .setTitle(`Orbit Trade | Ticket Opened`)
                    .setDescription(
                        `> Ticket: \`${ticketId}\`\n` +
                        `> Route: **${paymentMethod} -> ${receiveMethod}**\n` +
                        `> Amount From: **${formatFiat(parseFloat(amountFrom), sourceCurrency)}**\n` +
                        `> Expected Receive: **${formatFiat(parseFloat(amountTo), sourceCurrency)}**\n` +
                        `> Service Fee: **${serviceFeeAmount} ${serviceFeeCurrency}**\n\n` +
                        `A verified exchanger can now review and claim your deal.\n` +
                        `Use the button below to jump directly into your private ticket thread.`
                    )
                    .setColor(appConfig.brand.color)
                    .setFooter({ text: 'Orbit Trade Notifications' })
                    .setTimestamp();
                const dmRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setStyle(ButtonStyle.Link)
                        .setLabel('Open Ticket')
                        .setURL(threadUrl)
                );
                await interaction.user.send({ embeds: [dmEmbed], components: [dmRow] });
            } catch (dmErr) {
                console.log(`Could not DM ${interaction.user.id}:`, dmErr.message);
            }

            await session.delete(sessionId);

            await interaction.editReply({
                content: null,
                embeds: [],
                attachments: [],
                components: [
                    makeTicketContainer('Ticket Created', [
                        `> Ticket: \`${ticketId}\``,
                        `> Channel: <#${dealChannel.id}>`
                    ])
                ],
                flags: MessageFlags.IsComponentsV2
            });
            await logger.logTransaction(
                interaction.client,
                {
                    title: 'Deal Created',
                    summary: `A new deal ticket was created by <@${interaction.user.id}>.`,
                    fields: [
                        { name: 'Ticket ID', value: ticketId, inline: true },
                        { name: 'Buyer', value: `<@${interaction.user.id}>`, inline: true },
                        { name: 'Channel', value: `<#${dealChannel.id}>`, inline: true },
                        { name: 'Route', value: `${paymentMethod} -> ${receiveMethod}`, inline: false },
                        { name: 'Amount From', value: formatFiat(parseFloat(amountFrom), sourceCurrency), inline: true },
                        { name: 'Amount To', value: formatFiat(parseFloat(amountTo), sourceCurrency), inline: true },
                        { name: 'Escrow Total', value: `${totalLtc.toFixed(8)} LTC`, inline: true }
                    ]
                }
            );
        } catch (error) {
            if (Number(error?.code) === UNKNOWN_INTERACTION_CODE) {
                return;
            }

            // Best-effort cleanup to prevent partial records/resources after a failure.
            if (claimMsg) {
                await claimMsg.delete().catch(() => {});
            }
            if (dealChannel) {
                await dealChannel.delete('Rollback failed ticket creation').catch(() => {});
            }
            if (ticketInserted) {
                if (env.DB_ENABLED) {
                    await db.query('DELETE FROM tickets WHERE ticket_id = ?', [ticketId]).catch(() => {});
                } else {
                    demoStore.deleteTicket(ticketId);
                }
            }

            console.error('confirm ticket failed:', error);
            await logger.logError(
                interaction.client,
                {
                    title: 'Ticket Creation Failed',
                    summary: `Ticket creation failed for <@${interaction.user.id}>.`,
                    fields: [
                        { name: 'User', value: `<@${interaction.user.id}>`, inline: true },
                        { name: 'Ticket ID', value: ticketId || 'Not allocated', inline: true },
                        { name: 'Error', value: error.message, inline: false }
                    ]
                }
            );
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({
                    content: 'Ticket creation failed. Please try again or contact support.',
                    flags: MessageFlags.Ephemeral
                }).catch(() => {});
            } else {
                await interaction.reply({
                    content: 'Ticket creation failed. Please try again or contact support.',
                    flags: MessageFlags.Ephemeral
                }).catch(() => {});
            }
        }
    },

    buildPaymentString(data) {
        let str = formatMethodLabel(data.paymentMethod);
        if (data.paymentSub) str += ` (${formatMethodLabel(data.paymentSub)})`;
        if (data.paymentNetwork) {
            const net = data.paymentNetwork.split('_').pop();
            str += ` [${formatMethodLabel(net)}]`;
        }
        return str;
    },

    buildReceiveString(data) {
        let str = formatMethodLabel(data.receiveMethod);
        if (data.receiveSub) str += ` (${formatMethodLabel(data.receiveSub)})`;
        if (data.receiveNetwork) {
            const net = data.receiveNetwork.split('_').pop();
            str += ` (${formatMethodLabel(net)})`;
        }
        return str;
    }
};
