
import yfinance as yf
import pandas as pd
import numpy as np
import google.generativeai as genai
import os
import sys

# --- CONFIGURATION ---
TICKER = "SOXL" # Primary Ticker
START_DATE = "2011-03-01"

# API KEY CONFIGURATION
# You can hardcode your key here or set it as an environment variable
# os.environ["GOOGLE_API_KEY"] = "YOUR_KEY_HERE"
API_KEY = os.getenv("GOOGLE_API_KEY")

def fetch_data(ticker):
    print(f"Fetching data for {ticker}...")
    df = yf.download(ticker, start=START_DATE, progress=False, auto_adjust=False, interval='1d')
    
    # Handle MultiIndex if present (yfinance update)
    if isinstance(df.columns, pd.MultiIndex):
        try:
            df = df.xs(ticker, level=1, axis=1)
        except:
            pass
            
    # Ensure standard columns
    df = df.rename(columns={
        "Open": "open", "High": "high", "Low": "low", "Close": "close", "Volume": "volume"
    })
    
    # Ensure float
    for col in ['open', 'high', 'low', 'close', 'volume']:
        df[col] = df[col].astype(float)
        
    return df

# --- INDICATOR CALCULATIONS ---
def calculate_indicators(df):
    df = df.copy()
    close = df['close']
    high = df['high']
    low = df['low']

    # 1. RSI (14)
    delta = close.diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=14).mean() # SMA RSI (Cutler's) as per previous logic? 
    # Standard Wilder's RSI is usually preferred, but user's logic.js used SMA. 
    # Let's use Wilder's method which is standard for "RSI 14".
    # Or actually, logic.js used simple average. Let's stick to standard Wilder for "RPM" unless specified.
    # Actually, the user said "Match Python: diff.rolling(window).mean()" in logic.js comments. 
    # So I will use simple moving average for RSI as per their codebase preference.
    gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
    rs = gain / loss
    df['rsi'] = 100 - (100 / (1 + rs))

    # 2. Disparity 20 (이격도 20)
    # (Close / MA20) * 100
    ma20 = close.rolling(window=20).mean()
    df['disparity_20'] = (close / ma20) * 100

    # 3. ROC 10 (Rate of Change)
    # ((Close - Close_n) / Close_n) * 100
    df['roc_10'] = close.pct_change(periods=10) * 100

    # 4. MACD Histogram
    # EMA 12, EMA 26
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    macd_line = ema12 - ema26
    signal_line = macd_line.ewm(span=9, adjust=False).mean()
    df['macd_hist'] = macd_line - signal_line

    # 5. Volatility Width (Bandwidth)
    # (Upper - Lower) / Middle
    # BB (20, 2)
    std20 = close.rolling(window=20).std()
    upper = ma20 + (std20 * 2)
    lower = ma20 - (std20 * 2)
    df['volatility_width'] = (upper - lower) / ma20

    # 6. ATR (14)
    # TR = Max(High-Low, Abs(High-PrevClose), Abs(Low-PrevClose))
    prev_close = close.shift(1)
    tr1 = high - low
    tr2 = (high - prev_close).abs()
    tr3 = (low - prev_close).abs()
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    df['atr'] = tr.rolling(window=14).mean() # Using SMA for ATR to verify consistency easily
    # To normalize ATR often people use ATR% = ATR / Close * 100
    df['atr_pct'] = (df['atr'] / close) * 100 

    # 7. Disparity 60 (이격도 60)
    ma60 = close.rolling(window=60).mean()
    df['disparity_60'] = (close / ma60) * 100

    # 8. Stochastic K (14, 3, 3 usually, or just K)
    # %K = (Current Close - Lowest Low) / (Highest High - Lowest Low) * 100
    # Period 14
    low_14 = low.rolling(window=14).min()
    high_14 = high.rolling(window=14).max()
    k_raw = 100 * (close - low_14) / (high_14 - low_14)
    # Usually smoothed with SMA(3)
    df['stoch_k'] = k_raw.rolling(window=3).mean()

    return df

