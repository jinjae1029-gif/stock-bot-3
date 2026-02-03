
import { runSimulation } from './logic.js';

// --- UTILITIES ---

function randomRange(min, max, step = 1) {
    const steps = (max - min) / step;
    const r = Math.floor(Math.random() * (steps + 1));
    return parseFloat((min + r * step).toFixed(2));
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomWeights() {
    // Requirements:
    // 1. Sum must be exactly 100.
    // 2. Each Tier (1-8) must be between 3% and 40%.

    // Algorithm: "Distribute Remaining"
    // 1. Initialize all to Min (3). Used = 24. Remaining = 76.
    // 2. Randomly distribute the remaining 76 to the 8 buckets,
    //    respecting the Max (40) constraint per bucket.

    // Min 3, Max 40. Cap per add = 40 - 3 = 37.
    let w = new Array(8).fill(3);
    let remaining = 76;

    // Indices to visit randomly to avoid bias
    // We can just loop until remaining is 0, picking random index each time.
    while (remaining > 0) {
        const idx = randomInt(0, 7);
        // Check if we can add to this bucket
        if (w[idx] < 40) {
            w[idx]++;
            remaining--;
        }
    }

    return w;
}

// ... existing helpers ...

export function calculateMean(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function calculateStdDev(arr, mean) {
    if (arr.length < 2) return 0;
    const variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (arr.length - 1);
    return Math.sqrt(variance);
}

export function calculateSQN(trades) {
    // SQN = (Expectancy / StdDev) * Sqrt(N)
    // Expectancy = Mean of Trade PnL %
    // StdDev = StdDev of Trade PnL %
    if (trades.length < 2) return 0;

    // Use netPnLPct
    // trades IS array of PnL %
    const meanPnL = calculateMean(trades);
    const stdPnL = calculateStdDev(trades, meanPnL);

    // SQN = (Mean / StdDev) * Sqrt(N)
    if (stdPnL === 0) return 0;
    return (meanPnL / stdPnL) * Math.sqrt(trades.length);
}

export function calculateRSquared(dailyLog) {
    const n = dailyLog.length;
    if (n < 2) return 0;

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
        const x = i;
        const y = dailyLog[i].totalAsset;
        sumX += x;
        sumY += y;
        sumXY += (x * y);
        sumX2 += (x * x);
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    const yMean = sumY / n;
    let ssRes = 0;
    let ssTot = 0;

    for (let i = 0; i < n; i++) {
        const x = i;
        const y = dailyLog[i].totalAsset;
        const yPred = slope * x + intercept;
        ssRes += Math.pow(y - yPred, 2);
        ssTot += Math.pow(y - yMean, 2);
    }

    if (ssTot === 0) return 0;
    return 1 - (ssRes / ssTot);
}

// --- MAIN FUNCTIONS ---

export async function runDeepMind(soxlData, qqqData, config, onProgress) {
    // Defensive Polling: Check if arguments are shifted (Old Signature Support)
    if (typeof config === 'function' && onProgress === undefined) {
        console.warn("DeepMind: Detected old signature (config is function). Swapping.");
        onProgress = config;
        config = {};
    }

    console.log("DeepMind Start. Config:", config, "onProgress Type:", typeof onProgress);

    const results = [];
    const iterations = (config && config.iterations) ? config.iterations : 500;
    const chunkSize = 50;

    for (let i = 0; i < iterations; i += chunkSize) {

        await new Promise(resolve => setTimeout(resolve, 0));

        if (onProgress && typeof onProgress === 'function') {
            try {
                onProgress(i, iterations);
            } catch (err) {
                console.error("onProgress reporting failed:", err);
            }
        }

        for (let j = 0; j < chunkSize && (i + j) < iterations; j++) {
            const params = {
                initialCapital: 10000,
                feeRate: 0,
                startDate: "2011-03-11",
                endDate: "2025-12-31",
                useRealTier: false,

                safe: {
                    buyLimit: randomRange(config.safe.buyLimit[0], config.safe.buyLimit[1], 0.1),
                    target: randomRange(config.safe.target[0], config.safe.target[1], 0.1),
                    timeCut: randomInt(config.safe.timeCut[0], config.safe.timeCut[1]),
                    weights: randomWeights()
                },
                offensive: {
                    buyLimit: randomRange(config.offensive.buyLimit[0], config.offensive.buyLimit[1], 0.1),
                    target: randomRange(config.offensive.target[0], config.offensive.target[1], 0.1),
                    timeCut: randomInt(config.offensive.timeCut[0], config.offensive.timeCut[1]),
                    weights: randomWeights()
                },
                rebalance: {
                    profitAdd: randomRange(config.rebalance.profitAdd[0], config.rebalance.profitAdd[1], 5),
                    lossSub: randomRange(config.rebalance.lossSub[0], config.rebalance.lossSub[1], 5)
                }
            };

            const result = runSimulation(soxlData, qqqData, params);

            // Basic Metrics
            const finalBalance = result.finalBalance;
            const startBalance = 10000;
            const years = (new Date(params.endDate) - new Date(params.startDate)) / (1000 * 60 * 60 * 24 * 365);
            const cagr = (Math.pow(finalBalance / startBalance, 1 / years) - 1) * 100;
            const mdd = result.maxDrawdown;

            // Advanced Metrics (Efficient Calc)
            // Need Trade History PnL % for SQN
            // Extract from Ledger to get NetPnL %
            const tradeRows = result.ledger.filter(r => r.sellDate && r.netPnLPct !== undefined);
            const trades = tradeRows.map(r => r.netPnLPct);
            const wins = trades.filter(p => p > 0).length;
            const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;

            // SQN
            const meanPnL = calculateMean(trades);
            const stdPnL = calculateStdDev(trades, meanPnL);
            const sqn = trades.length > 0 && stdPnL !== 0 ? (meanPnL / stdPnL) * Math.sqrt(trades.length) : 0;

            // Profit Factor (Gross Profit / Gross Loss)
            const grossProfit = tradeRows.reduce((sum, r) => sum + (r.netPnL > 0 ? r.netPnL : 0), 0);
            const grossLoss = Math.abs(tradeRows.reduce((sum, r) => sum + (r.netPnL < 0 ? r.netPnL : 0), 0));
            const pf = grossLoss > 0 ? grossProfit / grossLoss : grossProfit;

            results.push({
                id: i + j,
                cagr: cagr,
                mdd: mdd,
                winRate: winRate,
                sqn: sqn,
                pf: pf,
                params: params,
                result: result // Store full result? Memory heavy? Maybe just params. 
                // We need params for Step 2.
            });
        }
    }

    if (onProgress && typeof onProgress === 'function') {
        try {
            onProgress(iterations, iterations);
        } catch (err) {
            console.error("Final onProgress reporting failed:", err);
        }
    }

    // Sort by CAGR DESC
    results.sort((a, b) => b.cagr - a.cagr);

    // Return Top 10
    return results.slice(0, 10);
}

export async function runRobustnessTest(baseParams, soxlData, qqqData, onProgress) {
    console.log("Starting Robustness Analysis...");

    // 1,000 Random Periods
    // Period Length: 2~4 Months (60 ~ 120 Days)
    // Start Date: Random within 2011-03-11 ~ 2025-12-31 (minus duration)

    const iterations = 1000;
    const stats = {
        wins: 0,
        cagrs: [],
        mdds: [],
        sqns: [],
        rSq: [],
        winRates: []
    };

    const fullStart = new Date("2011-03-11").getTime();
    const fullEnd = new Date("2025-12-31").getTime();
    const dayMs = 86400000;
    const totalDays = (fullEnd - fullStart) / dayMs;

    const chunkSize = 50;

    for (let i = 0; i < iterations; i += chunkSize) {

        await new Promise(resolve => setTimeout(resolve, 0));
        if (onProgress && typeof onProgress === 'function') onProgress(i, iterations);

        for (let j = 0; j < chunkSize && (i + j) < iterations; j++) {

            // Random Duration: 60 to 120 days
            const durationDays = randomInt(60, 120);
            // Random Start: 0 to (Total - Duration)
            const startOffset = randomInt(0, Math.floor(totalDays - durationDays));

            const startDate = new Date(fullStart + (startOffset * dayMs));
            const endDate = new Date(startDate.getTime() + (durationDays * dayMs));

            const startDateStr = startDate.toISOString().split('T')[0];
            const endDateStr = endDate.toISOString().split('T')[0];

            const params = {
                ...baseParams,
                startDate: startDateStr,
                endDate: endDateStr
            };

            const result = runSimulation(soxlData, qqqData, params);

            // Metrics
            const finalBalance = result.finalBalance;
            const startAsset = result.dailyLog.length > 0 ? result.dailyLog[0].totalAsset : params.initialCapital;

            // Survival (Profit > 0)
            const profit = finalBalance - startAsset;
            if (profit > 0) stats.wins++;

            // CAGR (Annualized)
            // For short periods, CAGR can be huge/weird. But requested "Avg CAGR".
            // Use (End/Start)^(365/Days) - 1
            const pReturn = finalBalance / startAsset;
            const years = durationDays / 365;
            const cagr = (Math.pow(pReturn, 1 / years) - 1) * 100;
            stats.cagrs.push(cagr);

            // MDD
            stats.mdds.push(result.maxDrawdown);

            // SQN
            const tradeRows = result.ledger.filter(r => r.sellDate && r.netPnLPct !== undefined);
            const trades = tradeRows.map(r => r.netPnLPct);
            const meanPnL = calculateMean(trades);
            const stdPnL = calculateStdDev(trades, meanPnL);
            const sqn = trades.length > 0 && stdPnL !== 0 ? (meanPnL / stdPnL) * Math.sqrt(trades.length) : 0;
            stats.sqns.push(sqn);

            // Avg Win Rate
            // For each simulation, calculating its Win Rate
            const nWins = trades.filter(p => p > 0).length;
            const winRate = trades.length > 0 ? (nWins / trades.length) * 100 : 0;
            stats.winRates.push(winRate);

            // R-Squared (Equity Curve)
            const r2 = calculateRSquared(result.dailyLog);
            stats.rSq.push(r2);
        }
    }

    if (onProgress && typeof onProgress === 'function') onProgress(iterations, iterations);

    // Aggregate
    return {
        survivalRate: (stats.wins / iterations) * 100,
        avgCagr: calculateMean(stats.cagrs),
        avgMdd: calculateMean(stats.mdds),
        avgSqn: calculateMean(stats.sqns),
        avgWinRate: calculateMean(stats.winRates),
        avgR2: calculateMean(stats.rSq)
    };
}

export async function runSensitivityTest(baseParams, soxlData, qqqData, onProgress) {
    console.log("Starting Sensitivity Analysis...");

    const range = 2.0;
    const step = 0.3;
    const grid = [];
    const cagrs = [];

    // Calculate Steps
    // -2.0, -1.7, ..., 0, ..., +2.0
    // To ensure we hit 0 exactly, we can generate indices relative to center.
    // 2.0 / 0.3 ~ 6.66 steps. Let's do roughly +/- 7 steps?
    // Or just precise float loop.

    // Let's use integer steps to avoid float issues, then multiply by 0.3
    // Max steps = floor(2.0 / 0.3) = 6 steps.
    // -6 to +6.  6 * 0.3 = 1.8.  7 * 0.3 = 2.1 (Exceeds 2.0? User said +/- 2% range).
    // User said "Range +/- 2%". If strictly <= 2.0, then +/- 6 steps covers +/- 1.8%.
    // If we want to cover fully 2.0, maybe +/- 7 steps (2.1%). Let's do +/- 7 steps to be safe.

    const steps = 7;
    const totalIterations = (steps * 2 + 1) * (steps * 2 + 1);
    let count = 0;

    let centerCagr = 0;

    for (let y = -steps; y <= steps; y++) {
        const dTarget = y * step; // Y-Axis: Target (Profit)

        for (let x = -steps; x <= steps; x++) {
            const dBuy = x * step; // X-Axis: Buy Limit

            // --- Construct Params ---
            // Only affect Safe & Offensive BuyLimit / Target
            // Be careful not to go below 0 if logic doesn't support it (usually limits are >= 0)

            const newParams = JSON.parse(JSON.stringify(baseParams));

            // Apply delta, clamp at 0 if needed (assuming limits shouldn't be negative?)
            // Usually BuyLimit can be 0 or small positive.
            // Target usually > 0.

            // Safe
            if (newParams.safe) {
                newParams.safe.buyLimit = Math.max(0, newParams.safe.buyLimit + dBuy);
                newParams.safe.target = Math.max(0, newParams.safe.target + dTarget);
            }
            // Offensive
            if (newParams.offensive) {
                newParams.offensive.buyLimit = Math.max(0, newParams.offensive.buyLimit + dBuy);
                newParams.offensive.target = Math.max(0, newParams.offensive.target + dTarget);
            }

            // Run Sim
            const res = runSimulation(soxlData, qqqData, newParams);

            // Calculate Metric (CAGR)
            const finalBalance = res.finalBalance;
            const startBalance = newParams.initialCapital;
            const years = (new Date(newParams.endDate) - new Date(newParams.startDate)) / (1000 * 60 * 60 * 24 * 365);
            const cagr = (Math.pow(finalBalance / startBalance, 1 / years) - 1) * 100;

            if (x === 0 && y === 0) {
                centerCagr = cagr;
            }

            grid.push({
                x: dBuy, // Buy Limit Delta
                y: dTarget, // Target Delta
                cagr: cagr
            });

            cagrs.push(cagr);

            count++;
            if (count % 10 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0)); // Yield
                if (onProgress && typeof onProgress === 'function') onProgress(count, totalIterations);
            }
        }
    }

    if (onProgress && typeof onProgress === 'function') onProgress(totalIterations, totalIterations);

    // CSR Calculation
    // CSR = Average Performance / Center Performance
    const avgCagr = calculateMean(cagrs);

    // Prevent divide by zero if center is 0 (unlikely for CAGR unless broke).
    // If centerCagr is roughly 0, score is undefined/large.
    // If centerCagr < 0, ratio meaning flips? 
    // Usually CSR assumes positive performance metric. 
    // If centerCagr <= 0, we return 0 or handle specifically.

    let csr = 0;
    if (centerCagr > 0) {
        csr = avgCagr / centerCagr;
    } else if (centerCagr < 0) {
        // If center is losing, and average is less losing (higher), CSR might be > 1 (good?)
        // But usually we trade for profit.
        csr = 0;
    }

    return {
        grid: grid,
        centerCagr: centerCagr,
        avgCagr: avgCagr,
        csr: csr,
        minCagr: Math.min(...cagrs),
        maxCagr: Math.max(...cagrs)
    };
}
