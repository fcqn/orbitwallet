async function recordClaimedDeal(connection, userId) {
    await connection.query(
        `INSERT INTO exchanger_stats (user_id, total_deals, last_active)
         VALUES (?, 1, NOW())
         ON DUPLICATE KEY UPDATE
            total_deals = total_deals + 1,
            last_active = NOW()`,
        [userId]
    );
}

async function recordCompletedDeal(connection, userId, volumeLtc, volumeEur) {
    await connection.query(
        `INSERT INTO exchanger_stats (user_id, completed_deals, total_volume_ltc, total_volume_eur, last_active)
         VALUES (?, 1, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
            completed_deals = completed_deals + 1,
            total_volume_ltc = total_volume_ltc + VALUES(total_volume_ltc),
            total_volume_eur = total_volume_eur + VALUES(total_volume_eur),
            last_active = NOW()`,
        [userId, volumeLtc, volumeEur]
    );
}

module.exports = {
    recordClaimedDeal,
    recordCompletedDeal
};
