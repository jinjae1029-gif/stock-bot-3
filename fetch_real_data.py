
import yfinance as yf
import json
import os
from datetime import datetime

def fetch_and_save():
    print("Fetching Real Data from Yahoo Finance...")

    # 1. Fetch Data
    # SOXL: Daily
    print("Downloading SOXL...")
    soxl = yf.download("SOXL", start="2010-01-01", progress=True, auto_adjust=False)
    
    # QQQ: Daily (Logic.js aggregates to Weekly, but expects Daily input)
    print("Downloading QQQ...")
    qqq = yf.download("QQQ", start="2010-01-01", progress=True, auto_adjust=False)

    # 2. Format Data
    def format_data(df):
        data = []
        # MultiIndex handling for recent yfinance versions
        if isinstance(df.columns, pd.MultiIndex):
            # Flatten or extract Cross-Section
            try:
                # Try standard columns if available usually Open/High/Low/Close/Volume
                # If Multi-level 'Price' / 'Ticker'
                df_flat = df.stack(level=1).reset_index(level=1, drop=True)
                # This might be complex. Let's use simple extraction if Ticker is level 1
                pass 
            except:
                pass
        
        # Simpler approach: Iterate
        # yfinance (latest) returns columns like (Price, Ticker) -> ('Close', 'SOXL')
        
        for index, row in df.iterrows():
            date_str = index.strftime('%Y-%m-%d')
            
            # Extract values safely
            try: 
                # Should handle both MultiIndex and Single Index
                # If MultiIndex (Price, Ticker)
                if isinstance(df.columns, pd.MultiIndex):
                    o = row.loc[('Open', row.index.name if row.index.name else df.columns[0][1])] 
                    # This is tricky. Let's assume standard 'Open', 'High' etc keys exist or use .xs
                    # Easier: standard yf.download with single ticker returns single index.
                    pass
            except:
                pass

            # Safe extraction for Single Ticker download (which returns Single Index usually)
            # BUT verify: yf.download("SOXL") returns Single Index.
            
            # Correction: yf.download might return MultiIndex if auto_adjust=False?
            # Let's inspect columns or just access by name.
            
            try:
                # Single level access
                open_val = float(row['Open'])
                high_val = float(row['High'])
                low_val  = float(row['Low'])
                close_val= float(row['Close'])
                vol_val  = int(row['Volume'])
            except:
                # Multi-level access (Ticker as column level)
                ticker = df.columns.get_level_values(1)[0]
                open_val = float(row['Open'][ticker])
                high_val = float(row['High'][ticker])
                low_val  = float(row['Low'][ticker])
                close_val= float(row['Close'][ticker])
                vol_val  = int(row['Volume'][ticker])

            data.append({
                "date": date_str,
                "open": round(open_val, 2),
                "high": round(high_val, 2),
                "low":  round(low_val, 2),
                "close": round(close_val, 2),
                "volume": vol_val
            })
        return data

    # Re-download individually to ensure Single Index structure which is easier
    print("Processing SOXL...")
    soxl_single = yf.Ticker("SOXL").history(start="2010-01-01", end=None, auto_adjust=False)
    # yf.Ticker.history returns single index dataframe ALWAYS.
    
    print("Processing QQQ...")
    qqq_single = yf.Ticker("QQQ").history(start="2010-01-01", end=None, auto_adjust=False)

    def process_history(df):
        arr = []
        # Index is Datetime
        for date, row in df.iterrows():
            arr.append({
                "date": date.strftime("%Y-%m-%d"),
                "open": round(row['Open'], 2),
                "high": round(row['High'], 2),
                "low": round(row['Low'], 2),
                "close": round(row['Close'], 2),
                "volume": int(row['Volume'])
            })
        return arr

    soxl_json = process_history(soxl_single)
    qqq_json = process_history(qqq_single)

    # 3. Write to js/data.js
    file_path = "js/data.js"
    content = f"export const SOXL_DATA = {json.dumps(soxl_json)};\n"
    content += f"export const QQQ_DATA = {json.dumps(qqq_json)};\n"

    with open(file_path, "w", encoding='utf-8') as f:
        f.write(content)

    print(f"\nSuccessfully updated {file_path}")
    print(f"SOXL Records: {len(soxl_json)}")
    print(f"QQQ Records: {len(qqq_json)}")
    print(f"Last Date: {soxl_json[-1]['date']}")

if __name__ == "__main__":
    import pandas as pd # Ensure pandas is imported
    fetch_and_save()
