const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const appConfig = require('./appConfig');

const hasAdmin = (member) => Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator));
const hasRole = (member, roleId) => Boolean(roleId && member?.roles?.cache?.has(roleId));

const isStaffMember = (member) => {
    const isAdmin = hasAdmin(member);
    const isExchanger = hasRole(member, appConfig.roles.exchanger);
    const isSupport = hasRole(member, appConfig.roles.support);
    return isAdmin || isExchanger || isSupport;
};

/**
 * Higher-order function to restrict command execution to Admins.
 * @param {Function} execute - The original command execution function.
 */
const adminOnly = (execute) => {
    return async (interaction) => {
        if (!interaction.inGuild() || !interaction.member) {
            return interaction.reply({
                content: 'This action can only be used inside the server.',
                flags: MessageFlags.Ephemeral
            });
        }

        // 1. Check if user has Administrator permission
        if (!hasAdmin(interaction.member)) {
            return interaction.reply({ 
                content: 'This action is restricted to Administrators only.', 
                flags: MessageFlags.Ephemeral 
            });
        }
        
        // 2. If they have permission, run the original command
        return execute(interaction);
    };
};

/**
 * Restricts command to a specific Role ID (Staff)
 */
const exchOnly = (execute, options = {}) => {
    const { allowDm = false } = options;

    return async (interaction) => {
        if ((!interaction.inGuild() || !interaction.member) && !allowDm) {
            return interaction.reply({
                content: 'This action can only be used inside the server.',
                flags: MessageFlags.Ephemeral
            });
        }

        if ((!interaction.inGuild() || !interaction.member) && allowDm) {
            return execute(interaction);
        }

        const isAdmin = hasAdmin(interaction.member);
        const isExchanger = hasRole(interaction.member, appConfig.roles.exchanger);

        if (isAdmin || isExchanger) {
            return execute(interaction);
        }

        return interaction.reply({ 
            content: 'Restricted: You need the **Exchanger** role to use this.', 
            flags: MessageFlags.Ephemeral 
        });
    };
};

const staffOnly = (execute) => {
    return async (interaction) => {
        if (!interaction.inGuild() || !interaction.member) {
            return interaction.reply({
                content: 'This action can only be used inside the server.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (isStaffMember(interaction.member)) {
            return execute(interaction);
        }

        return interaction.reply({
            content: 'Restricted: You need Staff access (Admin, Exchanger, or Support).',
            flags: MessageFlags.Ephemeral
        });
    };
};

module.exports = {
    adminOnly,
    exchOnly,
    staffOnly,
    isStaffMember,
    hasAdmin,
    hasRole
};
