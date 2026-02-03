
// import { RPM_DATA } from './rpm_data.js'; // Removed for local file compatibility

// --- Helper Functions ---
function setCard(id, value, status, desc, mood) {
    const card = document.getElementById(`card-${id}`);
    const valEl = document.getElementById(`val-${id}`);
    const statusEl = document.getElementById(`status-${id}`);
    const descEl = document.getElementById(`desc-${id}`);

    if (valEl) valEl.innerText = value;
    if (statusEl) statusEl.innerText = status;
    if (descEl) descEl.innerText = desc;

    // Apply Mood Colors
    card.classList.remove('border-bullish', 'border-bearish', 'border-neutral');
    statusEl.classList.remove('status-bullish', 'status-bearish', 'status-neutral');

    if (mood === 'bullish' || mood === 'overbought') {
        card.classList.add('border-bullish');
        statusEl.classList.add('status-bullish');
    } else if (mood === 'bearish' || mood === 'oversold') {
        card.classList.add('border-bearish');
        statusEl.classList.add('status-bearish');
    } else {
        card.classList.add('border-neutral');
        statusEl.classList.add('status-neutral');
    }
}

function processIndicators(data) {
    const i = data.indicators;

    // 1. RSI
    let rsiMood = 'neutral';
    let rsiStatus = '중립 구간';
    let rsiDesc = '추세 지속 가능성';
    if (i.rsi >= 70) { rsiMood = 'bullish'; rsiStatus = '과매수 구간'; rsiDesc = '단기 조정 가능성 염두'; }
    else if (i.rsi <= 30) { rsiMood = 'bearish'; rsiStatus = '과매도 구간'; rsiDesc = '저점 매수 기회 탐색'; }
    setCard('rsi', i.rsi, rsiStatus, rsiDesc, rsiMood);

    // 2. Disparity 20
    let d20Mood = 'neutral';
    let d20Status = '정상 범위';
    if (i.disparity_20 >= 105) { d20Mood = 'bullish'; d20Status = '단기 과열'; }
    else if (i.disparity_20 <= 95) { d20Mood = 'bearish'; d20Status = '단기 침체'; }
    setCard('disp20', i.disparity_20 + '%', d20Status, '이평선 대비 괴리율', d20Mood);

    // 3. ROC 10
    let rocMood = 'neutral';
    if (i.roc_10 > 5) rocMood = 'bullish';
    if (i.roc_10 < -5) rocMood = 'bearish';
    setCard('roc10', i.roc_10 + '%', rocMood === 'bullish' ? '상승 추세' : '하락/보합', '10일 전 대비 등락', rocMood);

    // 4. MACD
    let macdMood = 'neutral';
    if (i.macd_hist > 0) macdMood = 'bullish';
    else macdMood = 'bearish';
    setCard('macd', i.macd_hist, macdMood === 'bullish' ? '상승 모멘텀' : '하락 모멘텀', 'MACD 히스토그램', macdMood);

    // 5. BW
    setCard('bw', i.volatility_width, '변동성 지표', '볼린저 밴드 폭', 'neutral');

    // 6. ATR
    setCard('atr', i.atr_pct + '%', '변동성 비율', 'ATR / Price', 'neutral');

    // 7. Disp 60
    let d60Mood = 'neutral';
    if (i.disparity_60 >= 110) d60Mood = 'bullish';
    setCard('disp60', i.disparity_60 + '%', d60Mood === 'bullish' ? '중장기 과열?' : '일반', '60일선 이격', d60Mood);

    // 8. Stoch K
    let stochMood = 'neutral';
    if (i.stoch_k >= 80) stochMood = 'bullish'; // Overbought
    else if (i.stoch_k <= 20) stochMood = 'bearish'; // Oversold
    setCard('stoch', i.stoch_k + '%', stochMood === 'bullish' ? '과매수' : (stochMood === 'bearish' ? '과매도' : '중립'), '스토캐스틱 K', stochMood);
}

function processReport(data) {
    const reportContainer = document.getElementById('ai-report-content');

    // Detect if we have a valid markdown report
    if (!data.ai_report || data.ai_report.startsWith("Error")) {
        reportContainer.innerHTML = "<p>AI 분석 리포트가 없습니다 (API Key 누락).</p>";
        return;
    }

    // Convert Markdown to HTML
    try {
        reportContainer.innerHTML = marked.parse(data.ai_report);
    } catch (e) {
        reportContainer.innerText = data.ai_report; // Fallback
    }
}

function processStats(data) {
    document.getElementById('similarity-score').innerText = data.similarity_score;
    // Check if element exists before setting (it was added in step 57, confirmed in view_file it is in HTML but JS needs to match)
    if (document.getElementById('ticker-display')) {
        document.getElementById('ticker-display').innerText = data.ticker || "SOXL";
    }

    const s5 = document.getElementById('stat-5d');
    const s30 = document.getElementById('stat-30d');

    s5.innerText = data.stats.avg_return_5d + '%';
    s30.innerText = data.stats.avg_return_30d + '%';

    if (data.stats.avg_return_5d > 0) s5.style.color = '#ef5350';
    else s5.style.color = '#29b6f6';

    if (data.stats.avg_return_30d > 0) s30.style.color = '#ef5350';
    else s30.style.color = '#29b6f6';

    // List
    const list = document.getElementById('match-list');
    list.innerHTML = '';
    data.top_matches.slice(0, 5).forEach(m => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${m.date}</span> <span style="color:#888">Dist: ${m.distance}</span>`;
        list.appendChild(li);
    });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    if (typeof RPM_DATA === 'undefined') {
        alert("데이터 파일(js/rpm_data.js)을 찾을 수 없습니다.\nrun_rpm.bat를 실행했는지 확인해주세요.");
        document.getElementById('ticker-display').innerText = "DATA NOT FOUND";
        return;
    }
    console.log("Loading RPM Data...", RPM_DATA);

    // Date Check Alert if old data
    const today = new Date().toISOString().split('T')[0];
    // Simple check: Just show the data date

    processIndicators(RPM_DATA);
    processReport(RPM_DATA);
    processStats(RPM_DATA);
});
