module.exports = {
    apps: [
        {
            name: 'orbit-manager',
            script: 'src/bot.js',
            cwd: __dirname,
            instances: 1,
            exec_mode: 'fork',
            autorestart: true,
            watch: false,
            max_memory_restart: '500M',
            restart_delay: 5000,
            kill_timeout: 10000,
            env: {
                NODE_ENV: 'production'
            }
        }
    ]
};
