const {
    EmbedBuilder,
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const db = require('../core/database');
const { hasAdmin, hasRole } = require('../config/permissions');
const appConfig = require('../config/appConfig');
const logger = require('../core/logger');
const { formatFiat } = require('../core/currency');
const { buildDealThreadCard } = require('../core/dealCards');
const { updateClaimMessage, deleteClaimMessage, restoreClaimMessage } = require('./claimMessage');
const { recordClaimedDeal } = require('../core/exchangerStats');
const { makeTicketContainer } = require('../core/ticketVisuals');
const emojis = require('../config/emojis');
const { normalizeMethodKey, resolvePaymentConfigForTicket, formatMethodName } = require('../core/paymentConfigs');
const { isWhitelistedByUserId } = require('../core/claimWhitelist');

async function removePreClaimButtons(channel, ticket) {
    const messages = await channel.messages.fetch({ limit: 30 }).catch(() => null);
    if (!messages) return;

    for (const message of messages.values()) {
        const firstContainer = message.components?.[0];
        const content = firstContainer?.content || firstContainer?.components?.[0]?.content || '';
        const isTicketHeader =
            message.author?.id === channel.client.user.id &&
            typeof content === 'string' &&
            content.includes(`> Ticket: \`${ticket.ticket_id}\``);

        if (isTicketHeader) {
            await message.edit({
                components: [
                    buildDealThreadCard({
                        ticketId: ticket.ticket_id,
                        paymentMethod: ticket.payment_method,
                        receiveMethod: ticket.receive_method,
                        amountFromLabel: formatFiat(parseFloat(ticket.amount_from), ticket.source_currency || 'EUR'),
                        amountToLabel: formatFiat(parseFloat(ticket.amount_to), ticket.source_currency || 'EUR'),
                        serviceFeeLabel: `${ticket.service_fee_amount} ${ticket.service_fee_currency || ticket.source_currency || 'EUR'}`,
                        includeControls: false
                    })
                ],
                flags: MessageFlags.IsComponentsV2
            }).catch(() => {});
            return;
        }
    }
}

async function grantTicketAccess(channel, userId) {
    if (!channel) return;

    if (typeof channel.permissionOverwrites?.edit === 'function') {
        await channel.permissionOverwrites.edit(userId, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
        }).catch((err) => {
            console.error(`Could not grant channel access to ${userId} on ${channel.id}`, err.message);
        });
    }

    if (channel.isThread?.()) {
        const parentChannel = channel.parent;
        if (parentChannel && typeof parentChannel.permissionOverwrites?.edit === 'function') {
            await parentChannel.permissionOverwrites.edit(userId, {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true,
                SendMessagesInThreads: true
            }).catch((err) => {
                console.error(`Could not grant parent access to ${userId} on ${parentChannel.id}`, err.message);
            });
        }

        try {
            if (channel.archived) {
                await channel.setArchived(false, 'Granting ticket access to exchanger');
            }
            await channel.members.add(userId);
        } catch (err) {
            console.error(`Could not add exchanger ${userId} to ${channel.id}`, err.message);
        }
    }
}

async function revokeTicketAccess(channel, userId) {
    if (!channel || !userId) return;

    if (channel.isThread?.()) {
        try {
            await channel.members.remove(userId);
        } catch (err) {
            console.error(`Could not remove exchanger ${userId} from ${channel.id}`, err.message);
        }

        const parentChannel = channel.parent;
        if (parentChannel && typeof parentChannel.permissionOverwrites?.delete === 'function') {
            await parentChannel.permissionOverwrites.delete(userId).catch(() => {});
        }
    }

    if (typeof channel.permissionOverwrites?.delete === 'function') {
        await channel.permissionOverwrites.delete(userId).catch(() => {});
    }
}

function getTermsLines(exchangerMention, buyerMention, methodLabel, termsText) {
    return [
        `> Exchanger: ${exchangerMention}`,
        `> Buyer: ${buyerMention}`,
        methodLabel ? `> Payment Method: **${methodLabel}**` : null,
        '> Buyer must review and accept these terms before funds are locked.',
        '',
        termsText
    ].filter(Boolean);
}

