// Example Server Implementation (Node.js + Express)
// This is a basic structure - expand based on your needs

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

// Middleware
app.use(cors());
app.use(bodyParser.json());

// In-memory storage (replace with database)
const sessions = new Map();
const spins = [];
const players = new Map();

// ==================== RNG & Game Logic ====================

class ServerRNG {
    generateSeed() {
        return crypto.randomBytes(32).toString('hex');
    }
    
    getReelPosition(reelIndex, seed, reelLength) {
        const hash = crypto.createHash('sha256')
            .update(`${seed}-${reelIndex}`)
            .digest('hex');
        const hashInt = parseInt(hash.substring(0, 8), 16);
        return hashInt % reelLength;
    }
    
    generateSpinOutcome(seed, reelLengths) {
        const outcome = [];
        for (let i = 0; i < reelLengths.length; i++) {
            outcome.push(this.getReelPosition(i, seed, reelLengths[i]));
        }
        return outcome;
    }
}

class WinCalculator {
    constructor(reels, payLines) {
        this.reels = reels;
        this.payLines = payLines;
    }
    
    calculateWin(reelPositions, lineBet, linesCount) {
        // Get actual symbols at positions
        const symbols = this.getSymbolsAtPositions(reelPositions);
        
        // Check each payline
        let totalWin = 0;
        const winDetails = [];
        
        this.payLines.forEach((payLine, lineIndex) => {
            if (lineIndex >= linesCount) return;
            
            const lineSymbols = this.getLineSymbols(symbols, lineIndex);
            const win = this.checkPayLine(payLine, lineSymbols);
            
            if (win > 0) {
                totalWin += win * lineBet;
                winDetails.push({
                    line: lineIndex,
                    symbols: lineSymbols,
                    payout: win * lineBet
                });
            }
        });
        
        // Check scatter wins
        const scatterWin = this.checkScatterWin(symbols);
        totalWin += scatterWin * lineBet;
        
        return {
            winAmount: totalWin,
            winDetails: winDetails,
            scatterWin: scatterWin
        };
    }
    
    getSymbolsAtPositions(reelPositions) {
        const symbols = [];
        for (let i = 0; i < reelPositions.length; i++) {
            const reel = this.reels[i];
            const pos = reelPositions[i];
            // Get 3 symbols visible in window (assuming 3x5 grid)
            const visibleSymbols = [];
            for (let j = 0; j < 3; j++) {
                const symbolIndex = (pos + j) % reel.symbols.length;
                visibleSymbols.push(reel.symbols[symbolIndex]);
            }
            symbols.push(visibleSymbols);
        }
        return symbols;
    }
    
    getLineSymbols(symbols, lineIndex) {
        // Extract symbols for specific payline (lineIndex 0-2 for 3x5 grid)
        return [
            symbols[0][lineIndex],
            symbols[1][lineIndex],
            symbols[2][lineIndex],
            symbols[3] ? symbols[3][lineIndex] : null,
            symbols[4] ? symbols[4][lineIndex] : null
        ];
    }
    
    checkPayLine(payLine, lineSymbols) {
        // Match line symbols against payline pattern
        // Simplified - implement full logic based on your paytable
        let matchCount = 0;
        for (let i = 0; i < payLine.line.length; i++) {
            if (payLine.line[i] === 'any' || payLine.line[i] === lineSymbols[i]) {
                matchCount++;
            } else {
                break;
            }
        }
        
        // Return payout based on match count
        if (matchCount === payLine.line.length) {
            return payLine.pay;
        }
        return 0;
    }
    
    checkScatterWin(symbols) {
        // Count scatter symbols across all reels
        // Simplified implementation
        return 0;
    }
}

// Game configuration (load from config file)
const gameConfig = {
    reels: [
        { symbols: ['Fan', 'Sycee', 'J', 'Sycee', 'Q', 'CoinsHeap', 'Teapot', 'K', 'A', 'CoinsHeap'] },
        { symbols: ['Sycee', 'CoinsHeap', 'Wild', 'Fan', 'Q', 'Sycee', 'J', 'CoinsHeap', 'K', 'A', 'Teapot', 'CoinsHeap'] },
        { symbols: ['Sycee', 'Wild', 'K', 'Fan', 'Q', 'CoinsHeap', 'Sycee', 'J', 'Wild', 'Scatter', 'A', 'Wild', 'Jackpot', 'Teapot', 'Jackpot'] },
        { symbols: ['Fan', 'Sycee', 'Wild', 'J', 'Q', 'Sycee', 'Wild', 'K', 'A', 'Wild', 'Scatter', 'CoinsHeap', 'Scatter', 'Jackpot', 'Teapot', 'Jackpot'] },
        { symbols: ['CoinsHeap', 'Wild', 'Sycee', 'Fan', 'Sycee', 'J', 'Wild', 'Q', 'A', 'Wild', 'Scatter', 'K', 'Scatter', 'Jackpot', 'Teapot', 'Jackpot'] }
    ],
    payLines: [
        { line: ['CoinsHeap', 'CoinsHeap', 'CoinsHeap', 'CoinsHeap', 'CoinsHeap'], pay: 3 },
        { line: ['A', 'A', 'A', 'A', 'A'], pay: 25 },
        // ... add all paylines
    ]
};

