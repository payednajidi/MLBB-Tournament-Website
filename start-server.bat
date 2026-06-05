@echo off
echo Starting MLBB Tournament Website...
echo Open your browser at: http://localhost:3000
echo Press Ctrl+C to stop the server.
echo.
npx serve . -p 3000
pause

cd "C:\Users\aboom\MLBB Tournament Website"
npx serve . -p 3000

http://localhost:3000/index.html