function buildPendingClaimRow(ticketId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`claimconfirm_${ticketId}`)
            .setLabel('Accept Terms')
            .setEmoji(emojis.getComponent('confirmAction'))
            .setStyle(appConfig.brand.buttonStyle),
        new ButtonBuilder()
            .setCustomId(`claimcancel_${ticketId}`)
            .setLabel('Decline Claim')
            .setEmoji(emojis.getComponent('cancelAction'))
            .setStyle(ButtonStyle.Danger)
    );
}

async function fetchTicket(ticketId) {
    const [tickets] = await db.query('SELECT * FROM tickets WHERE ticket_id = ?', [ticketId]);
    return tickets[0] || null;
}

async function fetchExchanger(discordId) {
    const [rows] = await db.query(
        'SELECT id, balance_available, balance_escrow, is_held, held_reason, exchanger_terms FROM users WHERE discord_id = ?',
        [discordId]
    );
    if (!rows.length) return null;

    const exchanger = rows[0];
    exchanger.balance_available = parseFloat(exchanger.balance_available);
    exchanger.balance_escrow = parseFloat(exchanger.balance_escrow);
    return exchanger;
}

async function resolveTermsForTicket(exchangerId, paymentMethod) {
    const normalizedMethod = normalizeMethodKey(paymentMethod);
    const methodsToCheck = normalizedMethod ? [normalizedMethod] : [];

    if (normalizedMethod && ['ltc', 'usdt', 'btc', 'eth', 'sol'].includes(normalizedMethod)) {
        methodsToCheck.push('crypto');
    }

    for (const methodKey of methodsToCheck) {
        const [rows] = await db.query(
            'SELECT terms_text FROM exchanger_payment_terms WHERE user_id = ? AND method_key = ? LIMIT 1',
            [exchangerId, methodKey]
        );
        if (rows.length && String(rows[0].terms_text || '').trim()) {
            return String(rows[0].terms_text).trim();
        }
    }

    const [rows] = await db.query(
        'SELECT exchanger_terms FROM users WHERE id = ? LIMIT 1',
        [exchangerId]
    );
    const defaultTerms = rows[0]?.exchanger_terms;
    return defaultTerms ? String(defaultTerms).trim() : '';
}

async function getDiscordIdByUserId(userId) {
    const [rows] = await db.query('SELECT discord_id FROM users WHERE id = ? LIMIT 1', [userId]);
    return rows[0]?.discord_id || null;
}

async function sendApprovedPaymentDetails(thread, exchangerId, paymentMethod, exchangerDiscordId) {
    if (!thread) return;

    const paymentConfig = await resolvePaymentConfigForTicket(exchangerId, paymentMethod);
    if (!paymentConfig?.paymentDetails) {
        return;
    }

    await thread.send({
        components: [
            makeTicketContainer(
                'Payment Details',
                [
                    `> Exchanger: <@${exchangerDiscordId}>`,
                    `> Method: **${formatMethodName(paymentConfig.methodKey || normalizeMethodKey(paymentMethod) || paymentMethod)}**`,
                    '',
                    paymentConfig.paymentDetails
                ]
            )
        ],
        flags: MessageFlags.IsComponentsV2
    }).catch(() => {});
}

