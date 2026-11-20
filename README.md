# SeatFinder (M4) - Step 2: backend
1. cp .env.example .env   (fill DATABASE_URL and TOKEN_SECRET)
2. npm install
3. npm run db:init && npm run seed
4. npm start   -> http://localhost:3000/health
For quick testing set BREAK_MINUTES=1 and BOOK_MINUTES=1 in .env.
