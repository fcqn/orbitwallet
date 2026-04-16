const db = require('./database');

const SCALE = 100000000n;

function decimalToUnits(value) {
    const normalized = String(value).trim();
    if (!/^\d+(\.\d+)?$/.test(normalized)) {
        throw new Error(`Invalid decimal value: ${value}`);
    }
    const [whole, fraction = ''] = normalized.split('.');
    const padded = `${fraction}00000000`.slice(0, 8);
    return (BigInt(whole) * SCALE) + BigInt(padded);
}

function unitsToDecimal(units) {
    const whole = units / SCALE;
    const fraction = (units % SCALE).toString().padStart(8, '0');
    return `${whole.toString()}.${fraction}`;
}

function normalizeLtc(value) {
    const units = decimalToUnits(value);
    if (units <= 0n) {
        throw new Error('Amount must be greater than zero');
    }
    return unitsToDecimal(units);
}

function addLtc(left, right) {
    return unitsToDecimal(decimalToUnits(left) + decimalToUnits(right));
}

async function reserveWithdrawal({
    userId,
    amountLtc,
    feeLtc,
    toAddress,
    processedBy,
    requestKey,
    enforceCooldown = true
}) {
    const normalizedAmount = normalizeLtc(amountLtc);
    const normalizedFee = normalizeLtc(feeLtc);
    const totalDebit = addLtc(normalizedAmount, normalizedFee);

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        if (requestKey) {
            const [existingRows] = await connection.query(
                'SELECT id, status FROM withdrawal_queue WHERE request_key = ? FOR UPDATE',
                [requestKey]
            );
            if (existingRows.length > 0) {
                throw new Error(`Duplicate withdrawal request (${existingRows[0].status})`);
            }
        }

        const [userRows] = await connection.query(
            'SELECT id, balance_available, last_withdrawn_at FROM users WHERE id = ? FOR UPDATE',
            [userId]
        );
        if (!userRows.length) {
            throw new Error('User wallet not found');
        }

        const user = userRows[0];
        if (enforceCooldown && user.last_withdrawn_at) {
            const lastWithdrawalAt = new Date(user.last_withdrawn_at);
            const nextAllowedAt = new Date(lastWithdrawalAt.getTime() + (24 * 60 * 60 * 1000));

            if (nextAllowedAt > new Date()) {
                throw new Error(`You can only withdraw once every 24 hours. Try again after ${nextAllowedAt.toISOString()}.`);
            }
        }

        const balanceAvailable = decimalToUnits(user.balance_available || '0');
        if (balanceAvailable < decimalToUnits(totalDebit)) {
            throw new Error('Insufficient funds for withdrawal including network fee');
        }

        await connection.query(
            `UPDATE users
             SET balance_available = balance_available - ?,
                 total_withdrawn = total_withdrawn + ?,
                 last_withdrawn_at = NOW(),
                 updated_at = NOW()
             WHERE id = ?`,
            [totalDebit, normalizedAmount, userId]
        );

        const [insert] = await connection.query(
            `INSERT INTO withdrawal_queue (
                user_id, amount, fee_amount, to_address, status, requested_at, processed_by, request_key
            ) VALUES (?, ?, ?, ?, 'PROCESSING', NOW(), ?, ?)`,
            [userId, normalizedAmount, normalizedFee, toAddress, processedBy, requestKey || null]
        );

        await connection.commit();
        return {
            reservationId: insert.insertId,
            amountLtc: normalizedAmount,
            feeLtc: normalizedFee
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

async function completeWithdrawal({ reservationId, txid, actionType = 'WITHDRAWAL' }) {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [rows] = await connection.query(
            'SELECT * FROM withdrawal_queue WHERE id = ? FOR UPDATE',
            [reservationId]
        );
        if (!rows.length) {
            throw new Error('Withdrawal reservation not found');
        }

        const row = rows[0];
        if (row.status !== 'PROCESSING') {
            throw new Error(`Cannot finalize withdrawal with status ${row.status}`);
        }

        await connection.query(
            `UPDATE withdrawal_queue
             SET status = 'COMPLETED', txid = ?, processed_at = NOW()
             WHERE id = ?`,
            [txid, reservationId]
        );

        await connection.query(
            `INSERT INTO wallet_ledger
             (user_id, action_type, amount, fee_amount, txid, to_address, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'CONFIRMED', NOW())`,
            [row.user_id, actionType, row.amount, row.fee_amount, txid, row.to_address]
        );

        await connection.commit();
        return row;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

async function failWithdrawal({ reservationId }) {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [rows] = await connection.query(
            'SELECT * FROM withdrawal_queue WHERE id = ? FOR UPDATE',
            [reservationId]
        );
        if (!rows.length) {
            throw new Error('Withdrawal reservation not found');
        }

        const row = rows[0];
        if (row.status !== 'PROCESSING') {
            await connection.commit();
            return row;
        }

        const refundTotal = addLtc(row.amount, row.fee_amount);
        await connection.query(
            `UPDATE users
             SET balance_available = balance_available + ?,
                 total_withdrawn = GREATEST(total_withdrawn - ?, 0),
                 updated_at = NOW()
             WHERE id = ?`,
            [refundTotal, row.amount, row.user_id]
        );

        await connection.query(
            `UPDATE withdrawal_queue
             SET status = 'FAILED', processed_at = NOW()
             WHERE id = ?`,
            [reservationId]
        );

        await connection.commit();
        return row;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

async function beginReleaseJob({ ticketId, initiatedBy, ltcAddress, amountLtc }) {
    const connection = await db.getConnection();
    const normalizedAmount = normalizeLtc(amountLtc);
    try {
        await connection.beginTransaction();
        const [rows] = await connection.query(
            'SELECT id, status FROM release_jobs WHERE ticket_id = ? FOR UPDATE',
            [ticketId]
        );

        if (rows.length > 0) {
            const current = rows[0];
            if (current.status === 'COMPLETED') {
                throw new Error(`Release already completed for ticket ${ticketId}`);
            }
            if (current.status === 'PROCESSING') {
                throw new Error(`Release already in progress for ticket ${ticketId}`);
            }
            if (current.status === 'CHAIN_SENT_DB_SYNC_REQUIRED') {
                throw new Error(
                    `Release already broadcast on-chain for ticket ${ticketId}. Resolve database reconciliation before retrying.`
                );
            }
            await connection.query(
                `UPDATE release_jobs
                 SET initiated_by = ?, ltc_address = ?, amount_ltc = ?, status = 'PROCESSING', txid = NULL, last_error = NULL, processed_at = NULL
                 WHERE ticket_id = ?`,
                [initiatedBy, ltcAddress, normalizedAmount, ticketId]
            );
        } else {
            await connection.query(
                `INSERT INTO release_jobs (
                    ticket_id, initiated_by, ltc_address, amount_ltc, status, created_at
                ) VALUES (?, ?, ?, ?, 'PROCESSING', NOW())`,
                [ticketId, initiatedBy, ltcAddress, normalizedAmount]
            );
        }
        await connection.commit();
        return normalizedAmount;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

async function markReleaseJobFailed({ ticketId, errorMessage }) {
    await db.query(
        `UPDATE release_jobs
         SET status = 'FAILED', last_error = ?, processed_at = NOW()
         WHERE ticket_id = ?`,
        [String(errorMessage || 'Unknown release error').slice(0, 4000), ticketId]
    );
}

async function markReleaseJobDbSyncRequired({ ticketId, txid, errorMessage }) {
    await db.query(
        `UPDATE release_jobs
         SET status = 'CHAIN_SENT_DB_SYNC_REQUIRED', txid = ?, last_error = ?, processed_at = NOW()
         WHERE ticket_id = ?`,
        [txid || null, String(errorMessage || 'Database sync required').slice(0, 4000), ticketId]
    );
}

async function markReleaseJobCompleted({ ticketId, txid, connection }) {
    const runner = connection || db;
    await runner.query(
        `UPDATE release_jobs
         SET status = 'COMPLETED', txid = ?, processed_at = NOW(), last_error = NULL
         WHERE ticket_id = ?`,
        [txid, ticketId]
    );
}

module.exports = {
    normalizeLtc,
    reserveWithdrawal,
    completeWithdrawal,
    failWithdrawal,
    beginReleaseJob,
    markReleaseJobFailed,
    markReleaseJobDbSyncRequired,
    markReleaseJobCompleted
};
