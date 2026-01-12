# Server Implementation Examples

This folder contains example code files to help you implement the server-side slot game.

## Files

1. **server.js** - Basic Express.js server implementation with:
   - Server-side RNG (Random Number Generator)
   - Win calculation logic
   - API endpoints for game operations
   - Session management
   - RTP tracking

2. **client_integration.js** - Client-side code examples showing how to:
   - Initialize server session
   - Make spin requests to server
   - Handle server responses
   - Integrate with existing SlotGame class

3. **database_schema.sql** - PostgreSQL database schema with:
   - Players table
   - Game sessions table
   - Spins transaction log
   - Balance transactions audit trail
   - RTP tracking tables
   - Useful views for reporting

4. **package.json** - Node.js dependencies needed for the server

## Quick Start

### 1. Install Dependencies

```bash
cd server_examples
npm install
```

### 2. Set Up Database

```bash
# Create PostgreSQL database
createdb slot_game_db

# Run schema
psql slot_game_db < database_schema.sql
```

### 3. Configure Environment

Create `.env` file:
```
PORT=3000
JWT_SECRET=your-secret-key-change-this-in-production
DATABASE_URL=postgresql://user:password@localhost/slot_game_db
```

### 4. Start Server

```bash
npm start
# or for development with auto-reload
npm run dev
```

### 5. Test Endpoints

```bash
# Health check
curl http://localhost:3000/api/health

# Initialize session
curl -X POST http://localhost:3000/api/game/session/init \
  -H "Content-Type: application/json" \
  -d '{"playerId": "test123", "initialBalance": 10000}'

# Place spin (use token from session init)
curl -X POST http://localhost:3000/api/game/spin \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{"betAmount": 10, "lineBet": 1, "linesCount": 10}'
```

## Important Notes

⚠️ **These are example files - you need to:**

1. **Complete the implementation:**
   - Full payline matching logic
   - Scatter win calculation
   - Jackpot handling
   - Wild symbol substitution
   - Error handling

2. **Add security:**
   - Input validation
   - Rate limiting
   - SQL injection prevention
   - XSS protection
   - HTTPS enforcement

3. **Add database connection:**
   - Replace in-memory storage with database
   - Use connection pooling
   - Add transactions for consistency

4. **Add proper authentication:**
   - User registration/login
   - Password hashing
   - Session management
   - Token refresh

5. **Add monitoring:**
   - Logging
   - Error tracking
   - Performance monitoring
   - RTP alerts

## Next Steps

1. Review the main `SERVER_IMPLEMENTATION_PLAN.md`
2. Adapt these examples to your specific needs
3. Implement missing game logic
4. Add comprehensive error handling
5. Set up production environment
6. Load testing
7. Security audit
