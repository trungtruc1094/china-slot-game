-- Database Schema for Slot Game Server
-- PostgreSQL Example (adapt for MySQL/MongoDB as needed)

-- Players Table
CREATE TABLE IF NOT EXISTS players (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE,
    balance DECIMAL(10, 2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Game Sessions Table
CREATE TABLE IF NOT EXISTS game_sessions (
    id SERIAL PRIMARY KEY,
    player_id INTEGER REFERENCES players(id),
    session_token VARCHAR(255) UNIQUE NOT NULL,
    start_balance DECIMAL(10, 2) NOT NULL,
    current_balance DECIMAL(10, 2) NOT NULL,
    status VARCHAR(50) DEFAULT 'active', -- active, completed, expired
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP,
    expires_at TIMESTAMP,
    INDEX idx_player_id (player_id),
    INDEX idx_session_token (session_token),
    INDEX idx_status (status)
);

-- Spins Table (Main Transaction Log)
CREATE TABLE IF NOT EXISTS spins (
    id SERIAL PRIMARY KEY,
    spin_id VARCHAR(255) UNIQUE NOT NULL,
    session_id INTEGER REFERENCES game_sessions(id),
    player_id INTEGER REFERENCES players(id),
    spin_number INTEGER NOT NULL,
    bet_amount DECIMAL(10, 2) NOT NULL,
    line_bet DECIMAL(10, 2) NOT NULL,
    lines_count INTEGER NOT NULL,
    total_bet DECIMAL(10, 2) NOT NULL,
    reel_positions TEXT NOT NULL, -- JSON array: [0, 5, 12, 8, 3]
    win_amount DECIMAL(10, 2) DEFAULT 0.00,
    win_type VARCHAR(50), -- line_win, scatter_win, jackpot, none
    win_details TEXT, -- JSON object with win details
    rtp_seed VARCHAR(255) NOT NULL, -- Server-generated seed
    server_hash VARCHAR(255) NOT NULL, -- Hash for verification
    client_hash VARCHAR(255), -- Optional: client verification hash
    balance_before DECIMAL(10, 2) NOT NULL,
    balance_after DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_player_id (player_id),
    INDEX idx_session_id (session_id),
    INDEX idx_created_at (created_at),
    INDEX idx_spin_id (spin_id)
);

-- Balance Transactions Table (Audit Trail)
CREATE TABLE IF NOT EXISTS balance_transactions (
    id SERIAL PRIMARY KEY,
    player_id INTEGER REFERENCES players(id),
    transaction_type VARCHAR(50) NOT NULL, -- bet, win, deposit, withdrawal, refund
    amount DECIMAL(10, 2) NOT NULL,
    balance_before DECIMAL(10, 2) NOT NULL,
    balance_after DECIMAL(10, 2) NOT NULL,
    reference_id INTEGER, -- spin_id or deposit_id
    reference_type VARCHAR(50), -- spin, deposit, withdrawal
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_player_id (player_id),
    INDEX idx_transaction_type (transaction_type),
    INDEX idx_created_at (created_at)
);

-- Game Configuration Table
CREATE TABLE IF NOT EXISTS game_config (
    id SERIAL PRIMARY KEY,
    config_key VARCHAR(255) UNIQUE NOT NULL,
    config_value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(255)
);

-- RTP Tracking Table (for monitoring)
CREATE TABLE IF NOT EXISTS rtp_tracking (
    id SERIAL PRIMARY KEY,
    player_id INTEGER REFERENCES players(id), -- NULL for overall RTP
    period_start TIMESTAMP NOT NULL,
    period_end TIMESTAMP NOT NULL,
    total_bets DECIMAL(12, 2) NOT NULL,
    total_wins DECIMAL(12, 2) NOT NULL,
    total_spins INTEGER NOT NULL,
    rtp_percentage DECIMAL(5, 2) NOT NULL,
    house_edge DECIMAL(5, 2) NOT NULL,
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_player_id (player_id),
    INDEX idx_period_start (period_start)
);

-- Insert Default Game Configuration
INSERT INTO game_config (config_key, config_value, description) VALUES
    ('target_rtp', '94.5', 'Target Return to Player percentage'),
    ('min_bet', '1.00', 'Minimum bet amount'),
    ('max_bet', '100.00', 'Maximum bet amount'),
    ('max_lines', '25', 'Maximum number of paylines'),
    ('session_timeout', '3600', 'Session timeout in seconds (1 hour)'),
    ('jackpot_increment', '1.00', 'Jackpot increment per spin')
ON CONFLICT (config_key) DO NOTHING;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for players table
CREATE TRIGGER update_players_updated_at BEFORE UPDATE ON players
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger for game_config table
CREATE TRIGGER update_game_config_updated_at BEFORE UPDATE ON game_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- View for RTP Calculation
CREATE OR REPLACE VIEW v_current_rtp AS
SELECT 
    COUNT(*) as total_spins,
    COALESCE(SUM(total_bet), 0) as total_bets,
    COALESCE(SUM(win_amount), 0) as total_wins,
    CASE 
        WHEN SUM(total_bet) > 0 
        THEN (SUM(win_amount) / SUM(total_bet)) * 100
        ELSE 0
    END as rtp_percentage,
    CASE 
        WHEN SUM(total_bet) > 0 
        THEN 100 - ((SUM(win_amount) / SUM(total_bet)) * 100)
        ELSE 0
    END as house_edge
FROM spins
WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours';

-- View for Player Statistics
CREATE OR REPLACE VIEW v_player_stats AS
SELECT 
    p.id,
    p.username,
    p.balance,
    COUNT(s.id) as total_spins,
    COALESCE(SUM(s.total_bet), 0) as total_bets,
    COALESCE(SUM(s.win_amount), 0) as total_wins,
    CASE 
        WHEN SUM(s.total_bet) > 0 
        THEN (SUM(s.win_amount) / SUM(s.total_bet)) * 100
        ELSE 0
    END as player_rtp
FROM players p
LEFT JOIN spins s ON p.id = s.player_id
GROUP BY p.id, p.username, p.balance;
