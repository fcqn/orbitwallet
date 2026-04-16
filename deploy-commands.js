const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();

const guildCommands = [];
const globalCommands = [];
const commandsPath = path.join(__dirname, 'src', 'commands');
const guildId = process.env.GUILD_ID;

if (!guildId) {
    console.error('Missing GUILD_ID in .env');
    process.exit(1);
}

if (!fs.existsSync(commandsPath)) {
    console.error(`Folder not found at: ${commandsPath}`);
    process.exit(1);
}

const commandFolders = fs.readdirSync(commandsPath);

for (const folder of commandFolders) {
    const folderPath = path.join(commandsPath, folder);
    if (!fs.statSync(folderPath).isDirectory()) continue;

    const commandFiles = fs.readdirSync(folderPath).filter((file) => file.endsWith('.js'));

    for (const file of commandFiles) {
        const filePath = path.join(folderPath, file);
        const command = require(filePath);

        if ('data' in command && 'execute' in command) {
            const commandData = command.data.toJSON();
            if (command.dmCapable === true) {
                globalCommands.push(commandData);
            } else {
                guildCommands.push(commandData);
            }
            console.log(`[GUILD] ${command.data.name}`);
        }
    }
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log(`Deploying ${globalCommands.length} global commands...`);
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: globalCommands }
        );

        console.log(`Clearing existing guild commands for ${guildId}...`);
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
            { body: [] }
        );

        console.log(`Deploying ${guildCommands.length} guild commands to ${guildId}...`);
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
            { body: guildCommands }
        );

        console.log('Guild command deploy complete.');
    } catch (error) {
        console.error('Deployment Error:', error);
        process.exit(1);
    }
})();
