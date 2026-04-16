const { ButtonStyle } = require('discord.js');
const env = require('./env');

module.exports = {
    brand: {
        name: 'Orbit Exchange',
        color: 0xb68ced,
        buttonStyle: ButtonStyle.Secondary
    },
    text: {
        dealCompletedTitle: 'Orbit Trade | Deal Completed',
        trustFeedFooter: 'Orbit Trust Feed',
        releaseFooter: 'Orbit Release'
    },
    links: {
        ltcExplorerBase: 'https://blockchair.com/litecoin/transaction/'
    },
    assets: {
        exchangePanelImage: 'https://cdn.discordapp.com/attachments/1474837358619922447/1492849727316951040/exch.png?ex=69dcd426&is=69db82a6&hm=7f43637f07319580dbe3a900f55a0e16c7d73df3c6be3cc2d2c926f5660f1e0f&',
        claimTicketImage: 'https://cdn.discordapp.com/attachments/1474837358619922447/1492849725307748352/cdd.png?ex=69dcd426&is=69db82a6&hm=16c7e2bf70dcc57096da9822c3f6917dd2c687b139d92495f9efbe8e225b3d3a&',
        trustFeedImage: 'https://cdn.discordapp.com/attachments/1474837358619922447/1492849813866418258/trsd.png?ex=69dcd43b&is=69db82bb&hm=71b31eed4c880bb0f9bc0cc2799db2ac57a788b4f472683c756d330dc07168df&'
    },
    roles: {
        exchanger: env.ROLE_EXCHANGER_ID,
        support: env.ROLE_SUPPORT_ID,
        completedDeal: env.ROLE_COMPLETED_DEAL_ID
    },
    channels: {
        deals: env.CHANNEL_DEALS_ID,
        support: env.CHANNEL_SUPPORT_ID,
        claim: env.CHANNEL_CLAIM_ID,
        trustFeed: env.CHANNEL_TRUST_FEED_ID,
        logs: {
            withdraw: env.CHANNEL_LOG_WITHDRAW_ID,
            deposit: env.CHANNEL_LOG_DEPOSIT_ID,
            dealsClose: env.CHANNEL_LOG_DEALS_CLOSE_ID,
            supportClose: env.CHANNEL_LOG_SUPPORT_CLOSE_ID,
            transactions: env.CHANNEL_LOG_TRANSACTIONS_ID,
            errors: env.CHANNEL_LOG_ERRORS_ID,
            paymentConfig: env.CHANNEL_LOG_PAYMENT_CONFIG_ID,
            admin: env.CHANNEL_LOG_ADMIN_ID || env.CHANNEL_LOG_ERRORS_ID
        }
    },
    limits: {
        maxOpenTicketsPerUser: env.MAX_OPEN_TICKETS_PER_USER
    }
};
