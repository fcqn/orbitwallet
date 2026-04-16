const { Client, GatewayIntentBits, Collection, Events, MessageFlags, ActivityType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const env = require('./config/env');
const rpc = require('./core/rpc');
const db = require('./core/database');
const logger = require('./core/logger');
const { runMigrations } = require('./core/migrations');
const appConfig = require('./config/appConfig');

const UNKNOWN_INTERACTION_CODE = 10062;
const DEMO_MODE_MESSAGE = 'Demo mode is enabled. Commands, buttons, and forms are disabled in test phase, so this action cannot show real data. Set `DB_ENABLED=true` to use the full bot.';

function validateRuntimeConfig() {
    const requiredPaths = [
        ['channels.claim', appConfig.channels.claim],
        ['channels.trustFeed', appConfig.channels.trustFeed],
        ['channels.logs.errors', appConfig.channels.logs.errors],
        ['roles.exchanger', appConfig.roles.exchanger]
    ].filter(([, value]) => !value);

    if (requiredPaths.length) {
        const labels = requiredPaths.map(([label]) => label).join(', ');
        throw new Error(`Missing required runtime config values: ${labels}`);
    }
}

async function notifyUserDm(client, discordId, embed) {
    if (!discordId) return;
    try {
        const user = await client.users.fetch(discordId);
        await user.send({ embeds: [embed] });
    } catch (error) {
        console.log(`Could not DM ${discordId}:`, error.message);
    }
}

async function replyDemoMode(interaction) {
    const reply = {
        content: DEMO_MODE_MESSAGE,
        flags: MessageFlags.Ephemeral
    };

    if (interaction.replied || interaction.deferred) {
        if (typeof interaction.followUp === 'function') {
            await interaction.followUp(reply).catch(() => {});
        } else if (typeof interaction.editReply === 'function') {
            await interaction.editReply({ content: DEMO_MODE_MESSAGE, embeds: [], components: [] }).catch(() => {});
        }
        return;
    }

    if (typeof interaction.reply === 'function') {
        await interaction.reply(reply).catch(() => {});
    }
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: []
});

client.commands = new Collection();
client.ticketSessions = new Map();

function loadCommands() {
    const commandsPath = path.join(__dirname, 'commands');
    const folders = fs.readdirSync(commandsPath);

    for (const folder of folders) {
        const folderPath = path.join(commandsPath, folder);
        if (!fs.statSync(folderPath).isDirectory()) continue;

        const commandFiles = fs.readdirSync(folderPath).filter((file) => file.endsWith('.js'));
        for (const file of commandFiles) {
            const filePath = path.join(folderPath, file);
            const command = require(filePath);
            if ('data' in command && 'execute' in command) {
                client.commands.set(command.data.name, command);
                console.log(`[LOADER] Loaded: ${folder}/${command.data.name}`);
            } else {
                console.warn(`[LOADER] Command at ${filePath} is missing data or execute`);
            }
        }
    }
}

const ticketHandlers = {
    novaswap_start_exchange: require('./tickets/createTicket'),
    novaswap_exchange_type_menu: require('./tickets/createTicket'),
    novaswap_exchange_modal: require('./tickets/createTicket'),
    sendasset_: require('./tickets/paymentHandler'),
    receiveasset_: require('./tickets/paymentHandler'),
    currencymenu_: require('./tickets/paymentHandler'),

    paymenu_: require('./tickets/paymentHandler'),
    paysub_: require('./tickets/paymentHandler'),
    cryptomenu_: require('./tickets/paymentHandler'),
    usdtnet_: require('./tickets/paymentHandler'),

    receivemenu_: require('./tickets/paymentHandler'),
    receivesub_: require('./tickets/paymentHandler'),
    cryptorec_: require('./tickets/paymentHandler'),
    recnet_: require('./tickets/paymentHandler'),

    amountmodal_: require('./tickets/amountHandler'),

    confirm_: require('./tickets/confirmTicket'),
    cancel_: require('./tickets/cancelTicket'),
    close_: require('./tickets/closeTicketAction'),
    change_amount_: require('./tickets/changeAmountTicket'),
    changeamountmodal_: require('./tickets/changeAmountModal'),
    support_: require('./tickets/supportTicket'),

    claim_: require('./tickets/claimTicket'),
    claimconfirm_: require('./tickets/claimTicket'),
    claimcancel_: require('./tickets/claimTicket'),

    back_pay_: require('./tickets/paymentHandler'),
    back_sub_: require('./tickets/paymentHandler'),
    back_crypto_: require('./tickets/paymentHandler'),
    back_usdtnet_: require('./tickets/paymentHandler'),
    back_receive_: require('./tickets/paymentHandler'),
    back_recnet_: require('./tickets/paymentHandler'),

    confirmrelease_: require('./tickets/releaseConfirm'),
    cancelrelease_: require('./tickets/releaseCancel'),
    enteraddress_: require('./tickets/enterAddress'),
    releaseaddress_: require('./tickets/releaseAddress'),

    paymentcfgapprove_: require('./paymentConfigs/reviewRequest'),
    paymentcfgreject_: require('./paymentConfigs/reviewRequest')
};

