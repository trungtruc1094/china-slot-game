# Server-Side Implementation Plan for Slot Game

## Executive Summary
This document outlines a comprehensive plan to transform the client-side slot game into a secure, server-controlled game that ensures profitability and prevents cheating.

---

## 🎯 Goals
1. **Prevent Client-Side Manipulation** - All outcomes determined server-side
2. **Control RTP (Return to Player)** - Maintain predictable profitability (e.g., 94-96% RTP)
3. **Secure Transactions** - All bets and payouts validated server-side
4. **Audit Trail** - Complete logging for regulatory compliance
5. **Scalability** - Support multiple concurrent players

---

## 📋 Implementation Steps

### **Phase 1: Server Architecture Setup**

#### Step 1.1: Choose Backend Technology Stack
**Recommended Options:**
- **Node.js + Express** (matches JavaScript frontend)
- **Python + Flask/FastAPI** (good for game logic)
- **C# + ASP.NET Core** (enterprise-grade)

**Recommendation:** Node.js + Express for consistency with frontend

#### Step 1.2: Database Schema Design
**Required Tables:**

```sql
-- Players/Sessions
players (
    id INT PRIMARY KEY,
    username VARCHAR(255),
    balance DECIMAL(10,2),
    session_token VARCHAR(255),
    created_at TIMESTAMP
)

-- Game Sessions
game_sessions (
    id INT PRIMARY KEY,
    player_id INT,
    session_token VARCHAR(255),
    start_balance DECIMAL(10,2),
    current_balance DECIMAL(10,2),
    status VARCHAR(50), -- active, completed, expired
    started_at TIMESTAMP,
    ended_at TIMESTAMP
)

-- Spin Transactions
spins (
    id INT PRIMARY KEY,
    session_id INT,
    player_id INT,
    spin_number INT,
    bet_amount DECIMAL(10,2),
    line_bet DECIMAL(10,2),
    lines_count INT,
    total_bet DECIMAL(10,2),
    reel_positions TEXT, -- JSON: [reel0_pos, reel1_pos, ...]
    win_amount DECIMAL(10,2),
    win_type VARCHAR(50), -- line_win, scatter_win, jackpot, none
    rtp_seed BIGINT, -- server-generated seed for this spin
    server_hash VARCHAR(255), -- hash of outcome for verification
    client_hash VARCHAR(255), -- hash from client for verification
    balance_before DECIMAL(10,2),
    balance_after DECIMAL(10,2),
    created_at TIMESTAMP,
    INDEX(player_id, created_at)
)

-- Balance Transactions
balance_transactions (
    id INT PRIMARY KEY,
    player_id INT,
    transaction_type VARCHAR(50), -- bet, win, deposit, withdrawal
    amount DECIMAL(10,2),
    balance_before DECIMAL(10,2),
    balance_after DECIMAL(10,2),
    reference_id INT, -- spin_id or deposit_id
    created_at TIMESTAMP
)

-- Configuration (RTP settings)
game_config (
    id INT PRIMARY KEY,
    rtp_percentage DECIMAL(5,2), -- e.g., 94.50
    min_bet DECIMAL(10,2),
    max_bet DECIMAL(10,2),
    house_edge DECIMAL(5,2),
    updated_at TIMESTAMP
)
```

---

### **Phase 2: Server-Side Game Logic**

#### Step 2.1: Implement Server-Side RNG (Random Number Generator)
**Location:** `server/gameLogic/rng.js` or `server/gameLogic/rng.py`

**Critical Requirements:**
- Use cryptographically secure RNG (CSPRNG)
- Generate seeds server-side only
- Never expose seed generation to client

**Node.js Example:**
```javascript
const crypto = require('crypto');

class ServerRNG {
    // Generate secure random seed
    generateSeed() {
        return crypto.randomBytes(32).toString('hex');
    }
    
    // Generate random position for reel using seed
    getReelPosition(reelIndex, seed) {
        const hash = crypto.createHash('sha256')
            .update(`${seed}-${reelIndex}`)
            .digest('hex');
        const hashInt = parseInt(hash.substring(0, 8), 16);
        // Use modulo based on reel length
        return hashInt % this.getReelLength(reelIndex);
    }
    
    // Get all reel positions for a spin
    generateSpinOutcome(seed, reelLengths) {
        const outcome = [];
        for (let i = 0; i < reelLengths.length; i++) {
            outcome.push(this.getReelPosition(i, seed));
        }
        return outcome;
    }
}
```

#### Step 2.2: Server-Side Win Calculation
**Location:** `server/gameLogic/winCalculator.js`

