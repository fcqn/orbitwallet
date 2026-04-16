const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const db = require('./database');
const env = require('../config/env');

function formatTimestamp(date = new Date()) {
    const pad = (value) => String(value).padStart(2, '0');
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate())
    ].join('-') + '_' + [
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds())
    ].join('-');
}

async function createExportPath() {
    const exportDir = path.join(process.cwd(), 'exports');
    await fs.promises.mkdir(exportDir, { recursive: true });

    const fileName = `${env.DB_NAME}-${formatTimestamp()}.sql`;
    const outputPath = path.join(exportDir, fileName);

    return { fileName, outputPath };
}

function runMysqldump(outputPath) {
    const args = [
        `--host=${env.DB_HOST}`,
        `--user=${env.DB_USER}`,
        '--single-transaction',
        '--routines',
        '--triggers',
        '--add-drop-table',
        env.DB_NAME
    ];

    if (env.DB_PASSWORD) {
        args.splice(2, 0, `--password=${env.DB_PASSWORD}`);
    }

    return new Promise((resolve, reject) => {
        const dumpProcess = spawn('mysqldump', args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true
        });

        const outputStream = fs.createWriteStream(outputPath);
        let stderr = '';
        let dumpExitCode = null;
        let processFinished = false;
        let streamFinished = false;
        let settled = false;

        const resolveOnce = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };

        const rejectOnce = (error) => {
            if (settled) return;
            settled = true;
            reject(error);
        };

        const finalizeIfReady = async () => {
            if (!processFinished || !streamFinished || settled) {
                return;
            }

            if (dumpExitCode !== 0) {
                await fs.promises.rm(outputPath, { force: true }).catch(() => {});
                rejectOnce(new Error(stderr.trim() || `mysqldump exited with code ${dumpExitCode}`));
                return;
            }

            resolveOnce({ method: 'mysqldump' });
        };

        dumpProcess.stdout.pipe(outputStream);
        dumpProcess.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        dumpProcess.on('error', async (error) => {
            outputStream.destroy();
            await fs.promises.rm(outputPath, { force: true }).catch(() => {});
            rejectOnce(error);
        });

        outputStream.on('finish', async () => {
            streamFinished = true;
            await finalizeIfReady();
        });

        outputStream.on('error', async (error) => {
            await fs.promises.rm(outputPath, { force: true }).catch(() => {});
            rejectOnce(error);
        });

        dumpProcess.on('close', async (code) => {
            dumpExitCode = code;
            processFinished = true;
            await finalizeIfReady();
        });
    });
}

function escapeValue(value) {
    if (value === null || value === undefined) {
        return 'NULL';
    }

    if (value instanceof Date) {
        const pad = (part) => String(part).padStart(2, '0');
        const formatted = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ` +
            `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
        return `'${formatted}'`;
    }

    if (Buffer.isBuffer(value)) {
        return `X'${value.toString('hex')}'`;
    }

    if (typeof value === 'number') {
        return Number.isFinite(value) ? String(value) : 'NULL';
    }

    if (typeof value === 'boolean') {
        return value ? '1' : '0';
    }

    return `'${String(value)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .replace(/\u0000/g, '\\0')}'`;
}

async function buildSqlDump() {
    const lines = [
        `-- Orbit database export`,
        `-- Database: ${env.DB_NAME}`,
        `-- Generated at: ${new Date().toISOString()}`,
        'SET FOREIGN_KEY_CHECKS = 0;',
        ''
    ];

    const [tables] = await db.query(
        `SELECT TABLE_NAME
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ?
         ORDER BY TABLE_NAME`,
        [env.DB_NAME]
    );

    for (const table of tables) {
        const tableName = table.TABLE_NAME;
        const [createRows] = await db.query(`SHOW CREATE TABLE \`${tableName}\``);
        const createSql = createRows[0]['Create Table'];

        lines.push(`DROP TABLE IF EXISTS \`${tableName}\`;`);
        lines.push(`${createSql};`);

        const [rows] = await db.query(`SELECT * FROM \`${tableName}\``);
        if (rows.length > 0) {
            const columns = Object.keys(rows[0]).map((column) => `\`${column}\``).join(', ');
            const values = rows
                .map((row) => `(${Object.values(row).map(escapeValue).join(', ')})`)
                .join(',\n');

            lines.push(`INSERT INTO \`${tableName}\` (${columns}) VALUES`);
            lines.push(`${values};`);
        }

        lines.push('');
    }

    lines.push('SET FOREIGN_KEY_CHECKS = 1;');
    lines.push('');

    return lines.join('\n');
}

async function exportDatabase() {
    const { fileName, outputPath } = await createExportPath();

    try {
        await runMysqldump(outputPath);
        return {
            outputPath,
            fileName,
            method: 'mysqldump'
        };
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }

    const sqlDump = await buildSqlDump();
    await fs.promises.writeFile(outputPath, sqlDump, 'utf8');

    return {
        outputPath,
        fileName,
        method: 'internal'
    };
}

module.exports = {
    exportDatabase
};
