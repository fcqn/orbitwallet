const usersByDiscordId = new Map();
const ticketsById = new Map();

let nextUserId = 1;

function makeDemoAddress(discordId) {
    const suffix = String(discordId || 'demo').slice(-8);
    return `demo-ltc-${suffix}`;
}

function normalizeUser(user = {}) {
    return {
        id: user.id,
        discord_id: String(user.discord_id),
        username: user.username || `user-${String(user.discord_id).slice(-4)}`,
        ltc_deposit_address: user.ltc_deposit_address || makeDemoAddress(user.discord_id),
        balance_available: Number(user.balance_available || 0),
        balance_escrow: Number(user.balance_escrow || 0),
        total_deposited: Number(user.total_deposited || 0),
        total_withdrawn: Number(user.total_withdrawn || 0),
        total_deals: Number(user.total_deals || 0),
        completed_deals: Number(user.completed_deals || 0),
        disputed_deals: Number(user.disputed_deals || 0),
        total_volume_ltc: Number(user.total_volume_ltc || 0),
        total_volume_eur: Number(user.total_volume_eur || 0),
        exchanger_terms: user.exchanger_terms || null
    };
}

function ensureUser(discordId, username) {
    const key = String(discordId);
    let user = usersByDiscordId.get(key);
    if (!user) {
        user = normalizeUser({
            id: nextUserId++,
            discord_id: key,
            username,
            balance_available: 2.5,
            balance_escrow: 0.15,
            total_deposited: 4.75,
            total_withdrawn: 2.1,
            total_deals: 3,
            completed_deals: 2,
            disputed_deals: 0,
            total_volume_ltc: 1.125,
            total_volume_eur: 96.4
        });
        usersByDiscordId.set(key, user);
    } else if (username && user.username !== username) {
        user.username = username;
    }
    return user;
}

function getUserByDiscordId(discordId) {
    return usersByDiscordId.get(String(discordId)) || null;
}

function registerWallet(discordId, username, address) {
    const user = ensureUser(discordId, username);
    user.username = username || user.username;
    user.ltc_deposit_address = address || user.ltc_deposit_address || makeDemoAddress(discordId);
    return user;
}

function setExchangerTerms(discordId, terms) {
    const user = ensureUser(discordId);
    user.exchanger_terms = terms;
    return user;
}

function countActiveTicketsForBuyer(userId) {
    let count = 0;
    for (const ticket of ticketsById.values()) {
        if (ticket.buyer_id === userId && ['OPEN', 'CLAIMED', 'PAID', 'DISPUTED'].includes(ticket.status)) {
            count += 1;
        }
    }
    return count;
}

function createTicket(ticket) {
    ticketsById.set(ticket.ticket_id, {
        ...ticket,
        created_at: new Date().toISOString()
    });
    return ticketsById.get(ticket.ticket_id);
}

function getTicket(ticketId) {
    return ticketsById.get(ticketId) || null;
}

function updateTicket(ticketId, patch) {
    const ticket = ticketsById.get(ticketId);
    if (!ticket) return null;
    Object.assign(ticket, patch);
    return ticket;
}

function deleteTicket(ticketId) {
    ticketsById.delete(ticketId);
}

function getSupportTicketView(ticketId) {
    const ticket = getTicket(ticketId);
    if (!ticket) return null;

    const buyer = Array.from(usersByDiscordId.values()).find((user) => user.id === ticket.buyer_id) || null;
    const seller = ticket.seller_id
        ? Array.from(usersByDiscordId.values()).find((user) => user.id === ticket.seller_id) || null
        : null;

    return {
        ticket_id: ticket.ticket_id,
        channel_id: ticket.channel_id,
        seller_id: ticket.seller_id || null,
        status: ticket.status,
        buyer_discord_id: buyer?.discord_id || null,
        seller_discord_id: seller?.discord_id || null
    };
}

module.exports = {
    ensureUser,
    getUserByDiscordId,
    registerWallet,
    setExchangerTerms,
    countActiveTicketsForBuyer,
    createTicket,
    getTicket,
    updateTicket,
    deleteTicket,
    getSupportTicketView
};
