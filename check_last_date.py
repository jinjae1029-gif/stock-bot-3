
import re

try:
    with open(r'c:/Users/dlwls/Documents/이진재 개인/backtest-app/js/data.js', 'r', encoding='utf-8') as f:
        content = f.read()
        # Look for "date": "YYYY-MM-DD" patterns
        dates = re.findall(r'"date":\s*"(\d{4}-\d{2}-\d{2})"', content)
        if dates:
            print(f"Last 5 dates found: {dates[-5:]}")
            print(f"LAST DATE: {dates[-1]}")
        else:
            print("No dates found.")
except Exception as e:
    print(f"Error: {e}")
