const axios = require('axios');
const path = require('path');
const env = require('../config/env');

class ElectrumRPC {
    constructor() {
        this.url = env.LTC_RPC_URL;
        this.auth = {
            username: env.RPC_USER,
            password: env.RPC_PASS
        };
        this.walletPath = env.WALLET_PATH;
        this.loadingPromise = null;
    }

    async call(method, params = []) {
        // Avoid logging RPC params to prevent leaking sensitive payloads.
        console.log(`RPC call: ${method}`);
        const response = await axios.post(
            this.url,
            {
                jsonrpc: '2.0',
                id: method,
                method,
                params
            },
            {
                auth: this.auth,
                family: 4,
                headers: { 'Content-Type': 'application/json' },
                timeout: 10000
            }
        );

        if (response.data.error) {
            const msg = response.data.error.message || 'Unknown RPC error';
            throw new Error(msg);
        }
        return response.data.result;
    }

    isWalletNotLoadedError(error) {
        const msg = `${error?.response?.data?.error?.message || error?.message || ''}`.toLowerCase();
        return msg.includes('wallet not loaded') || msg.includes('wallet file not found');
    }

    walletParamCandidates(params = []) {
        if (!this.walletPath) {
            return [params];
        }

        const walletName = path.basename(this.walletPath);
        const candidates = [];
        const pushCandidate = (candidate) => {
            const serialized = JSON.stringify(candidate);
            if (!candidates.some((existing) => JSON.stringify(existing) === serialized)) {
                candidates.push(candidate);
            }
        };

        // Some Electrum daemon variants expect wallet context to be passed
        // explicitly on wallet-scoped calls instead of relying on a globally
        // selected wallet in the daemon process.
        pushCandidate(params);

        const walletHints = [
            { wallet_path: this.walletPath },
            { wallet_path: walletName },
            { wallet: this.walletPath },
            { wallet: walletName },
            { name: walletName }
        ];

        if (Array.isArray(params)) {
            for (const hint of walletHints) {
                pushCandidate([...params, hint]);
            }
        } else if (params && typeof params === 'object') {
            for (const hint of walletHints) {
                pushCandidate({ ...params, ...hint });
            }
        } else {
            for (const hint of walletHints) {
                pushCandidate([params, hint]);
            }
        }

        return candidates;
    }

    async loadWalletIfNeeded() {
        if (!this.walletPath) {
            throw new Error('WALLET_PATH missing in env');
        }
        if (this.loadingPromise) return this.loadingPromise;

        this.loadingPromise = (async () => {
            const walletName = path.basename(this.walletPath);
            const attempts = [
                () => this.call('load_wallet_file', [this.walletPath]),
                () => this.call('load_wallet', { path: this.walletPath }),
                () => this.call('load_wallet', { wallet_path: this.walletPath }),
                () => this.call('load_wallet', [this.walletPath]),
                () => this.call('load_wallet', [walletName])
            ];

            let lastErr = null;
            for (const attempt of attempts) {
                try {
                    await attempt();
                    try {
                        await this.call('select_wallet', { name: walletName });
                    } catch (selectErr) {
                        console.warn(`Could not select wallet ${walletName}: ${selectErr.message}`);
                    }
                    console.log(`Wallet loaded via RPC: ${this.walletPath}`);
                    return true;
                } catch (err) {
                    lastErr = err;
                }
            }

            throw lastErr || new Error('Failed to load wallet');
        })();

        try {
            return await this.loadingPromise;
        } finally {
            this.loadingPromise = null;
        }
    }

    async callWithWallet(method, params = []) {
        const attempts = this.walletParamCandidates(params);

        try {
            for (const candidate of attempts) {
                try {
                    return await this.call(method, candidate);
                } catch (error) {
                    if (!this.isWalletNotLoadedError(error)) {
                        throw error;
                    }
                }
            }

            throw new Error('wallet not loaded');
        } catch (error) {
            if (!this.isWalletNotLoadedError(error)) {
                console.error(`RPC Error (${method}):`, error.message);
                throw error;
            }

            console.warn(`Wallet not loaded for RPC ${method}. Attempting load...`);
            await this.loadWalletIfNeeded();

            try {
                for (const candidate of attempts) {
                    try {
                        return await this.call(method, candidate);
                    } catch (retryErr) {
                        if (!this.isWalletNotLoadedError(retryErr)) {
                            throw retryErr;
                        }
                    }
                }

                throw new Error('wallet not loaded');
            } catch (retryErr) {
                console.error(`RPC Error (${method}) after wallet load:`, retryErr.message);
                throw retryErr;
            }
        }
    }

    async getBalance() {
        return this.callWithWallet('getbalance');
    }

    async listAddresses() {
        return this.callWithWallet('listaddresses');
    }

    async listUnspent() {
        return this.callWithWallet('listunspent');
    }

    async getAddressHistory(address) {
        return this.callWithWallet('getaddresshistory', [address]);
    }

    async getAddressBalance(address) {
        return this.callWithWallet('getaddressbalance', [address]);
    }

    async createNewAddress() {
        return this.callWithWallet('createnewaddress');
    }

    async getUnusedAddress() {
        return this.callWithWallet('getunusedaddress');
    }

    async payTo(destination, amount, fee = null) {
        const params = fee ? [destination, amount, fee] : [destination, amount];
        return this.callWithWallet('payto', params);
    }

    async signTransaction(txHex) {
        return this.callWithWallet('signtransaction', [txHex]);
    }

    async broadcast(txHex) {
        return this.callWithWallet('broadcast', [txHex]);
    }

    async sendLTC(destination, amount) {
        await this.loadWalletIfNeeded();
        const unsigned = await this.payTo(destination, amount);
        const signed = await this.signTransaction(unsigned);
        return this.broadcast(signed);
    }
}

module.exports = new ElectrumRPC();
