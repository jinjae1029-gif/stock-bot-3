
import yfinance as yf
import json
import time
import schedule
import datetime
import os

def job():
    print(f"\n[Auto-Update] Starting data fetch at {datetime.datetime.now()}...")
    try:
        # 1. Fetch Data
        # SOXL: Daily
        soxl_single = yf.Ticker("SOXL").history(start="2010-01-01", end=None, auto_adjust=False)
        qqq_single = yf.Ticker("QQQ").history(start="2010-01-01", end=None, auto_adjust=False)

        def process_history(df):
            arr = []
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

        # 2. Write to js/data.js
        file_path = "js/data.js"
        content = f"export const SOXL_DATA = {json.dumps(soxl_json)};\n"
        content += f"export const QQQ_DATA = {json.dumps(qqq_json)};\n"

        with open(file_path, "w", encoding='utf-8') as f:
            f.write(content)

        print(f"[Auto-Update] Success! Updated js/data.js. SOXL: {len(soxl_json)} records.")
        print(f"Last Date: {soxl_json[-1]['date']}")
        
    except Exception as e:
        print(f"[Auto-Update] Error: {e}")

# Run once immediately on start
job()

# Schedule to run every 1 hour (You can adjust this)
schedule.every(60).minutes.do(job)

# Schedule to run specifically at market close (e.g., 05:00 AM KST is 4 PM ET roughly, but safer to just poll)
# schedule.every().day.at("06:00").do(job) 

print("==============================================")
print("   Auto Data Updater is Running... (Ctrl+C to stop)")
print("   - Updates js/data.js every 60 minutes.")
print("==============================================")

while True:
    schedule.run_pending()
    time.sleep(1)