# --- SIMILARITY SEARCH ---
def find_similar_patterns(df, target_date=None, top_n=20):
    # Features to compare
    features = ['rsi', 'disparity_20', 'roc_10', 'macd_hist', 'volatility_width', 'atr_pct', 'disparity_60', 'stoch_k']
    
    # Debug: Check last row
    last_row = df.iloc[-1]
    print(f"\n[DEBUG] Raw Data Last Date: {last_row.name.strftime('%Y-%m-%d')}")
    print("[DEBUG] Feature Check for Last Row:")
    for f in features:
        val = last_row[f]
        print(f"  - {f}: {val}")
        if pd.isna(val):
            print(f"    WARNING: {f} is NaN! This row might be dropped.")

    # Drop NaN
    valid_df = df.dropna(subset=features).copy()
    
    if target_date is None:
        # Check if valid_df is empty or last row of original df is missing in valid_df
        if valid_df.empty:
            print("ERROR: No valid data found after dropping NaNs.")
            return df.iloc[-1], pd.DataFrame(), df # Return raw last row anyway
            
        target_row = valid_df.iloc[-1]
    else:
        try:
            target_row = valid_df.loc[target_date]
        except KeyError:
            print(f"Date {target_date} not found. Using last available date.")
            target_row = valid_df.iloc[-1]

    print(f"[DEBUG] Selected Target Date for Analysis: {target_row.name.strftime('%Y-%m-%d')}")

    target_vec = target_row[features].values.astype(float)
    
    # Normalize features for distance calculation (Z-score mostly)
    means = valid_df[features].mean()
    stds = valid_df[features].std()
    
    norm_df = (valid_df[features] - means) / stds
    target_norm = (target_vec - means.values) / stds.values
    
    # Calculate Euclidean Distance
    distances = np.linalg.norm(norm_df.values - target_norm, axis=1)
    
    valid_df['distance'] = distances
    
    # Exclude the target date itself from results if it's in the list
    if target_date is None:
        # Exclude the very last row (today)
        search_pool = valid_df.iloc[:-1]
    else:
        search_pool = valid_df[valid_df.index != target_date]
        
    search_pool = search_pool.sort_values('distance')
    top_matches = search_pool.head(top_n)
    
    return target_row, top_matches, df

# --- GEMINI ANALYSIS ---
def generate_gemini_report(target_row, top_matches, df, api_key):
    if not api_key:
        return "Error: No API Key provided."
        
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel('gemini-1.5-flash') 
    # Or gemini-pro if available/preferred
    
    # Prepare prompt data
    # 1. Current Indicators
    current_data_str = f"""
    [Analysis Date]: {target_row.name.strftime('%Y-%m-%d')}
    [Current 8 Major Indicators]
    1. RSI (14): {target_row['rsi']:.2f}
    2. Disparity 20: {target_row['disparity_20']:.2f}%
    3. ROC 10: {target_row['roc_10']:.2f}%
    4. MACD Hist: {target_row['macd_hist']:.4f}
    5. Volatility Width (BW): {target_row['volatility_width']:.4f}
    6. ATR %: {target_row['atr_pct']:.2f}%
    7. Disparity 60: {target_row['disparity_60']:.2f}%
    8. Stochastic K: {target_row['stoch_k']:.2f}%
    """
    
    # 2. Top Matches Data (Date, Price, +5d return, +30d return)
    matches_str = "Top 20 Similar Past Patterns:\n"
    future_returns_5d = []
    future_returns_30d = []
    
    for date, row in top_matches.iterrows():
        # Find future returns
        # date is the index
        idx_loc = df.index.get_loc(date)
        
        # Check bounds
        if idx_loc + 5 < len(df):
            price_now = df.iloc[idx_loc]['close']
            price_5d = df.iloc[idx_loc + 5]['close']
            ret_5d = ((price_5d - price_now) / price_now) * 100
            future_returns_5d.append(ret_5d)
        else:
            ret_5d = np.nan
            
        if idx_loc + 30 < len(df):
            price_now = df.iloc[idx_loc]['close']
            price_30d = df.iloc[idx_loc + 30]['close']
            ret_30d = ((price_30d - price_now) / price_now) * 100
            future_returns_30d.append(ret_30d)
        else:
            ret_30d = np.nan
            
        matches_str += f"- {date.strftime('%Y-%m-%d')}: Dist={row['distance']:.2f}, RSI={row['rsi']:.1f}, 5d_Ret={ret_5d:.2f}%, 30d_Ret={ret_30d:.2f}%\n"

    avg_5d = np.nanmean(future_returns_5d)
    avg_30d = np.nanmean(future_returns_30d)
    
    prompt = f"""
    You are the "RPM (Real-Time Pattern Machine) AI Analyst". Your job is to analyze stock market data based on 8 specific technical indicators and historical similarity patterns.

    HERE IS THE DATA:
    {current_data_str}

    [Historical Pattern Analysis]
    We found the following 20 dates in the past that had the most similar technical indicator setup to today:
    {matches_str}

    Average Return after 5 days for these cases: {avg_5d:.2f}%
    Average Return after 30 days for these cases: {avg_30d:.2f}%

    ---

    PLEASE GENERATE A REPORT IN KOREAN WITH THE FOLLOWING SECTIONS:

    1. **8대 지표 상세 분석**: Interpret each of the 8 indicators (Overbought/Oversold, Trend, Volatility, etc.). Be specific.
    2. **종합 기술적 진단**: Synthesize the indicators. Is it valid to buy? Sell? Wait?
    3. **과거 유사 패턴 분석**: Discuss the top similar dates. Did they typically rise or fall afterwards?
    4. **미래 시나리오 예측**: Based on the historical average returns (+5d: {avg_5d:.2f}%, +30d: {avg_30d:.2f}%), predict the likely short-term and medium-term movement.
    5. **Final Verdict**: Clear recommendation (Aggressive Buy, Buy on Dip, Hold, Sell, etc.) and a "Confidence Score" (0-100).
    
    Output strictly in Markdown format. Use professional financial tone.
    """
    
    print("\nGenerating AI Report... (This may take a few seconds)")
    response = model.generate_content(prompt)
    return response.text

