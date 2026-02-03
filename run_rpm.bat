@echo off
echo Installing dependencies...
pip install pandas numpy yfinance google-generativeai

echo.
echo Starting RPM (Real-Time Pattern Machine)...
python rpm_calculator.py
pause
