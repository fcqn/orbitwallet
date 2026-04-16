const { EmbedBuilder, ChannelType } = require('discord.js');
const db = require('../core/database');
const appConfig = require('../config/appConfig');
const { createTranscriptAttachment } = require('../core/transcript');
const { hasAdmin, hasRole } = require('../config/permissions');
const logger = require('../core/logger');
const { updateClaimMessage } = require('./claimMessage');
const { formatMethodLabel } = require('../core/displayLabels');

function normalizeTicket(ticket) {
    return {
        ...ticket,
        buyer_id: Number(ticket.buyer_id),
        seller_id: ticket.seller_id ? Number(ticket.seller_id) : null
    };
}

async function getTicketById(ticketId) {
    const [tickets] = await db.query('SELECT * FROM tickets WHERE ticket_id = ?', [ticketId]);
    return tickets.length ? normalizeTicket(tickets[0]) : null;
}

async function resolveTicketThread(guild, ticket) {
    if (!ticket.channel_id) return null;
    try {
        return await guild.channels.fetch(ticket.channel_id);
    } catch {
        return null;
    }
}

async function canCloseTicket(interaction, ticket) {
    const [userRows] = await db.query(
        'SELECT id FROM users WHERE discord_id = ?',
        [interaction.user.id]
    );
    const localUserId = userRows.length ? Number(userRows[0].id) : null;

    const isBuyer = localUserId !== null && ticket.buyer_id === localUserId;
    const isSeller = localUserId !== null && ticket.seller_id && ticket.seller_id === localUserId;
    const isAdmin = hasAdmin(interaction.member);
    const isSupport = hasRole(interaction.member, appConfig.roles.support);
    const isExchanger = hasRole(interaction.member, appConfig.roles.exchanger);
    return isBuyer || isSeller || isAdmin || isSupport || isExchanger;
}

async function captureTranscriptForTicket({ interaction, ticket, reason = 'Closed by user', mode = 'deal' }) {
    const guild = interaction.guild;
    const thread = await resolveTicketThread(guild, ticket);

    let transcriptSent = false;
    let transcriptMessageUrl = null;
    let transcriptError = null;

    const canTranscript =
        thread &&
        (
            thread.type === ChannelType.PrivateThread ||
            thread.type === ChannelType.PublicThread ||
            thread.type === ChannelType.GuildText
        );

    if (!thread) {
        transcriptError = 'ticket thread could not be loaded';
    } else if (!canTranscript) {
        transcriptError = `unsupported channel type for transcript: ${thread.type}`;
    } else {
        try {
            const transcriptAttachment = await createTranscriptAttachment(thread, ticket.ticket_id);
            const transcriptEmbed = new EmbedBuilder()
                .setTitle(`Transcript - ${ticket.ticket_id}`)
                .setDescription(
                    `Closed by <@${interaction.user.id}>.\n` +
                    `Reason: ${reason}\n` +
                    `Final status before close: ${ticket.status}`
                )
                .setColor(appConfig.brand.color)
                .setTimestamp();

            const payload = {
                embeds: [transcriptEmbed],
                files: [transcriptAttachment]
            };
            const logMsg = mode === 'support'
                ? await logger.logSupportClose(interaction.client, payload)
                : await logger.logDealClose(interaction.client, payload);

            if (!logMsg) {
                transcriptError = 'transcript log channel is missing, inaccessible, or rejected the upload';
            } else {
                transcriptMessageUrl = logMsg.url || null;
                transcriptSent = true;
            }
        } catch (err) {
            console.error(`Transcript failed for ${ticket.ticket_id}:`, err);
            transcriptError = err?.message || 'Unknown transcript error';
        }
    }

    return {
        thread,
        transcriptSent,
        transcriptMessageUrl,
        transcriptError
    };
}

async function archiveTicketThread(thread, ticketId, actionLabel = 'closed') {
    if (!thread) return;

    try {
        if (!thread.archived) {
            await thread.setArchived(true, `Ticket ${ticketId} ${actionLabel}`);
        }
        if (!thread.locked) {
            await thread.setLocked(true, `Ticket ${ticketId} ${actionLabel}`);
        }
    } catch (err) {
        if (err?.code !== 50083) {
            console.error(`Failed to archive thread ${thread.id}:`, err);
        }
    }
}