# --- MAIN EXECUTION ---
def main():
    # Check for API Key
    user_key = input("Enter your Google AI Studio API Key (Press Enter to skip if using env var): ").strip()
    if user_key:
        global API_KEY
        API_KEY = user_key
        
    if not API_KEY:
        print("WARNING: No API Key found. AI Report will be skipped.")
    
    # 1. Fetch
    print(f"Fetching data for {TICKER} (Start: {START_DATE})...")
    df = fetch_data(TICKER)
    print(" [100%] Data Fetch Completed.")
    
    # 2. Calculate
    print("Calculating Indicators...")
    df_ind = calculate_indicators(df)
    print(" [100%] Indicator Calculation Completed.")
    
    # 3. Find Similar
    print("Finding Similar Patterns...")
    target_row, top_matches, full_df = find_similar_patterns(df_ind)
    print(" [100%] Similarity Search Completed.")
    
    print("\n" + "="*50)
    print(f"RPM ANALYSIS FOR {TICKER} on {target_row.name.strftime('%Y-%m-%d')}")
    print("="*50)
    print(f"RSI (14):          {target_row['rsi']:.2f}")
    print(f"Disparity 20:      {target_row['disparity_20']:.2f}%")
    print(f"ROC 10:            {target_row['roc_10']:.2f}%")
    print(f"MACD Hist:         {target_row['macd_hist']:.4f}")
    print(f"Volatility Width:  {target_row['volatility_width']:.4f}")
    print(f"ATR %:             {target_row['atr_pct']:.2f}%")
    print(f"Disparity 60:      {target_row['disparity_60']:.2f}%")
    print(f"Stochastic K:      {target_row['stoch_k']:.2f}")
    print("-" * 50)
    
    
    # 5. Export to JS
    export_data(target_row, top_matches, report if API_KEY else "AI Analysis Skipped (No Key)", avg_5d, avg_30d)

def export_data(target_row, top_matches, ai_report, avg_5d, avg_30d):
    import json
    
    # Prepare data dictionary
    data = {
        "ticker": TICKER, # Export Ticker
        "date": target_row.name.strftime('%Y-%m-%d'),
        "similarity_score": round(1000 - (top_matches.iloc[0]['distance'] * 100), 2), # Mock score based on distance
        "indicators": {
            "rsi": round(target_row['rsi'], 2),
            "disparity_20": round(target_row['disparity_20'], 2),
            "roc_10": round(target_row['roc_10'], 2),
            "macd_hist": round(target_row['macd_hist'], 4),
            "volatility_width": round(target_row['volatility_width'], 4),
            "atr_pct": round(target_row['atr_pct'], 2),
            "disparity_60": round(target_row['disparity_60'], 2),
            "stoch_k": round(target_row['stoch_k'], 2)
        },
        "stats": {
            "avg_return_5d": round(avg_5d, 2) if not np.isnan(avg_5d) else 0,
            "avg_return_30d": round(avg_30d, 2) if not np.isnan(avg_30d) else 0
        },
        "ai_report": ai_report,
        "top_matches": []
    }
    
    for date, row in top_matches.iterrows():
        data["top_matches"].append({
            "date": date.strftime('%Y-%m-%d'),
            "distance": round(row['distance'], 4),
            "rsi": round(row['rsi'], 2)
        })

    # Write to file - Use Absolute Path to be safe
    base_dir = os.path.dirname(os.path.abspath(__file__))
    js_dir = os.path.join(base_dir, "js")
    if not os.path.exists(js_dir):
        os.makedirs(js_dir)
        
    file_path = os.path.join(js_dir, "rpm_data.js")
    content = f"window.RPM_DATA = {json.dumps(data, indent=4)};"
    
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"\nData exported to '{file_path}'")

if __name__ == "__main__":
    main()
