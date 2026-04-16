const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const axios = require('axios');
const db = require('../../core/database');
const env = require('../../config/env');
const { adminOnly } = require('../../config/permissions');
const demoStore = require('../../core/demoStore');

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('cwallet')
        .setDescription('Generate your exchange wallet address')
        // ✅ FIX: Use the native Discord permission flag to hide the command
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    execute: adminOnly(async (interaction) => {
        const discordId = interaction.user.id;
        const username = interaction.user.username;

        try {
            // Check if user already exists
            let rows;
            if (env.DB_ENABLED) {
                [rows] = await db.query('SELECT ltc_deposit_address FROM users WHERE discord_id = ?', [discordId]);
            } else {
                const demoUser = demoStore.getUserByDiscordId(discordId);
                rows = demoUser ? [{ ltc_deposit_address: demoUser.ltc_deposit_address }] : [];
            }

            if (rows.length > 0) {
                return interaction.reply({ 
                    content: `Wallet already exists: \`${rows[0].ltc_deposit_address}\``, 
                    flags: MessageFlags.Ephemeral 
                });
            }

            // Generate New Address using Electrum-LTC RPC
            let newAddress;
            if (env.DB_ENABLED) {
                const addrRes = await axios.post(process.env.LTC_RPC_URL, {
                    jsonrpc: '2.0',
                    id: 'orbit-bot',
                    method: 'createnewaddress',
                    params: []
                }, {
                    auth: {
                        username: process.env.RPC_USER || 'orbitwallet',
                        password: process.env.RPC_PASS || 'orbitpassword'
                    },
                    family: 4
                });

                newAddress = addrRes.data.result;
            } else {
                newAddress = `demo-ltc-${String(discordId).slice(-8)}`;
            }

            if (!newAddress) {
                throw new Error("Could not generate address. Check RPC connection.");
            }

            // Save to Database
            if (env.DB_ENABLED) {
                await db.query(
                    'INSERT INTO users (discord_id, username, ltc_deposit_address) VALUES (?, ?, ?)', 
                    [discordId, username, newAddress]
                );
            } else {
                demoStore.registerWallet(discordId, username, newAddress);
            }

            // Discord Response
            const embed = new EmbedBuilder()
                .setTitle('Orbit Wallet Generated')
                .setColor(0x3498db)
                .addFields(
                    { name: 'LTC Address', value: `\`${newAddress}\`` },
                    { name: 'Status', value: env.DB_ENABLED ? 'Wallet created successfully.' : 'Demo wallet created for testing.' }
                )
                .setFooter({ text: 'Deposit LTC to start trading.' });

            await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

        } catch (error) {
            console.error("Full Error Details:", error.response?.data || error.message);
            
            let errorMsg = '❌ Error generating wallet.';
            if (error.code === 'ERR_INVALID_URL') {
                errorMsg = 'Configuration Error: LTC_RPC_URL is missing or invalid.';
            } else if (error.response?.data?.error?.message) {
                errorMsg = `RPC Error: ${error.response.data.error.message}`;
            } else if (error.code === 'ECONNREFUSED') {
                errorMsg = 'Connection refused. Is Electrum-LTC running with RPC enabled?';
            }

            // ✅ FIX: Using followUp if interaction was already replied/deferred
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: errorMsg, flags: MessageFlags.Ephemeral });
            } else {
                await interaction.reply({ content: errorMsg, flags: MessageFlags.Ephemeral });
            }
        }
    })
};