client.once(Events.ClientReady, async (c) => {
    console.log(`Orbit Exchange online as ${c.user.tag}`);
    validateRuntimeConfig();
    c.user.setPresence({
        status: 'idle',
        activities: [{ name: 'Orbit Trade', type: ActivityType.Playing }]
    });

    if (env.DB_ENABLED) {
        await runMigrations().catch((err) => {
            console.error('Migration error:', err.message);
        });
    } else {
        console.log('Database disabled: skipping migrations, deposit scanner, and cleanup jobs');
    }

    if (env.DB_ENABLED) {
        try {
            await rpc.getBalance();
            console.log('Deposit scanner active (60s interval)');

            async function scanForDeposits() {
                try {
                    const unspent = await rpc.listUnspent();

                    for (const utxo of unspent) {
                        const txHash = utxo.prevout_hash || utxo.txid || utxo.txId;

                        const [alreadyProcessed] = await db.query(
                            'SELECT id FROM pending_deposits WHERE txid = ? AND address = ? AND status = "CONFIRMED"',
                            [txHash, utxo.address]
                        );
                        if (alreadyProcessed.length > 0) continue;

                        const [isPending] = await db.query(
                            'SELECT id FROM pending_deposits WHERE txid = ? AND address = ? AND status = "PENDING"',
                            [txHash, utxo.address]
                        );
                        if (isPending.length > 0) continue;

                        const [user] = await db.query(
                            'SELECT id FROM users WHERE ltc_deposit_address = ?',
                            [utxo.address]
                        );
                        if (!user.length) continue;

                        const userId = user[0].id;
                        const amount = utxo.value || utxo.amount || 0;

                        try {
                            await db.query(
                                'INSERT INTO pending_deposits (user_id, address, txid, amount, status, detected_at) VALUES (?, ?, ?, ?, "PENDING", NOW())',
                                [userId, utxo.address, txHash, amount]
                            );
                            console.log(`New pending deposit detected for user ${userId}`);
                        } catch (insertErr) {
                            const msg = String(insertErr?.message || '').toLowerCase();
                            if (!msg.includes('duplicate')) {
                                throw insertErr;
                            }
                        }
                    }
                } catch (error) {
                    console.error('Scanner error:', error.message);
                }
            }

            async function checkConfirmations() {
                try {
                    const [pendings] = await db.query('SELECT * FROM pending_deposits WHERE status = "PENDING"');

                    for (const deposit of pendings) {
                        const history = await rpc.getAddressHistory(deposit.address);
                        const tx = history.find((h) => h.tx_hash === deposit.txid);

                        if (!tx || tx.height <= 0) continue;

                        console.log(`Confirming deposit for user ${deposit.user_id}: ${deposit.amount} LTC`);
                        const connection = await db.getConnection();
                        await connection.beginTransaction();

                        try {
                            await connection.query(
                                'UPDATE users SET balance_available = balance_available + ?, total_deposited = total_deposited + ? WHERE id = ?',
                                [deposit.amount, deposit.amount, deposit.user_id]
                            );
                            await connection.query(
                                'UPDATE pending_deposits SET status = "CONFIRMED", confirmed_at = NOW(), confirmations = 1 WHERE id = ?',
                                [deposit.id]
                            );
                            await connection.query(
                                'INSERT INTO wallet_ledger (user_id, action_type, amount, txid, from_address, status) VALUES (?, "DEPOSIT", ?, ?, ?, "CONFIRMED")',
                                [deposit.user_id, deposit.amount, deposit.txid, deposit.address]
                            );
                            await connection.commit();

                            await logger.logDeposit(
                                client,
                                {
                                    title: 'Deposit Confirmed',
                                    summary: 'A pending deposit was confirmed and credited.',
                                    fields: [
                                        { name: 'User ID', value: String(deposit.user_id), inline: true },
                                        { name: 'Amount', value: `${parseFloat(deposit.amount).toFixed(8)} LTC`, inline: true },
                                        { name: 'Address', value: deposit.address, inline: false },
                                        { name: 'TXID', value: deposit.txid, inline: false }
                                    ]
                                }
                            );
                            await logger.logTransaction(
                                client,
                                {
                                    title: 'Wallet Deposit',
                                    summary: 'A wallet deposit was credited.',
                                    fields: [
                                        { name: 'User ID', value: String(deposit.user_id), inline: true },
                                        { name: 'Amount', value: `${parseFloat(deposit.amount).toFixed(8)} LTC`, inline: true },
                                        { name: 'TXID', value: deposit.txid, inline: false }
                                    ]
                                }
                            );
                            const [userRows] = await db.query(
                                'SELECT discord_id FROM users WHERE id = ?',
                                [deposit.user_id]
                            );
                            const discordId = userRows[0]?.discord_id;
                            await notifyUserDm(
                                client,
                                discordId,
                                {
                                    color: appConfig.brand.color,
                                    title: 'Orbit Trade | Deposit Confirmed',
                                    description:
                                        `> Amount: \`${parseFloat(deposit.amount).toFixed(8)}\` LTC\n` +
                                        `> TXID: \`${deposit.txid}\`\n` +
                                        `> Status: Confirmed`,
                                    timestamp: new Date().toISOString()
                                }
                            );
                        } catch (txErr) {
                            await connection.rollback();
                            console.error('Balance update failed, rolled back:', txErr.message);
                        } finally {
                            connection.release();
                        }
                    }
                } catch (error) {
                    console.error('Confirmation checker error:', error.message);
                }
            }

            setInterval(checkConfirmations, 120000);
            setInterval(scanForDeposits, 60000);
            await scanForDeposits();
        } catch (error) {
            console.error('Wallet/scanner error:', error.message);
        }

        console.log('Starting temp data cleanup job');
        setInterval(async () => {
            try {
                const [result] = await db.query('DELETE FROM ticket_temp_data WHERE expires_at < NOW()');
                if (result.affectedRows > 0) {
                    console.log(`Cleaned ${result.affectedRows} expired temp entries`);
                }
            } catch (err) {
                console.error('Cleanup error:', err.message);
            }
        }, 5 * 60 * 1000);
    }
});

