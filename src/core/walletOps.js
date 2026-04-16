const rpc = require('./rpc');
const { normalizeLtc } = require('./payoutSafety');

async function sendLtc({ destination, amount }) {
    const normalizedAmount = normalizeLtc(amount);
    const txid = await rpc.sendLTC(destination, normalizedAmount);

    if (!txid) {
        throw new Error('Broadcast failed');
    }

    return { txid };
}

module.exports = {
    sendLtc
};