**Functions Needed:**
- Calculate line wins based on reel positions
- Calculate scatter wins
- Calculate jackpot wins
- Apply RTP control if needed
- Return total win amount

**RTP Control Strategy:**
```javascript
class WinCalculator {
    constructor(config) {
        this.config = config; // Paylines, symbol distribution
        this.targetRTP = 94.5; // 94.5% RTP (5.5% house edge)
    }
    
    calculateWin(reelPositions, betAmount, linesCount) {
        // 1. Calculate base win from reel positions
        const baseWin = this.calculateBaseWin(reelPositions, linesCount);
        
        // 2. Apply RTP control if needed (optional - can use purely probability-based)
        // Option A: Probability-based (recommended)
        // - Control through symbol distribution on reels
        // - No outcome manipulation needed
        
        // Option B: Outcome manipulation (use sparingly)
        // - Only for fine-tuning if probability-based isn't precise enough
        const adjustedWin = this.applyRTPControl(baseWin, betAmount);
        
        return {
            winAmount: adjustedWin,
            reelPositions: reelPositions,
            winDetails: this.getWinDetails(reelPositions)
        };
    }
    
    // Calculate based on paytable
    calculateBaseWin(reelPositions, linesCount) {
        // Implementation: Check each payline, calculate wins
        // Same logic as client-side WinController but server-side
    }
    
    // Optional: Fine-tune RTP (use with caution)
    applyRTPControl(baseWin, betAmount) {
        // Track recent RTP
        const recentRTP = this.getRecentRTP();
        
        if (recentRTP < this.targetRTP - 0.5) {
            // Slightly increase win chance
            // Implementation depends on strategy
        } else if (recentRTP > this.targetRTP + 0.5) {
            // Slightly decrease win chance
        }
        
        return baseWin; // Most implementations use pure probability
    }
}
```

#### Step 2.3: Symbol Distribution & Probability Control
**Location:** `server/config/gameConfig.js`

**Key Point:** Control RTP through symbol distribution, not outcome manipulation.

```javascript
// Server-side reel configuration
const serverReels = [
    // Reel 0 - Adjust symbol frequency to control RTP
    {
        symbols: ['Fan', 'Sycee', 'J', 'Sycee', 'Q', 'CoinsHeap', 'Teapot', 'K', 'A', 'CoinsHeap'],
        // Add more low-value symbols to decrease RTP
        // Add more high-value symbols to increase RTP
    },
    // ... other reels
];

// Calculate expected RTP mathematically
function calculateExpectedRTP(reels, paytable) {
    // Monte Carlo simulation or mathematical calculation
    // This gives you the theoretical RTP
}
```

---

### **Phase 3: API Endpoints**

#### Step 3.1: Create REST API Endpoints

**Required Endpoints:**

```javascript
// 1. Initialize Session
POST /api/game/session/init
Request: { playerId: string, initialBalance: number }
Response: { sessionToken: string, balance: number }

// 2. Place Bet & Spin
POST /api/game/spin
Request: {
    sessionToken: string,
    betAmount: number,
    lineBet: number,
    linesCount: number
}
Response: {
    spinId: string,
    reelPositions: [number, number, number, number, number],
    winAmount: number,
    balance: number,
    winDetails: { type: string, lines: [] },
    serverHash: string // For verification
}

// 3. Verify Spin (for reconciliation)
POST /api/game/spin/verify
Request: {
    spinId: string,
    clientHash: string
}
Response: { valid: boolean, message: string }

// 4. Get Balance
GET /api/game/balance?sessionToken=xxx
Response: { balance: number }

// 5. Get Game History
GET /api/game/history?sessionToken=xxx&limit=50
Response: { spins: [...] }
```

#### Step 3.2: Request/Response Validation

**Security Measures:**
- JWT tokens for session management
- Rate limiting (max spins per minute)
- Input validation (bet amounts, limits)
- CSRF protection
- HTTPS only

---

### **Phase 4: Client-Side Modifications**

#### Step 4.1: Modify Spin Flow

**Current Flow (Client-Side):**
1. User clicks spin
2. Client generates random outcome
3. Client calculates win
4. Client updates balance

**New Flow (Server-Side):**
1. User clicks spin
2. Client sends bet request to server
3. Server generates outcome
4. Server calculates win
5. Server updates balance
6. Server sends outcome to client
7. Client displays outcome

**Code Changes Needed:**

**File: `js/slotGame.js`**