client.on(Events.InteractionCreate, async (interaction) => {
    try {
        if (
            !env.DB_ENABLED &&
            (
                interaction.isChatInputCommand() ||
                interaction.isButton() ||
                interaction.isStringSelectMenu() ||
                interaction.isModalSubmit()
            )
        ) {
            await replyDemoMode(interaction);
            return;
        }

        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) {
                console.error(`[ERROR] Command ${interaction.commandName} not found`);
                return;
            }
            await command.execute(interaction);
            return;
        }

        if (interaction.isStringSelectMenu() || interaction.isModalSubmit() || interaction.isButton()) {
            const customId = interaction.customId;

            if (
                interaction.isButton() &&
                (customId.startsWith('confirm_withdraw_') || customId.startsWith('cancel_withdraw_'))
            ) {
                return;
            }

            const handlerEntry = Object.entries(ticketHandlers).find(([prefix]) => customId.startsWith(prefix));
            if (handlerEntry) {
                await handlerEntry[1].execute(interaction);
            }
        }
    } catch (error) {
        if (Number(error?.code) === UNKNOWN_INTERACTION_CODE) {
            return;
        }

        if (error?.code === 'DB_DISABLED') {
            await replyDemoMode(interaction);
            return;
        }

        console.error('[Interaction Error]', error);
        await logger.logError(client, {
            title: 'Interaction Error',
            summary: 'An interaction handler threw an error.',
            fields: [
                { name: 'User', value: interaction?.user ? `<@${interaction.user.id}>` : 'Unknown', inline: true },
                { name: 'Type', value: interaction?.type ? String(interaction.type) : 'Unknown', inline: true },
                { name: 'Command / Custom ID', value: interaction?.commandName || interaction?.customId || 'Unknown', inline: false },
                { name: 'Error', value: error.message, inline: false }
            ]
        });
        const reply = { content: 'An error occurred', flags: MessageFlags.Ephemeral };

        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(reply).catch(() => {});
        } else {
            await interaction.reply(reply).catch(() => {});
        }
    }
});

loadCommands();
client.login(env.DISCORD_TOKEN);

process.on('unhandledRejection', (reason) => {
    console.error('[UNHANDLED_REJECTION]', reason);
    logger.logError(client, {
        title: 'Unhandled Rejection',
        summary: 'A promise rejection was not caught.',
        fields: [
            { name: 'Reason', value: reason?.stack || reason?.message || String(reason), inline: false }
        ]
    });
});

process.on('uncaughtException', (error) => {
    console.error('[UNCAUGHT_EXCEPTION]', error);
    logger.logError(client, {
        title: 'Uncaught Exception',
        summary: 'An exception bubbled to the process level.',
        fields: [
            { name: 'Error', value: error.stack || error.message, inline: false }
        ]
    });
});
