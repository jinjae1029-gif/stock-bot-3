
import { SOXL_DATA } from './js/data.js';
import { runSimulation } from './js/logic.js';

const params = {
    initialCapital: 10000,
    startDate: "2010-01-01",
    endDate: "2025-12-31",
    timeCut: 50,
    target: 10,
    safe: { buyLimit: 5, target: 10, timeCut: 50, weights: [10, 20, 30, 40] },
    offensive: { buyLimit: 5, target: 10, timeCut: 50, weights: [10, 20, 30, 40] },
    rebalance: { profitAdd: 0, lossSub: 0 },
    // Mock QQQ data if needed, or function handles empty map
    qqq: []
};

try {
    console.log("Starting Simulation...");
    const result = runSimulation(params, SOXL_DATA, []);
    console.log("Simulation Completed.");
    console.log("History Count:", result.history.length);
    console.log("Ledger Count:", result.ledger.length);
    if (result.ledger.length > 0) {
        // Print the row for 2018-01-10 and 2018-01-11
        const targetRows = result.ledger.filter(r => r.date === '2018-01-10' || r.date === '2018-01-11');
        console.log("Target Rows (Jan 10-11 2018):", JSON.stringify(targetRows, null, 2));
    }
} catch (e) {
    console.error("Simulation Crashed:");
    console.error(e);
}