```javascript
// Add server communication
class ServerClient {
    constructor(apiBaseUrl, sessionToken) {
        this.apiBaseUrl = apiBaseUrl;
        this.sessionToken = sessionToken;
    }
    
    async placeSpin(betAmount, lineBet, linesCount) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/game/spin`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.sessionToken}`
                },
                body: JSON.stringify({
                    betAmount,
                    lineBet,
                    linesCount
                })
            });
            
            if (!response.ok) {
                throw new Error('Spin request failed');
            }
            
            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Spin error:', error);
            throw error;
        }
    }
}

// Modify runSlot() method
runSlot() {
    // 1. Validate bet locally first
    if (!this.slotControls.applyBet()) {
        return; // Insufficient balance
    }
    
    // 2. Lock UI
    this.spinButton.setEnabled(false);
    
    // 3. Request spin from server
    this.serverClient.placeSpin(
        this.slotControls.getTotalBet(),
        this.slotControls.lineBet,
        this.slotControls.selectedLinesCount
    ).then(serverResult => {
        // 4. Use server-provided reel positions
        this.useServerOutcome(serverResult);
        
        // 5. Update balance from server
        this.slotPlayer.setCoinsCount(serverResult.balance);
        
        // 6. Continue with win/loss display
        this.processSpinResult(serverResult);
        
    }).catch(error => {
        // Handle error - refund bet, show message
        this.handleSpinError(error);
    });
}

// New method: Use server outcome instead of generating locally
useServerOutcome(serverResult) {
    // Override reel stopping positions with server values
    // This replaces: r.getRandomOrderPosition()
    for (let i = 0; i < this.reels.length; i++) {
        this.reels[i].setStopPosition(serverResult.reelPositions[i]);
    }
}
```

#### Step 4.2: Modify Reel Spin Logic

**File: `js/slot_classes.js`**

```javascript
// Add method to Reel class
setStopPosition(position) {
    this.nextOrderPosition = position;
}

// Modify spin() to accept position or use random
spin(nextOrderPosition, completeCallBack) {
    // nextOrderPosition is now provided by server
    // If null, use random (for demo mode only)
    if (nextOrderPosition === null || nextOrderPosition === undefined) {
        nextOrderPosition = this.getRandomOrderPosition();
    }
    // ... rest of existing code
}
```

---

### **Phase 5: RTP Control & Profitability**

#### Step 5.1: Calculate Target RTP

**Formula:**
```
RTP = (Total Wins / Total Bets) × 100%
House Edge = 100% - RTP
Expected Profit = Total Bets × House Edge
```

**Example:**
- Target RTP: 94.5%
- House Edge: 5.5%
- If players bet $100,000 total
- Expected wins: $94,500
- Expected profit: $5,500

#### Step 5.2: Implement RTP Tracking

**Server-Side Monitoring:**
```javascript
// Track RTP in real-time
class RTPTracker {
    calculateCurrentRTP(playerId, timeWindow = 24 * 60 * 60 * 1000) {
        // Get all spins in last 24 hours
        const spins = this.getSpinsInWindow(playerId, Date.now() - timeWindow);
        
        const totalBets = spins.reduce((sum, s) => sum + s.total_bet, 0);
        const totalWins = spins.reduce((sum, s) => sum + s.win_amount, 0);
        
        if (totalBets === 0) return 100;
        
        return (totalWins / totalBets) * 100;
    }
    
    getOverallRTP() {
        // Calculate RTP across all players
        // Use for reporting and monitoring
    }
}
```

#### Step 5.3: Adjust Symbol Distribution

**Strategy:**
1. Calculate current RTP from actual game data
2. If RTP too high (>96%): Reduce high-value symbol frequency
3. If RTP too low (<93%): Increase low-value symbol frequency
4. Test changes in staging environment

**Symbol Distribution Adjustment:**
```javascript
// Example: Increase house edge by reducing winning symbols
const adjustedReel = [
    // Original: More winning symbols
    // Adjusted: More losing symbols (low-value or non-winning)
    'Fan', 'A', 'K', 'Q', 'J', 'A', 'K', 'Q', 'J', 'A', // High value
    'Sycee', 'Sycee', 'CoinsHeap', 'CoinsHeap', 'CoinsHeap', // Medium value
    'Teapot', 'Teapot', 'Teapot', 'Teapot', 'Teapot' // Low value, more frequency
];
```

---

### **Phase 6: Security & Anti-Cheat**

#### Step 6.1: Prevent Client Manipulation

**Measures:**
1. **Never trust client for outcomes** - All RNG server-side
2. **Never trust client for balance** - Balance stored server-side
3. **Validate all inputs** - Bet amounts, line counts
4. **Rate limiting** - Prevent rapid-fire spins
5. **Session tokens** - Expire after inactivity