const rng = new ServerRNG();
const winCalculator = new WinCalculator(gameConfig.reels, gameConfig.payLines);

// ==================== Authentication Middleware ====================

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
}

// ==================== API Endpoints ====================

// 1. Initialize Game Session
app.post('/api/game/session/init', (req, res) => {
    const { playerId, initialBalance = 10000 } = req.body;
    
    if (!playerId) {
        return res.status(400).json({ error: 'Player ID required' });
    }
    
    // Create session
    const sessionToken = jwt.sign({ playerId }, JWT_SECRET, { expiresIn: '24h' });
    const session = {
        playerId,
        balance: initialBalance,
        sessionToken,
        createdAt: new Date()
    };
    
    sessions.set(sessionToken, session);
    players.set(playerId, { balance: initialBalance });
    
    res.json({
        sessionToken,
        balance: initialBalance
    });
});

// 2. Place Spin
app.post('/api/game/spin', authenticateToken, (req, res) => {
    const { betAmount, lineBet, linesCount } = req.body;
    const playerId = req.user.playerId;
    const sessionToken = req.headers['authorization'].split(' ')[1];
    
    const session = sessions.get(sessionToken);
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }
    
    // Validate bet
    const totalBet = lineBet * linesCount;
    if (totalBet !== betAmount) {
        return res.status(400).json({ error: 'Invalid bet amount' });
    }
    
    if (session.balance < totalBet) {
        return res.status(400).json({ error: 'Insufficient balance' });
    }
    
    // Deduct bet
    session.balance -= totalBet;
    const balanceBefore = session.balance + totalBet;
    
    // Generate outcome
    const seed = rng.generateSeed();
    const reelLengths = gameConfig.reels.map(r => r.symbols.length);
    const reelPositions = rng.generateSpinOutcome(seed, reelLengths);
    
    // Calculate win
    const winResult = winCalculator.calculateWin(reelPositions, lineBet, linesCount);
    const winAmount = winResult.winAmount;
    
    // Add win to balance
    session.balance += winAmount;
    
    // Generate hash for verification
    const spinId = crypto.randomBytes(16).toString('hex');
    const serverHash = crypto.createHash('sha256')
        .update(`${spinId}-${reelPositions.join(',')}-${winAmount}-${seed}`)
        .digest('hex');
    
    // Log spin
    const spinRecord = {
        spinId,
        playerId,
        sessionToken,
        betAmount: totalBet,
        lineBet,
        linesCount,
        reelPositions,
        winAmount,
        balanceBefore,
        balanceAfter: session.balance,
        seed,
        serverHash,
        timestamp: new Date()
    };
    
    spins.push(spinRecord);
    
    // Update player balance
    const player = players.get(playerId);
    if (player) {
        player.balance = session.balance;
    }
    
    res.json({
        spinId,
        reelPositions,
        winAmount,
        balance: session.balance,
        winDetails: winResult.winDetails,
        serverHash
    });
});

// 3. Get Balance
app.get('/api/game/balance', authenticateToken, (req, res) => {
    const sessionToken = req.headers['authorization'].split(' ')[1];
    const session = sessions.get(sessionToken);
    
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }
    
    res.json({
        balance: session.balance
    });
});

// 4. Get Spin History
app.get('/api/game/history', authenticateToken, (req, res) => {
    const playerId = req.user.playerId;
    const limit = parseInt(req.query.limit) || 50;
    
    const playerSpins = spins
        .filter(s => s.playerId === playerId)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit)
        .map(s => ({
            spinId: s.spinId,
            betAmount: s.betAmount,
            winAmount: s.winAmount,
            timestamp: s.timestamp
        }));
    
    res.json({
        spins: playerSpins
    });
});

// 5. Health Check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});

// ==================== RTP Tracking ====================

app.get('/api/admin/rtp', (req, res) => {
    // Calculate overall RTP
    const totalBets = spins.reduce((sum, s) => sum + s.betAmount, 0);
    const totalWins = spins.reduce((sum, s) => sum + s.winAmount, 0);
    
    const rtp = totalBets > 0 ? (totalWins / totalBets) * 100 : 0;
    
    res.json({
        rtp: rtp.toFixed(2),
        totalBets,
        totalWins,
        totalSpins: spins.length,
        houseEdge: (100 - rtp).toFixed(2)
    });
});

// ==================== Start Server ====================

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
});

// Export for testing
module.exports = app;
