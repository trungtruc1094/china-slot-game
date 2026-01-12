// Client-Side Integration Example
// Add this to your slotGame.js file

class ServerClient {
    constructor(apiBaseUrl, sessionToken) {
        this.apiBaseUrl = apiBaseUrl;
        this.sessionToken = sessionToken;
    }
    
    async initSession(playerId, initialBalance = 10000) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/game/session/init`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    playerId: playerId,
                    initialBalance: initialBalance
                })
            });
            
            if (!response.ok) {
                throw new Error('Session initialization failed');
            }
            
            const data = await response.json();
            this.sessionToken = data.sessionToken;
            return data;
        } catch (error) {
            console.error('Session init error:', error);
            throw error;
        }
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
                    betAmount: betAmount,
                    lineBet: lineBet,
                    linesCount: linesCount
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Spin request failed');
            }
            
            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Spin error:', error);
            throw error;
        }
    }
    
    async getBalance() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/game/balance`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.sessionToken}`
                }
            });
            
            if (!response.ok) {
                throw new Error('Balance request failed');
            }
            
            const data = await response.json();
            return data.balance;
        } catch (error) {
            console.error('Balance error:', error);
            throw error;
        }
    }
}

// ==================== Integration with SlotGame Class ====================

// In your SlotGame class constructor, add:
/*
constructor(){
    super("SlotGame");
    // Add server client
    this.serverClient = null;
    this.useServer = true; // Toggle to enable/disable server mode
    this.apiBaseUrl = 'http://localhost:3000'; // Change to your server URL
}
*/

// In your create() method, initialize server:
/*
create() {
    // ... existing code ...
    
    if (this.useServer) {
        this.serverClient = new ServerClient(this.apiBaseUrl, null);
        // Initialize session (use player ID from your auth system)
        const playerId = this.getPlayerId(); // Implement this method
        this.serverClient.initSession(playerId, this.slotPlayer.defaultCoins)
            .then(result => {
                this.slotPlayer.setCoinsCount(result.balance);
                console.log('Session initialized with server');
            })
            .catch(error => {
                console.error('Failed to initialize session:', error);
                // Fallback to local mode or show error
            });
    }
}
*/

// Modify runSlot() method:
/*
runSlot() {
    // 1. Lock UI
    this.spinButton.setEnabled(false);
    
    // 2. Calculate bet
    const totalBet = this.slotControls.getTotalBet();
    const lineBet = this.slotControls.lineBet;
    const linesCount = this.slotControls.selectedLinesCount;
    
    // 3. Validate bet locally first (optional, for UX)
    if (!this.slotPlayer.hasMoneyForBet(totalBet)) {
        this.spinButton.setEnabled(true);
        return;
    }
    
    // 4. If using server, request spin from server
    if (this.useServer && this.serverClient) {
        this.serverClient.placeSpin(totalBet, lineBet, linesCount)
            .then(serverResult => {
                // 5. Use server-provided outcome
                this.useServerOutcome(serverResult);
                
                // 6. Update balance from server
                this.slotPlayer.setCoinsCount(serverResult.balance);
                
                // 7. Process win/loss display
                this.processSpinResult(serverResult);
                
                // 8. Unlock UI
                this.spinButton.setEnabled(true);
            })
            .catch(error => {
                // Handle error
                console.error('Spin error:', error);
                this.handleSpinError(error);
                this.spinButton.setEnabled(true);
                
                // Optionally refund bet if it was deducted locally
            });
    } else {
        // Fallback to original client-side logic
        this.runLocalSpin();
    }
}
*/

// New method: Use server outcome
/*
useServerOutcome(serverResult) {
    // Store reel positions from server
    this.serverReelPositions = serverResult.reelPositions;
    
    // Override random generation in spinReels function
    // The reels will use these positions instead of generating random ones
}
*/

// Modify spinReels function in slotGame.js:
/*
function spinReels(reels, _slotConfig, completeCallback, serverPositions = null) {
    var pA = new ParallelActions();
    var ri = 0;
    reels.forEach((r) => {
        pA.add((callBack) => {
            // Use server position if provided, otherwise use random
            var rand;
            if (serverPositions && serverPositions[ri] !== undefined) {
                rand = serverPositions[ri];
            } else {
                rand = (_slotConfig.reels_simulate && _slotConfig.reels_simulate[ri] >= 0) 
                    ? _slotConfig.reels_simulate[ri] 
                    : r.getRandomOrderPosition();
            }
            r.spin(rand, () => { callBack(); }); 
            ri++;
        });         
    });
    pA.start(completeCallback);
}
*/

// Update the call to spinReels in runSlot:
/*
if (this.useServer && serverResult) {
    // Use server positions
    spinReels(this.reels, slotConfig, callback, serverResult.reelPositions);
} else {
    // Use random positions
    spinReels(this.reels, slotConfig, callback);
}
*/

// Handle win calculation - you may need to override winController
/*
processSpinResult(serverResult) {
    // The server has already calculated the win
    // You may need to set the win in winController based on server result
    
    // After reels stop, manually set win results if needed
    // Or let winController recalculate based on server positions
    // (recalculation should match server calculation)
}
*/

// Error handling
/*
handleSpinError(error) {
    // Show user-friendly error message
    console.error('Spin failed:', error.message);
    
    // Optionally show popup to user
    if (this.guiController) {
        this.guiController.showMessage('Spin failed. Please try again.', 3000);
    }
    
    // If bet was deducted, refund it
    // This shouldn't happen if server validation works correctly
}
*/
