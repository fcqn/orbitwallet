const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../../core/database');
const appConfig = require('../../config/appConfig');
const { adminOnly } = require('../../config/permissions');

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('finduser')
        .setDescription('Find a user by Discord account, Orbit ID, wallet address, or ticket ID')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption((option) =>
            option.setName('user')
                .setDescription('Discord user')
                .setRequired(false)
        )
        .addIntegerOption((option) =>
            option.setName('orbitid')
                .setDescription('Internal Orbit user ID')
                .setRequired(false)
        )
        .addStringOption((option) =>
            option.setName('address')
                .setDescription('LTC deposit address')
                .setRequired(false)
        )
        .addStringOption((option) =>
            option.setName('ticketid')
                .setDescription('Ticket ID')
                .setRequired(false)
        ),

    execute: adminOnly(async (interaction) => {
        const discordUser = interaction.options.getUser('user');
        const orbitId = interaction.options.getInteger('orbitid');
        const address = interaction.options.getString('address')?.trim();
        const ticketId = interaction.options.getString('ticketid')?.trim().toUpperCase();

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const provided = [discordUser, orbitId, address, ticketId].filter(Boolean);
        if (!provided.length) {
            await interaction.editReply({ content: 'Provide at least one lookup input.' });
            return;
        }

        let userRow = null;

        if (discordUser) {
            const [rows] = await db.query('SELECT * FROM users WHERE discord_id = ? LIMIT 1', [discordUser.id]);
            userRow = rows[0] || null;
        } else if (orbitId) {
            const [rows] = await db.query('SELECT * FROM users WHERE id = ? LIMIT 1', [orbitId]);
            userRow = rows[0] || null;
        } else if (address) {
            const [rows] = await db.query('SELECT * FROM users WHERE ltc_deposit_address = ? LIMIT 1', [address]);
            userRow = rows[0] || null;
        } else if (ticketId) {
            const [rows] = await db.query(
                `SELECT u.*
                 FROM tickets t
                 LEFT JOIN users u ON u.id = t.seller_id
                 WHERE t.ticket_id = ?
                 LIMIT 1`,
                [ticketId]
            );
            userRow = rows[0] || null;
        }

        if (!userRow && ticketId) {
            const [buyerRows] = await db.query(
                `SELECT u.*
                 FROM tickets t
                 JOIN users u ON u.id = t.buyer_id
                 WHERE t.ticket_id = ?
                 LIMIT 1`,
                [ticketId]
            );
            userRow = buyerRows[0] || null;
        }

        if (!userRow) {
            await interaction.editReply({ content: 'No matching user was found.' });
            return;
        }

        const [ticketCounts] = await db.query(
            `SELECT
                SUM(CASE WHEN buyer_id = ? THEN 1 ELSE 0 END) AS buyer_tickets,
                SUM(CASE WHEN seller_id = ? THEN 1 ELSE 0 END) AS seller_tickets
             FROM tickets`,
            [userRow.id, userRow.id]
        );

        const embed = new EmbedBuilder()
            .setTitle(`Orbit Trade | ${userRow.username || userRow.discord_id}`)
            .setColor(appConfig.brand.color)
            .addFields(
                { name: 'Orbit ID', value: `${userRow.id}`, inline: true },
                { name: 'Discord ID', value: `${userRow.discord_id}`, inline: true },
                { name: 'Held', value: userRow.is_held ? 'Yes' : 'No', inline: true },
                { name: 'Wallet', value: `\`${userRow.ltc_deposit_address || 'No address'}\``, inline: false },
                { name: 'Balances', value: `Available: ${parseFloat(userRow.balance_available || 0).toFixed(8)} LTC\nEscrow: ${parseFloat(userRow.balance_escrow || 0).toFixed(8)} LTC`, inline: false },
                { name: 'Ticket Links', value: `As Buyer: ${Number(ticketCounts[0]?.buyer_tickets || 0)}\nAs Seller: ${Number(ticketCounts[0]?.seller_tickets || 0)}`, inline: false }
            )
            .setFooter({ text: appConfig.brand.name })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    })
};