#### Step 6.2: Hash Verification

**Implementation:**
```javascript
// Server generates hash of outcome
function generateOutcomeHash(spinId, reelPositions, winAmount, seed) {
    const crypto = require('crypto');
    const data = `${spinId}-${reelPositions.join(',')}-${winAmount}-${seed}`;
    return crypto.createHash('sha256').update(data).digest('hex');
}

// Client can verify outcome integrity
// Server hash sent with outcome
// Client can recalculate and verify
```

#### Step 6.3: Transaction Logging

**Audit Trail Requirements:**
- Every spin logged with timestamp
- Balance changes logged
- Failed spin attempts logged
- Suspicious activity flagged

---

### **Phase 7: Testing & Validation**

#### Step 7.1: RTP Testing

**Test Plan:**
1. Run 1 million simulated spins
2. Calculate actual RTP
3. Compare to target RTP
4. Adjust if needed
5. Repeat until within acceptable range (±0.5%)

#### Step 7.2: Security Testing

**Test Cases:**
- Attempt to modify client-side code
- Attempt to send invalid bet amounts
- Attempt to replay old spin requests
- Attempt to bypass authentication
- Load testing (concurrent players)

#### Step 7.3: Integration Testing

**Test Flow:**
1. Initialize session
2. Place multiple spins
3. Verify balance updates
4. Verify outcome consistency
5. Verify transaction logs

---

### **Phase 8: Deployment**

#### Step 8.1: Infrastructure

**Requirements:**
- Web server (Node.js/Express, Nginx)
- Database (PostgreSQL/MySQL)
- SSL certificate (HTTPS)
- Load balancer (if scaling)
- Monitoring (log aggregation, metrics)

#### Step 8.2: Monitoring & Alerts

**Key Metrics:**
- Current RTP (real-time)
- Total bets/wins
- Active players
- Server response time
- Error rates

**Alerts:**
- RTP deviates from target (>1%)
- Unusual win patterns
- High error rate
- Server downtime

---

## 📊 Expected Outcomes

### **Profitability Model**

**Scenario: 100 Active Players, $10 average bet per spin, 100 spins/hour**

- **Hourly Revenue:** 100 players × 100 spins × $10 = $100,000
- **Target RTP:** 94.5%
- **Expected Payouts:** $94,500
- **Expected Profit:** $5,500/hour
- **Monthly Profit (24/7):** ~$4 million

*Note: Actual numbers depend on player behavior, marketing, and operational costs.*

---

## 🔧 Quick Start Implementation Order

### **Week 1: Foundation**
1. Set up backend server (Node.js + Express)
2. Create database schema
3. Implement basic API endpoints
4. Set up authentication

### **Week 2: Core Logic**
5. Implement server-side RNG
6. Implement win calculation
7. Integrate with database
8. Basic testing

### **Week 3: Client Integration**
9. Modify client to use server API
10. Update spin flow
11. Update balance management
12. Error handling

### **Week 4: RTP & Security**
13. Implement RTP tracking
14. Adjust symbol distribution
15. Security hardening
16. Load testing

### **Week 5: Testing & Deployment**
17. Comprehensive testing
18. RTP validation
19. Security audit
20. Production deployment

---

## ⚠️ Critical Considerations

### **Legal & Regulatory**
- **Gambling Regulations:** Ensure compliance with local laws
- **Licensing:** May require gambling license
- **Age Verification:** Implement age restrictions
- **Responsible Gaming:** Include self-exclusion, limits

### **Technical**
- **Scalability:** Plan for growth (database indexing, caching)
- **Backup:** Regular database backups
- **Disaster Recovery:** Plan for server failures
- **Data Privacy:** GDPR compliance if serving EU

### **Business**
- **Payment Processing:** Integrate payment gateway
- **Customer Support:** Support system for issues
- **Analytics:** Track player behavior
- **Marketing:** Player acquisition strategy

---

## 📝 Next Steps

1. **Review this plan** with your team
2. **Choose technology stack** (Node.js recommended)
3. **Set up development environment**
4. **Begin Phase 1: Server Architecture**
5. **Create detailed API specification**

---

## 📚 Additional Resources

- **Node.js Express Tutorial:** https://expressjs.com/
- **PostgreSQL Documentation:** https://www.postgresql.org/docs/
- **JWT Authentication:** https://jwt.io/
- **Gaming RNG Best Practices:** Research industry standards

---

**Document Version:** 1.0  
**Last Updated:** 2024  
**Author:** Game Development Expert
