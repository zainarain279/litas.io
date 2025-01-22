import log from "./utils/logger.js";
import bedduSalama from "./utils/banner.js";
import { delay, readAccountsFromFile, readFile } from './utils/helper.js';
import { claimMining, getNewToken, getUserFarm, activateMining } from './utils/api.js';

async function refreshAccessToken(token, refreshToken, proxy) {
    let refreshedTokens;
    do {
        refreshedTokens = await getNewToken(token, refreshToken, proxy);
        if (!refreshedTokens) {
            log.info('Token refresh failed, retrying...');
            await delay(3);
        }
    } while (!refreshedTokens);

    return refreshedTokens;
}

async function activateMiningProcess(token, refreshToken, proxy) {
    let activated;
    while (true) {
        activated = await activateMining(token, proxy);
        if (activated === "unauth") {
            log.warn('Unauthorized, refreshing token...');
            const refreshedTokens = await refreshAccessToken(token, refreshToken, proxy);
            token = refreshedTokens.accessToken;
            refreshToken = refreshedTokens.refreshToken;
        } else if (!activated) {
            log.info('Activation failed, retrying...');
            await delay(3);
        } else {
            log.info('Mining activated response:', activated);
            return token;
        }
    }
}

async function getUserFarmInfo(accessToken, refreshToken, proxy, index) {
    let userFarmInfo;
    while (true) {
        userFarmInfo = await getUserFarm(accessToken);
        if (userFarmInfo === "unauth") {
            log.warn(`Account ${index} Unauthorized, refreshing token...`);
            const refreshedTokens = await refreshAccessToken(accessToken, refreshToken, proxy);
            accessToken = refreshedTokens.accessToken;
            refreshToken = refreshedTokens.refreshToken;
        } else if (!userFarmInfo) {
            log.warn(`Account ${index} get farm info failed, retrying...`);
            await delay(3);
        } else {
            const { status, totalMined } = userFarmInfo;
            log.info(`Account ${index} farm info:`, { status, totalMined });
            return { userFarmInfo, accessToken, refreshToken };
        }
    }
}

async function handleFarming(userFarmInfo, token, refreshToken, proxy) {
    const canBeClaimedAt = new Date(userFarmInfo.canBeClaimedAt).getTime();
    const timeNow = new Date().getTime();

    if (canBeClaimedAt < timeNow) {
        log.info('Farming rewards are claimable. Attempting to claim farming rewards...');
        let claimResponse;
        while (true) {
            claimResponse = await claimMining(token, proxy);
            if (!claimResponse) {
                log.info('Failed to claim farming rewards, retrying...');
                await delay(3);
            } else {
                log.info('Farming rewards claimed response:', claimResponse);
                await activateMiningProcess(token, refreshToken, proxy);
                break;
            }
        }
    } else {
        log.info('Farming rewards can be claimed at:', new Date(canBeClaimedAt).toLocaleString());
    }
}

async function main() {
    log.info(bedduSalama);
    const accounts = await readAccountsFromFile("tokens.txt");
    const proxies = await readFile("proxy.txt");

    if (accounts.length === 0) {
        log.warn('No tokens found, exiting...');
        process.exit(0);
    }

    log.info('Running with total Accounts:', accounts.length);

    if (proxies.length === 0) {
        log.warn('No proxy found, running without proxy...');
    }

    for (let i = 0; i < accounts.length; i++) {
        const proxy = proxies[i % proxies.length] || null;
        const account = accounts[i];
        try {
            const { token, reToken } = account;
            log.info(`Processing account ${i + 1} of ${accounts.length} with: ${proxy || "No proxy"}`);
            await activateMiningProcess(token, reToken, proxy);

            setInterval(async () => {
                const { userFarmInfo, accessToken, refreshToken } = await getUserFarmInfo(token, reToken, proxy, i + 1);
                await handleFarming(userFarmInfo, accessToken, refreshToken, proxy);
            }, 1000 * 60); // Run every minute

        } catch (error) {
            log.error(`Error processing account ${i + 1}:`, error.message);
        }

        await delay(3);
    }
}

process.on('SIGINT', () => {
    log.warn('Process received SIGINT, cleaning up and exiting program...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    log.warn('Process received SIGTERM, cleaning up and exiting program...');
    process.exit(0);
});

main();
