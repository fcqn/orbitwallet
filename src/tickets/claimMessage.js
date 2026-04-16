const { buildClaimCard, buildClaimActionRow } = require('../core/dealCards');
const db = require('../core/database');
const appConfig = require('../config/appConfig');

async function fetchClaimTicket(ticketId) {
    const [rows] = await db.query(
        `SELECT
            t.ticket_id,
            t.claim_message_id,
            t.amount_from,
            t.amount_to,
            t.payment_method,
            t.receive_method,
            t.total_ltc,
            t.service_fee_amount,
            t.service_fee_currency,
            u.discord_id AS buyer_discord_id
         FROM tickets t
         JOIN users u ON u.id = t.buyer_id
         WHERE t.ticket_id = ?`,
        [ticketId]
    );
    return rows[0] || null;
}

async function sendClaimMessage(guild, ticketId, statusLabel = 'Claim Ticket', disabled = false) {
    if (!guild || !ticketId) return null;

    const claimChannel = await guild.channels.fetch(appConfig.channels.claim).catch(() => null);
    if (!claimChannel?.isTextBased?.()) return null;

    const claimTicket = await fetchClaimTicket(ticketId);
    if (!claimTicket) return null;

    const claimMessage = await claimChannel.send({
        content: appConfig.roles.exchanger ? `<@&${appConfig.roles.exchanger}>` : null,
        embeds: [
            buildClaimCard({
                ticketId: claimTicket.ticket_id,
                buyerMention: `<@${claimTicket.buyer_discord_id}>`,
                amountFromLabel: claimTicket.amount_from,
                amountToLabel: claimTicket.amount_to,
                paymentMethod: claimTicket.payment_method,
                receiveMethod: claimTicket.receive_method,
                collateralLabel: `${parseFloat(claimTicket.total_ltc).toFixed(8)} LTC`,
                serviceFeeLabel: `${claimTicket.service_fee_amount} ${claimTicket.service_fee_currency || 'EUR'}`
            })
        ],
        components: [
            buildClaimActionRow({
                ticketId: claimTicket.ticket_id,
                buttonLabel: statusLabel,
                disabled
            })
        ]
    });

    await db.query(
        'UPDATE tickets SET claim_message_id = ? WHERE ticket_id = ?',
        [claimMessage.id, ticketId]
    );

    return claimMessage;
}

async function updateClaimMessage(guild, ticket, statusLabel, disabled = true) {
    if (!guild || !ticket?.ticket_id) return;

    try {
        const claimChannel = await guild.channels.fetch(appConfig.channels.claim);
        if (!claimChannel?.isTextBased?.()) return;

        const claimTicket = await fetchClaimTicket(ticket.ticket_id);
        if (!claimTicket) return;

        let claimMessage = null;
        if (claimTicket.claim_message_id) {
            claimMessage = await claimChannel.messages.fetch(claimTicket.claim_message_id).catch(() => null);
        }

        if (!claimMessage) {
            await sendClaimMessage(guild, ticket.ticket_id, statusLabel || 'Unavailable', disabled);
            return;
        }

        await claimMessage.edit({
            embeds: [
                buildClaimCard({
                    ticketId: claimTicket.ticket_id,
                    buyerMention: `<@${claimTicket.buyer_discord_id}>`,
                    amountFromLabel: claimTicket.amount_from,
                    amountToLabel: claimTicket.amount_to,
                    paymentMethod: claimTicket.payment_method,
                    receiveMethod: claimTicket.receive_method,
                    collateralLabel: `${parseFloat(claimTicket.total_ltc).toFixed(8)} LTC`,
                    serviceFeeLabel: `${claimTicket.service_fee_amount} ${claimTicket.service_fee_currency || 'EUR'}`
                })
            ],
            components: [
                buildClaimActionRow({
                    ticketId: claimTicket.ticket_id,
                    buttonLabel: statusLabel || 'Unavailable',
                    disabled
                })
            ]
        });
    } catch (error) {
        console.log(`Could not update claim message for ${ticket.ticket_id}:`, error.message);
    }
}

async function deleteClaimMessage(guild, ticket) {
    if (!guild || !ticket?.claim_message_id) return;

    try {
        const claimChannel = await guild.channels.fetch(appConfig.channels.claim);
        if (!claimChannel?.isTextBased?.()) return;

        const claimMessage = await claimChannel.messages.fetch(ticket.claim_message_id);
        await claimMessage.delete().catch(() => {});
        await db.query(
            'UPDATE tickets SET claim_message_id = NULL WHERE ticket_id = ?',
            [ticket.ticket_id]
        );
    } catch (error) {
        console.log(`Could not delete claim message for ${ticket.ticket_id}:`, error.message);
    }
}

async function disableClaimMessageForTicket(guild, ticketId, statusLabel) {
    const [rows] = await db.query(
        'SELECT ticket_id, claim_message_id FROM tickets WHERE ticket_id = ?',
        [ticketId]
    );

    if (!rows.length) return;
    await updateClaimMessage(guild, rows[0], statusLabel);
}

async function restoreClaimMessage(guild, ticket) {
    if (!guild || !ticket?.ticket_id) return;
    await updateClaimMessage(guild, ticket, 'Claim Ticket', false);
}

module.exports = {
    updateClaimMessage,
    disableClaimMessageForTicket,
    deleteClaimMessage,
    restoreClaimMessage,
    sendClaimMessage
};
