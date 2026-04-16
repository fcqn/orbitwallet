const path = require('path');
const { exportDatabase } = require('../src/core/dbExport');

async function main() {
    try {
        const result = await exportDatabase();
        console.log(`Backup created with ${result.method}: ${path.resolve(result.outputPath)}`);
    } catch (error) {
        console.error(`Backup failed: ${error.message}`);
        process.exit(1);
    }
}

main();