async function archiveCompletedTicketWithTranscript({ interaction, ticketId, reason = 'Deal completed automatically' }) {
    const ticket = await getTicketById(ticketId);
    if (!ticket) {
        return { ok: false, message: 'Ticket not found.' };
    }

    const transcriptResult = await captureTranscriptForTicket({
        interaction,
        ticket,
        reason,
        mode: 'deal'
    });

    try {
        const [buyerRows] = await db.query('SELECT discord_id FROM users WHERE id = ?', [ticket.buyer_id]);
        const buyerDiscordId = buyerRows[0]?.discord_id;
        if (buyerDiscordId && transcriptResult.thread) {
            const transcriptAttachment = await createTranscriptAttachment(transcriptResult.thread, ticket.ticket_id);
            const user = await interaction.client.users.fetch(buyerDiscordId).catch(() => null);
            if (user) {
                const dmEmbed = new EmbedBuilder()
                    .setTitle(`Deal Completed - ${ticket.ticket_id}`)
                    .setDescription(
                        `Your deal is complete.\n` +
                        `Type: **${formatMethodLabel(ticket.payment_method)} -> ${formatMethodLabel(ticket.receive_method)}**\n` +
                        `A transcript of the completed ticket is attached below.`
                    )
                    .setColor(appConfig.brand.color)
                    .setTimestamp();
                await user.send({
                    embeds: [dmEmbed],
                    files: [transcriptAttachment]
                }).catch(() => {});
            }
        }
    } catch (error) {
        console.error(`Failed to DM transcript for ${ticketId}:`, error.message);
    }

    await archiveTicketThread(transcriptResult.thread, ticketId, 'completed');

    return {
        ok: true,
        ticket,
        transcriptSent: transcriptResult.transcriptSent,
        transcriptMessageUrl: transcriptResult.transcriptMessageUrl,
        transcriptError: transcriptResult.transcriptError
    };
}

async function closeTicketWithTranscript({ interaction, ticketId, reason = 'Closed by user', mode = 'deal' }) {
    const ticket = await getTicketById(ticketId);
    if (!ticket) {
        return { ok: false, message: 'Ticket not found.' };
    }

    if (!(await canCloseTicket(interaction, ticket))) {
        return { ok: false, message: 'You are not allowed to close this ticket.' };
    }

    if (ticket.status === 'CANCELLED' || ticket.status === 'RELEASED') {
        return { ok: true, alreadyClosed: true, ticket };
    }

    const guild = interaction.guild;
    const transcriptResult = await captureTranscriptForTicket({
        interaction,
        ticket,
        reason,
        mode
    });

    await db.query('UPDATE tickets SET status = "CANCELLED" WHERE ticket_id = ?', [ticketId]);
    await updateClaimMessage(guild, ticket, 'Closed');

    if (ticket.seller_id && ticket.total_ltc && Number(ticket.collateral_locked || 0)) {
        try {
            await db.query(
                'UPDATE users SET balance_available = balance_available + ?, balance_escrow = GREATEST(balance_escrow - ?, 0) WHERE id = ?',
                [ticket.total_ltc, ticket.total_ltc, ticket.seller_id]
            );
            await db.query(
                'UPDATE tickets SET collateral_locked = 0 WHERE ticket_id = ?',
                [ticketId]
            );
        } catch (err) {
            console.error(`Failed escrow unlock for ${ticketId}:`, err);
        }
    }

    await archiveTicketThread(transcriptResult.thread, ticketId, 'closed');

    return {
        ok: true,
        ticket,
        transcriptSent: transcriptResult.transcriptSent,
        transcriptMessageUrl: transcriptResult.transcriptMessageUrl,
        transcriptError: transcriptResult.transcriptError
    };
}

module.exports = {
    closeTicketWithTranscript,
    archiveCompletedTicketWithTranscript,
    getTicketById
};