async function finalizeClaim({ interaction, ticketId, exchangerId, exchangerDiscordId, summaryText, bypassCollateral = false }) {
    const connection = await db.getConnection();
    let pendingMessageId = null;
    let ticket = null;

    try {
        await connection.beginTransaction();

        const [ticketRows] = await connection.query(
            'SELECT * FROM tickets WHERE ticket_id = ? FOR UPDATE',
            [ticketId]
        );
        if (!ticketRows.length) {
            throw new Error('Ticket not found during claim confirm.');
        }

        ticket = ticketRows[0];
        ticket.total_ltc = parseFloat(ticket.total_ltc);
        ticket.amount_usd = parseFloat(ticket.amount_usd);

        if (ticket.status !== 'OPEN') {
            await connection.query(
                'DELETE FROM pending_claim_confirmations WHERE ticket_id = ?',
                [ticketId]
            );
            await connection.commit();
            await updateClaimMessage(interaction.guild, ticket, ticket.status);
            return {
                ok: false,
                reply: {
                    content: 'This ticket is no longer open.',
                    flags: MessageFlags.Ephemeral
                }
            };
        }

        if (ticket.buyer_id === exchangerId) {
            await connection.rollback();
            return {
                ok: false,
                reply: {
                    content: 'You cannot claim your own ticket.',
                    flags: MessageFlags.Ephemeral
                }
            };
        }

        const [walletRows] = await connection.query(
            'SELECT balance_available, is_held, held_reason FROM users WHERE id = ? FOR UPDATE',
            [exchangerId]
        );
        if (!walletRows.length) {
            await connection.rollback();
            return {
                ok: false,
                reply: {
                    content: 'Wallet not found for this exchanger.',
                    flags: MessageFlags.Ephemeral
                }
            };
        }

        const wallet = walletRows[0];
        if (wallet.is_held) {
            await connection.rollback();
            return {
                ok: false,
                reply: {
                    content: wallet.held_reason || 'Wallet is on hold.',
                    flags: MessageFlags.Ephemeral
                }
            };
        }

        const available = parseFloat(wallet.balance_available);

        if (!bypassCollateral && available < ticket.total_ltc) {
            await connection.rollback();
            return {
                ok: false,
                reply: {
                    content: `Insufficient funds. Need ${ticket.total_ltc.toFixed(8)} LTC available.`,
                    flags: MessageFlags.Ephemeral
                }
            };
        }

        const [pendingRows] = await connection.query(
            'SELECT seller_id, message_id FROM pending_claim_confirmations WHERE ticket_id = ? FOR UPDATE',
            [ticketId]
        );
        if (pendingRows.length) {
            pendingMessageId = pendingRows[0].message_id;
        }

        if (!bypassCollateral) {
            await connection.query(
                'UPDATE users SET balance_available = balance_available - ?, balance_escrow = balance_escrow + ? WHERE id = ?',
                [ticket.total_ltc, ticket.total_ltc, exchangerId]
            );
        }
        await connection.query(
            `UPDATE tickets
             SET seller_id = ?,
                 status = "CLAIMED",
                 claimed_at = NOW(),
                 collateral_required = ?,
                 collateral_locked = ?
             WHERE ticket_id = ? AND status = "OPEN"`,
            [exchangerId, bypassCollateral ? 0 : 1, bypassCollateral ? 0 : 1, ticketId]
        );
        await recordClaimedDeal(connection, exchangerId);
        await connection.query(
            'DELETE FROM pending_claim_confirmations WHERE ticket_id = ?',
            [ticketId]
        );

        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }

    await deleteClaimMessage(interaction.guild, ticket);

    const thread = await interaction.guild.channels.fetch(ticket.channel_id).catch(() => null);
    if (thread && pendingMessageId) {
        const pendingMessage = await thread.messages.fetch(pendingMessageId).catch(() => null);
        if (pendingMessage) {
            await pendingMessage.edit({
                components: [
                    makeTicketContainer(
                        'Terms Accepted',
                        [summaryText]
                    )
                ],
                flags: MessageFlags.IsComponentsV2
            }).catch(() => {});
        }
    }

    if (thread) {
        const buyerDiscordId = await getDiscordIdByUserId(ticket.buyer_id);
        await thread.send({
            components: [
                makeTicketContainer(
                    'Exchanger Assigned',
                    [
                        `> Exchanger: <@${exchangerDiscordId}>`,
                        `> Buyer: ${buyerDiscordId ? `<@${buyerDiscordId}>` : 'Unavailable'}`,
                        `> Payment Method: **${ticket.payment_method}**`,
                        `> Amount: **${formatFiat(ticket.amount_usd, ticket.source_currency || 'EUR')}**`,
                        `> Escrow Locked: **${bypassCollateral ? 'N/A' : `${ticket.total_ltc.toFixed(8)} LTC`}**`
                    ]
                )
            ],
            flags: MessageFlags.IsComponentsV2
        });

        await sendApprovedPaymentDetails(thread, exchangerId, ticket.payment_method, exchangerDiscordId);
        await removePreClaimButtons(thread, ticket);
    }

    return {
        ok: true,
        reply: {
            content: `Ticket **${ticketId}** is now claimed.`,
            flags: MessageFlags.Ephemeral
        },
        ticket
    };
}

module.exports = {
    customId: 'claim_ticket',
    grantTicketAccess,
    revokeTicketAccess,
    fetchTicket,
    getDiscordIdByUserId,

    async execute(interaction) {
        if (interaction.customId.startsWith('claimconfirm_')) {
            return this.confirmClaim(interaction);
        }

        if (interaction.customId.startsWith('claimcancel_')) {
            return this.cancelClaim(interaction);
        }

        const ticketId = interaction.customId.replace('claim_', '');

        try {
            if (!hasAdmin(interaction.member) && !hasRole(interaction.member, appConfig.roles.exchanger)) {
                return interaction.reply({
                    content: 'Only exchangers can claim tickets.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const ticket = await fetchTicket(ticketId);
            if (!ticket) {
                return interaction.reply({
                    content: 'Ticket not found',
                    flags: MessageFlags.Ephemeral
                });
            }

            ticket.total_ltc = parseFloat(ticket.total_ltc);
            ticket.amount_usd = parseFloat(ticket.amount_usd);

            if (ticket.status !== 'OPEN') {
                await updateClaimMessage(interaction.guild, ticket, ticket.status);
                return interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('Ticket Unavailable')
                            .setDescription('This ticket has already been claimed or closed.')
                            .setColor(appConfig.brand.color)
                    ],
                    flags: MessageFlags.Ephemeral
                });
            }

            const exchanger = await fetchExchanger(interaction.user.id);
            if (!exchanger) {
                return interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('Wallet Required')
                            .setDescription('Create a wallet first with `/register`')
                            .setColor(appConfig.brand.color)
                    ],
                    flags: MessageFlags.Ephemeral
                });
            }

            if (ticket.buyer_id === exchanger.id) {
                return interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('Claim Blocked')
                            .setDescription('You cannot claim your own ticket.')
                            .setColor(appConfig.brand.color)
                    ],
                    flags: MessageFlags.Ephemeral
                });
            }

            if (exchanger.is_held) {
                return interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('Wallet On Hold')
                            .setDescription(exchanger.held_reason || 'Contact admin for details.')
                            .setColor(appConfig.brand.color)
                    ],
                    flags: MessageFlags.Ephemeral
                });
            }

            const exchangerWhitelisted = await isWhitelistedByUserId(exchanger.id);

            if (!exchangerWhitelisted && exchanger.balance_available < ticket.total_ltc) {
                return interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('Insufficient Funds')
                            .setDescription('Insufficient available balance to claim this ticket.')
                            .addFields(
                                { name: 'Required', value: `${ticket.total_ltc.toFixed(8)} LTC`, inline: true },
                                { name: 'Available', value: `${exchanger.balance_available.toFixed(8)} LTC`, inline: true }
                            )
                            .setColor(appConfig.brand.color)
                    ],
                    flags: MessageFlags.Ephemeral
                });
            }

            const thread = await interaction.guild.channels.fetch(ticket.channel_id).catch(() => null);
            if (!thread) {
                return interaction.reply({
                    content: 'Deal thread not found for this ticket.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const connection = await db.getConnection();
            try {
                await connection.beginTransaction();

                const [lockedTickets] = await connection.query(
                    'SELECT ticket_id, status FROM tickets WHERE ticket_id = ? FOR UPDATE',
                    [ticketId]
                );
                if (!lockedTickets.length) {
                    throw new Error('Ticket not found during claim reservation.');
                }

                const liveTicket = lockedTickets[0];
                if (liveTicket.status !== 'OPEN') {
                    await connection.rollback();
                    await updateClaimMessage(interaction.guild, liveTicket, liveTicket.status);
                    return interaction.reply({
                        content: 'This ticket is no longer available.',
                        flags: MessageFlags.Ephemeral
                    });
                }

                const [pendingRows] = await connection.query(
                    'SELECT seller_id FROM pending_claim_confirmations WHERE ticket_id = ? FOR UPDATE',
                    [ticketId]
                );

                if (pendingRows.length) {
                    await connection.rollback();
                    if (Number(pendingRows[0].seller_id) === Number(exchanger.id)) {
                        return interaction.reply({
                            content: 'You already have a pending claim confirmation for this ticket.',
                            flags: MessageFlags.Ephemeral
                        });
                    }

                    return interaction.reply({
                        content: 'Another exchanger is already reviewing this ticket.',
                        flags: MessageFlags.Ephemeral
                    });
                }

                await connection.query(
                    'INSERT INTO pending_claim_confirmations (ticket_id, seller_id) VALUES (?, ?)',
                    [ticketId, exchanger.id]
                );
                await connection.commit();
            } catch (error) {
                await connection.rollback();
                throw error;
            } finally {
                connection.release();
            }

            await grantTicketAccess(thread, interaction.user.id);

            const buyerDiscordId = await getDiscordIdByUserId(ticket.buyer_id);
            const termsText = await resolveTermsForTicket(exchanger.id, ticket.payment_method);

            if (!termsText) {
                const result = await finalizeClaim({
                    interaction,
                    ticketId,
                    exchangerId: exchanger.id,
                    exchangerDiscordId: interaction.user.id,
                    summaryText: `> No buyer terms were configured, so the claim was completed immediately by <@${interaction.user.id}>.`,
                    bypassCollateral: exchangerWhitelisted
                });

                if (!result.ok) {
                    return interaction.reply(result.reply);
                }

                await interaction.reply({
                    content: 'No buyer terms were configured for this payment method, so the claim was completed immediately.',
                    flags: MessageFlags.Ephemeral
                });
                await logger.logTransaction(
                    interaction.client,
                    {
                        title: 'Ticket Claimed',
                        summary: 'A ticket was claimed instantly because no buyer terms were configured.',
                        fields: [
                            { name: 'Ticket ID', value: ticketId, inline: true },
                            { name: 'Exchanger', value: `<@${interaction.user.id}>`, inline: true },
                            { name: 'Escrow Locked', value: Number(result.ticket.collateral_locked) ? `${result.ticket.total_ltc.toFixed(8)} LTC` : 'N/A', inline: true }
                        ]
                    }
                );
                return;
            }

            await updateClaimMessage(interaction.guild, ticket, 'Pending Buyer Approval');

            const pendingMessage = await thread.send({
                components: [
                    makeTicketContainer(
                        'Buyer Terms Approval',
                        getTermsLines(
                            `<@${interaction.user.id}>`,
                            buyerDiscordId ? `<@${buyerDiscordId}>` : 'Unavailable',
                            ticket.payment_method,
                            termsText
                        ),
                        [buildPendingClaimRow(ticketId)]
                    )
                ],
                flags: MessageFlags.IsComponentsV2
            });

            await db.query(
                'UPDATE pending_claim_confirmations SET message_id = ? WHERE ticket_id = ? AND seller_id = ?',
                [pendingMessage.id, ticketId, exchanger.id]
            );

            await interaction.reply({
                content: 'The buyer must accept your terms in the ticket before the claim is finalized.',
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error('claim ticket failed:', error);
            await logger.logError(interaction.client, {
                title: 'Claim Failed',
                summary: 'Starting a claim failed.',
                fields: [
                    { name: 'Ticket ID', value: ticketId || 'Unknown', inline: true },
                    { name: 'User', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Error', value: error.message, inline: false }
                ]
            });
            await interaction.reply({
                content: 'Failed to start this claim. Please try again.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }
    },

    async confirmClaim(interaction) {
        const ticketId = interaction.customId.replace('claimconfirm_', '');

        try {
            const [pendingRows] = await db.query(
                'SELECT seller_id FROM pending_claim_confirmations WHERE ticket_id = ? LIMIT 1',
                [ticketId]
            );
            if (!pendingRows.length) {
                return interaction.reply({
                    content: 'This claim confirmation is no longer active.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const exchangerId = Number(pendingRows[0].seller_id);
            const ticket = await fetchTicket(ticketId);
            if (!ticket) {
                return interaction.reply({
                    content: 'Ticket not found.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const buyerDiscordId = await getDiscordIdByUserId(ticket.buyer_id);
            if (interaction.user.id !== buyerDiscordId && !hasAdmin(interaction.member)) {
                return interaction.reply({
                    content: 'Only the buyer can accept these terms.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const exchangerDiscordId = await getDiscordIdByUserId(exchangerId);
            const result = await finalizeClaim({
                interaction,
                ticketId,
                exchangerId,
                exchangerDiscordId: exchangerDiscordId || interaction.user.id,
                summaryText: `> Buyer <@${interaction.user.id}> accepted the exchanger's terms and the claim is now finalized.`,
                bypassCollateral: await isWhitelistedByUserId(exchangerId)
            });

            if (!result.ok) {
                return interaction.reply(result.reply);
            }

            await interaction.reply({
                content: `Terms accepted. Ticket **${ticketId}** is now claimed.`,
                flags: MessageFlags.Ephemeral
            });
            await logger.logTransaction(
                interaction.client,
                {
                    title: 'Ticket Claimed',
                    summary: 'A ticket claim was confirmed after buyer approval.',
                    fields: [
                        { name: 'Ticket ID', value: ticketId, inline: true },
                        { name: 'Seller User ID', value: String(exchangerId), inline: true },
                        { name: 'Buyer', value: `<@${interaction.user.id}>`, inline: true },
                        { name: 'Escrow Locked', value: Number(result.ticket.collateral_locked) ? `${result.ticket.total_ltc.toFixed(8)} LTC` : 'N/A', inline: true }
                    ]
                }
            );
        } catch (error) {
            console.error('claim confirm failed:', error);
            await logger.logError(interaction.client, {
                title: 'Claim Confirm Failed',
                summary: 'Confirming a claim failed.',
                fields: [
                    { name: 'Ticket ID', value: ticketId, inline: true },
                    { name: 'User', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Error', value: error.message, inline: false }
                ]
            });
            await interaction.reply({
                content: 'Failed to confirm this claim.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }
    },

    async cancelClaim(interaction) {
        const ticketId = interaction.customId.replace('claimcancel_', '');

        try {
            const connection = await db.getConnection();
            let pendingMessageId = null;
            let ticket = null;
            let sellerDiscordId = null;

            try {
                await connection.beginTransaction();

                const [pendingRows] = await connection.query(
                    'SELECT seller_id, message_id FROM pending_claim_confirmations WHERE ticket_id = ? FOR UPDATE',
                    [ticketId]
                );
                if (!pendingRows.length) {
                    await connection.rollback();
                    return interaction.reply({
                        content: 'This claim confirmation is no longer active.',
                        flags: MessageFlags.Ephemeral
                    });
                }

                const pending = pendingRows[0];
                pendingMessageId = pending.message_id;

                const [ticketRows] = await connection.query(
                    'SELECT * FROM tickets WHERE ticket_id = ? FOR UPDATE',
                    [ticketId]
                );
                if (!ticketRows.length) {
                    throw new Error('Ticket not found during claim cancel.');
                }

                ticket = ticketRows[0];
                const buyerDiscordId = await getDiscordIdByUserId(ticket.buyer_id);
                sellerDiscordId = await getDiscordIdByUserId(pending.seller_id);

                const isAllowed =
                    hasAdmin(interaction.member) ||
                    interaction.user.id === buyerDiscordId ||
                    interaction.user.id === sellerDiscordId;

                if (!isAllowed) {
                    await connection.rollback();
                    return interaction.reply({
                        content: 'Only the buyer, the exchanger, or an admin can decline this pending claim.',
                        flags: MessageFlags.Ephemeral
                    });
                }

                await connection.query(
                    'DELETE FROM pending_claim_confirmations WHERE ticket_id = ?',
                    [ticketId]
                );
                await connection.commit();
            } catch (error) {
                await connection.rollback();
                throw error;
            } finally {
                connection.release();
            }

            if (ticket?.status === 'OPEN') {
                await restoreClaimMessage(interaction.guild, ticket);
            }

            const thread = ticket ? await interaction.guild.channels.fetch(ticket.channel_id).catch(() => null) : null;
            if (thread) {
                if (pendingMessageId) {
                    const pendingMessage = await thread.messages.fetch(pendingMessageId).catch(() => null);
                    if (pendingMessage) {
                        await pendingMessage.edit({
                            components: [
                                makeTicketContainer(
                                    'Claim Declined',
                                    [
                                        `> Declined By: <@${interaction.user.id}>`,
                                        '> The pending claim was cleared.',
                                        '> The ticket is available again.'
                                    ]
                                )
                            ],
                            flags: MessageFlags.IsComponentsV2
                        }).catch(() => {});
                    }
                }

                if (sellerDiscordId) {
                    await revokeTicketAccess(thread, sellerDiscordId);
                }
            }

            await interaction.reply({
                content: `Pending claim cleared for ${ticketId}. No funds were locked.`,
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error('claim cancel failed:', error);
            await logger.logError(interaction.client, {
                title: 'Claim Cancel Failed',
                summary: 'Cancelling a claim failed.',
                fields: [
                    { name: 'Ticket ID', value: ticketId, inline: true },
                    { name: 'User', value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Error', value: error.message, inline: false }
                ]
            });
            await interaction.reply({
                content: 'Failed to cancel this claim.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }
    }
};
