import { randomUUID } from "node:crypto";
import {
  buildVisibleWindow,
  calculateWins,
  type GameConfiguration,
  type ReelStop,
  type WagerInput
} from "@china-slot-game/game-math";
import type { Pool, PoolClient } from "pg";
import { withTransaction } from "../../db/transactions.js";
import { getRewardModelMetadata } from "../../domain/reward-boundary.js";
import { SessionService, type Clock } from "../../domain/session-service.js";
import { SpinService, type SpinLedgerEntry, type SpinResponse, type SpinServiceOptions } from "../../domain/spin-service.js";
import { WalletService, type WalletTransactionRecord, type WalletTransactionRequest } from "../../domain/wallet-service.js";
import { InMemoryPlayerIdentityAdapter } from "../../domain/player-identity.js";
import type { BudgetProtectionActionRecord } from "../../domain/budget-protection-repository.js";
import type { OperatorLimitRecord } from "../../domain/operator-limits-repository.js";
import { ApiHttpError } from "../../middleware/error-handler.js";

interface SessionRow {
  id: string;
  player_id: string;
  status: "active" | "expired";
  expires_at: Date;
}

interface IdempotencyRow {
  session_id: string;
  client_spin_id: string;
  wager_fingerprint: string;
  status: "pending" | "completed";
  response_json: SpinResponse | null;
}

interface ConfigRow {
  config_json: GameConfiguration;
}

interface WalletRow {
  balance: string;
}

interface SpinRow {
  id: string;
  session_id: string;
  player_id: string;
  client_spin_id: string;
  config_version_id: string;
  wager_json: WagerInput;
  reel_stops_json: SpinResponse["reelStops"];
  visible_window_json: SpinResponse["visibleWindow"];
  win_breakdown_json: SpinResponse["winBreakdown"];
  payout: string;
  balance_after: string;
  free_spins_awarded: number;
  free_spins_remaining: number;
  jackpot_award: string;
  response_json: SpinResponse;
  accepted_at: Date;
}

interface SpinWalletTransactionRow {
  spin_id: string;
  wallet_transaction_id: string;
  player_id: string;
  transaction_type: WalletTransactionRecord["type"];
  amount: string;
  balance_before: string;
  balance_after: string;
  actor: string;
  source: string;
  correlation_id: string | null;
  metadata_json: Record<string, unknown>;
  created_at: Date;
}

export interface PostgresSpinServiceOptions extends SpinServiceOptions {
  failWalletCommit?: (request: WalletTransactionRequest) => boolean;
}

const starterBalance = 1000;

export class PostgresSpinService extends SpinService {
  private readonly ledgerCache: SpinLedgerEntry[] = [];

  public constructor(
    private readonly pool: Pool,
    private readonly postgresOptions: PostgresSpinServiceOptions = {},
    private readonly postgresClock: Clock = { now: () => new Date() }
  ) {
    super(new SessionService(new InMemoryPlayerIdentityAdapter(), postgresClock), new WalletService(postgresClock), postgresOptions, postgresClock);
  }

  public override getLedger(): SpinLedgerEntry[] {
    return [...this.ledgerCache];
  }

  public override async spin(request: { clientSpinId: string; sessionId: string; wager: WagerInput; correlationId?: string }): Promise<SpinResponse> {
    const result = await withTransaction(this.pool, async (client) => {
      const now = this.postgresClock.now();
      const fingerprint = fingerprintWager(request.wager);
      let idempotency = await this.lockIdempotency(client, request.sessionId, request.clientSpinId);

      if (idempotency?.status === "completed") {
        if (idempotency.wager_fingerprint !== fingerprint) {
          throw idempotencyConflict(request);
        }
        if (!idempotency.response_json) {
          throw new Error("Completed spin idempotency record is missing response payload.");
        }
        return { response: idempotency.response_json, ledgerEntry: null };
      }
      if (idempotency && idempotency.wager_fingerprint !== fingerprint) {
        throw idempotencyConflict(request);
      }

      const session = await this.getActiveSession(client, request.sessionId, now);
      if (!idempotency) {
        await this.reserveIdempotency(client, request, fingerprint, now);
        idempotency = await this.lockIdempotency(client, request.sessionId, request.clientSpinId);
        if (!idempotency) {
          throw new Error("Expected spin idempotency row.");
        }
        if (idempotency.status === "completed") {
          if (idempotency.wager_fingerprint !== fingerprint) {
            throw idempotencyConflict(request);
          }
          if (!idempotency.response_json) {
            throw new Error("Completed spin idempotency record is missing response payload.");
          }
          return { response: idempotency.response_json, ledgerEntry: null };
        }
        if (idempotency.wager_fingerprint !== fingerprint) {
          throw idempotencyConflict(request);
        }
      }
      const config = await this.getActiveConfig(client);
      validateSpinWager(config, request.wager);
      this.validatePostgresBudgetProtection(request.wager);
      const activeLimits = this.postgresOptions.operatorLimitsProvider?.getActiveLimits(this.postgresOptions.operatorLimitsScopeId ?? "default");
      if (activeLimits) {
        this.validatePostgresOperatorLimits(activeLimits, session.player_id, request.sessionId, request.wager);
      }

      const reelStops = this.samplePostgresReelStops(config);
      const visibleWindow = buildVisibleWindow(config, reelStops);
      const winBreakdown = calculateWins(config, visibleWindow);
      const payout = config.payoutPolicy.useLineBetMultiplier
        ? winBreakdown.totalPay * request.wager.lineBet
        : winBreakdown.totalPay;
      const jackpotAward = winBreakdown.jackpotWins.reduce((total, win) => total + win.pay, 0);
      const spinId = `spin_${randomUUID()}`;
      const walletRequests: WalletTransactionRequest[] = [{
        playerId: session.player_id,
        type: "debit",
        amount: request.wager.totalWager,
        actor: "spin-service",
        source: request.sessionId,
        correlationId: request.correlationId ?? null,
        metadata: { clientSpinId: request.clientSpinId, correlationId: request.correlationId ?? null, spinId }
      }];
      if (payout > 0) {
        walletRequests.push({
          playerId: session.player_id,
          type: "credit",
          amount: payout,
          actor: "spin-service",
          source: request.sessionId,
          correlationId: request.correlationId ?? null,
          metadata: { clientSpinId: request.clientSpinId, correlationId: request.correlationId ?? null, spinId }
        });
      }

      const walletResult = await this.applyWalletTransactions(client, session.player_id, walletRequests, now);
      const response: SpinResponse = {
        spinId,
        configVersionId: config.versionId,
        reelStops,
        visibleWindow,
        wager: request.wager,
        winBreakdown,
        payout,
        balanceAfter: walletResult.wallet.balance,
        rewardModel: getRewardModelMetadata(),
        freeSpinState: { awarded: winBreakdown.totalFreeSpins, remaining: winBreakdown.totalFreeSpins },
        jackpotState: { awarded: jackpotAward }
      };

      if (this.postgresOptions.failLedgerCommit?.(response) === true) {
        throw new Error("Injected spin ledger failure");
      }

      await client.query(
        `INSERT INTO spins (
           id, session_id, player_id, client_spin_id, config_version_id, wager_json, reel_stops_json,
           visible_window_json, win_breakdown_json, payout, balance_after, free_spins_awarded,
           free_spins_remaining, jackpot_award, response_json, request_id, correlation_id, accepted_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16, $17)`,
        [
          spinId,
          request.sessionId,
          session.player_id,
          request.clientSpinId,
          config.versionId,
          jsonParam(request.wager),
          jsonParam(reelStops),
          jsonParam(visibleWindow),
          jsonParam(winBreakdown),
          payout,
          response.balanceAfter,
          response.freeSpinState.awarded,
          response.freeSpinState.remaining,
          response.jackpotState.awarded,
          jsonParam(response),
          request.correlationId ?? null,
          now
        ]
      );
      for (const transaction of walletResult.transactions) {
        await client.query(
          `INSERT INTO spin_wallet_transactions (spin_id, wallet_transaction_id, transaction_type)
           VALUES ($1, $2, $3)`,
          [spinId, transaction.transactionId, transaction.type]
        );
      }
      await client.query(
        `UPDATE spin_idempotency_keys
         SET player_id = $3, status = 'completed', response_json = $4, updated_at = $5, completed_at = $5
         WHERE session_id = $1 AND client_spin_id = $2`,
        [request.sessionId, request.clientSpinId, session.player_id, jsonParam(response), now]
      );
      return {
        response,
        ledgerEntry: {
          ...response,
          sessionId: request.sessionId,
          playerId: session.player_id,
          walletTransactions: walletResult.transactions,
          acceptedAt: now
        }
      };
    });
    if (result.ledgerEntry) {
      this.ledgerCache.push(result.ledgerEntry);
    }
    return result.response;
  }

  public async loadLedger(): Promise<SpinLedgerEntry[]> {
    const spinResult = await this.pool.query<SpinRow>(
      `SELECT id, session_id, player_id, client_spin_id, config_version_id, wager_json, reel_stops_json,
              visible_window_json, win_breakdown_json, payout, balance_after, free_spins_awarded,
              free_spins_remaining, jackpot_award, response_json, accepted_at
       FROM spins
       ORDER BY accepted_at, id`
    );
    const entries: SpinLedgerEntry[] = [];
    for (const spin of spinResult.rows) {
      const transactionResult = await this.pool.query<SpinWalletTransactionRow>(
        `SELECT swt.spin_id, swt.wallet_transaction_id, wt.player_id, swt.transaction_type, wt.amount, wt.balance_before, wt.balance_after,
                wt.actor, wt.source, wt.correlation_id, wt.metadata_json, wt.created_at
         FROM spin_wallet_transactions swt
         JOIN wallet_transactions wt ON wt.id = swt.wallet_transaction_id
         WHERE swt.spin_id = $1
         ORDER BY wt.sequence_number`,
        [spin.id]
      );
      entries.push({
        ...spin.response_json,
        sessionId: spin.session_id,
        playerId: spin.player_id,
        walletTransactions: transactionResult.rows.map(rowToWalletTransaction),
        acceptedAt: spin.accepted_at
      });
    }
    this.ledgerCache.length = 0;
    this.ledgerCache.push(...entries);
    return this.getLedger();
  }

  private async reserveIdempotency(
    client: PoolClient,
    request: { clientSpinId: string; sessionId: string; correlationId?: string },
    fingerprint: string,
    now: Date
  ): Promise<void> {
    await client.query(
      `INSERT INTO spin_idempotency_keys (session_id, client_spin_id, wager_fingerprint, status, request_id, correlation_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'pending', $4, $4, $5, $5)
       ON CONFLICT (session_id, client_spin_id) DO NOTHING`,
      [request.sessionId, request.clientSpinId, fingerprint, request.correlationId ?? null, now]
    );
  }

  private async lockIdempotency(client: PoolClient, sessionId: string, clientSpinId: string): Promise<IdempotencyRow | null> {
    const result = await client.query<IdempotencyRow>(
      `SELECT session_id, client_spin_id, wager_fingerprint, status, response_json
       FROM spin_idempotency_keys
       WHERE session_id = $1 AND client_spin_id = $2
       FOR UPDATE`,
      [sessionId, clientSpinId]
    );
    const row = result.rows[0];
    return row ?? null;
  }

  private async getActiveSession(client: PoolClient, sessionId: string, now: Date): Promise<SessionRow> {
    await client.query(
      `UPDATE sessions SET status = 'expired' WHERE id = $1 AND status = 'active' AND expires_at <= $2`,
      [sessionId, now]
    );
    const result = await client.query<SessionRow>(
      `SELECT id, player_id, status, expires_at FROM sessions WHERE id = $1`,
      [sessionId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiHttpError(401, {
        code: "SESSION_INVALID",
        message: "Session is not active.",
        details: { sessionId }
      });
    }
    if (row.status === "expired") {
      throw new ApiHttpError(401, {
        code: "SESSION_EXPIRED",
        message: "Session has expired.",
        details: { sessionId }
      });
    }
    return row;
  }

  private async getActiveConfig(client: PoolClient): Promise<GameConfiguration> {
    if (this.postgresOptions.activeConfig) {
      return cloneJson(this.postgresOptions.activeConfig);
    }
    const result = await client.query<ConfigRow>(
      `SELECT config_json FROM game_config_versions WHERE status = 'active'`
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiHttpError(503, {
        code: "ACTIVE_CONFIG_MISSING",
        message: "No active game configuration is available.",
        details: {}
      });
    }
    return cloneJson(row.config_json);
  }

  private async applyWalletTransactions(
    client: PoolClient,
    playerId: string,
    requests: WalletTransactionRequest[],
    now: Date
  ): Promise<{ wallet: { playerId: string; balance: number }; transactions: WalletTransactionRecord[] }> {
    await client.query(
      `INSERT INTO wallets (player_id, balance, created_at, updated_at)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT (player_id) DO NOTHING`,
      [playerId, starterBalance, now]
    );
    const walletResult = await client.query<WalletRow>(
      `SELECT balance FROM wallets WHERE player_id = $1 FOR UPDATE`,
      [playerId]
    );
    let balance = parseSafeInteger(walletResult.rows[0]?.balance ?? String(starterBalance));
    const transactions: WalletTransactionRecord[] = [];
    for (const request of requests) {
      validateWalletRequest(request);
      const balanceBefore = balance;
      const balanceAfter = calculateBalanceAfter(balance, request);
      await client.query(`UPDATE wallets SET balance = $2, updated_at = $3 WHERE player_id = $1`, [playerId, balanceAfter, now]);
      balance = balanceAfter;
      if (this.postgresOptions.failWalletCommit?.(request) === true) {
        throw new ApiHttpError(500, {
          code: "WALLET_TRANSACTION_FAILED",
          message: "Wallet transaction could not be committed.",
          details: {}
        });
      }
      const transaction: WalletTransactionRecord = {
        transactionId: `txn_${randomUUID()}`,
        playerId,
        type: request.type,
        amount: request.amount,
        balanceBefore,
        balanceAfter,
        actor: request.actor,
        source: request.source,
        correlationId: request.correlationId ?? null,
        createdAt: now.toISOString(),
        metadata: cloneJson(request.metadata ?? {})
      };
      await client.query(
        `INSERT INTO wallet_transactions (id, player_id, transaction_type, amount, balance_before, balance_after, actor, source, correlation_id, spin_id, metadata_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          transaction.transactionId,
          playerId,
          transaction.type,
          transaction.amount,
          transaction.balanceBefore,
          transaction.balanceAfter,
          transaction.actor,
          transaction.source,
          transaction.correlationId,
          metadataSpinId(transaction.metadata),
          jsonParam(transaction.metadata),
          now
        ]
      );
      transactions.push(transaction);
    }
    return { wallet: { playerId, balance }, transactions };
  }

  private samplePostgresReelStops(config: GameConfiguration): ReelStop[] {
    const nextRandom = this.postgresOptions.nextRandom ?? Math.random;
    return config.reels.map((reel) => ({
      reelIndex: reel.reelIndex,
      stopIndex: Math.floor(nextRandom() * reel.symbols.length) % reel.symbols.length
    }));
  }

  private validatePostgresOperatorLimits(
    activeLimits: OperatorLimitRecord,
    playerId: string,
    sessionId: string,
    wager: WagerInput
  ): void {
    const limits = activeLimits.limits;
    if (wager.lineBet < limits.perSpin.minBet) {
      throw limitExceeded(activeLimits.scopeId, "perSpin.minBet", wager.lineBet, wager.lineBet, limits.perSpin.minBet);
    }
    if (wager.lineBet > limits.perSpin.maxBet) {
      throw limitExceeded(activeLimits.scopeId, "perSpin.maxBet", wager.lineBet, wager.lineBet, limits.perSpin.maxBet);
    }
    if (limits.perSpin.maxPayout > limits.campaign.budget) {
      throw limitExceeded(activeLimits.scopeId, "campaign.budget", this.totalPostgresPaid(), limits.perSpin.maxPayout, limits.campaign.budget);
    }

    const sessionLedger = this.ledgerCache.filter((entry) => entry.sessionId === sessionId);
    if (sessionLedger.length + 1 > limits.perSession.maxSpins) {
      throw limitExceeded(activeLimits.scopeId, "perSession.maxSpins", sessionLedger.length, 1, limits.perSession.maxSpins);
    }
    const sessionWagered = sessionLedger.reduce((total, entry) => total + entry.wager.totalWager, 0);
    if (sessionWagered + wager.totalWager > limits.perSession.maxWager) {
      throw limitExceeded(activeLimits.scopeId, "perSession.maxWager", sessionWagered, wager.totalWager, limits.perSession.maxWager);
    }

    const playerLedger = this.ledgerCache.filter((entry) => entry.playerId === playerId);
    const playerWagered = playerLedger.reduce((total, entry) => total + entry.wager.totalWager, 0);
    if (playerWagered + wager.totalWager > limits.perDay.playerMaxWager) {
      throw limitExceeded(activeLimits.scopeId, "perDay.playerMaxWager", playerWagered, wager.totalWager, limits.perDay.playerMaxWager);
    }
    const playerPaid = playerLedger.reduce((total, entry) => total + entry.payout, 0);
    if (playerPaid + limits.perSpin.maxPayout > limits.perDay.playerMaxReward) {
      throw limitExceeded(activeLimits.scopeId, "perDay.playerMaxReward", playerPaid, limits.perSpin.maxPayout, limits.perDay.playerMaxReward);
    }

    const campaignPaid = this.totalPostgresPaid();
    if (campaignPaid + limits.perSpin.maxPayout > limits.campaign.budget) {
      throw limitExceeded(activeLimits.scopeId, "campaign.budget", campaignPaid, limits.perSpin.maxPayout, limits.campaign.budget);
    }
    const jackpotAwarded = this.ledgerCache.reduce((total, entry) => total + entry.jackpotState.awarded, 0);
    if (jackpotAwarded + limits.perSpin.maxPayout > limits.campaign.jackpotCap) {
      throw limitExceeded(activeLimits.scopeId, "campaign.jackpotCap", jackpotAwarded, limits.perSpin.maxPayout, limits.campaign.jackpotCap);
    }
  }

  private validatePostgresBudgetProtection(wager: WagerInput): void {
    if (this.postgresOptions.budgetProtectionEnabled === false) {
      return;
    }
    const scopeId = this.postgresOptions.operatorLimitsScopeId ?? "default";
    const activeActions = this.postgresOptions.budgetProtectionProvider?.listActiveActions(scopeId) ?? [];
    for (const action of activeActions) {
      if (action.action === "pauseCampaign") {
        throw budgetProtectionActive(action, "Campaign is paused.");
      }
      if (action.action === "requireHostApproval") {
        throw budgetProtectionActive(action, "Host approval is required before play can continue.");
      }
      if (action.action === "disablePaidSpins" && wager.totalWager > 0) {
        throw budgetProtectionActive(action, "Paid spins are disabled.");
      }
      if (action.action === "lowerMaxBet") {
        const maxBet = action.parameters.maxBet;
        if (typeof maxBet === "number" && Number.isSafeInteger(maxBet) && wager.lineBet > maxBet) {
          throw budgetProtectionActive(action, `Maximum bet is temporarily limited to ${maxBet}.`);
        }
      }
    }
  }

  private totalPostgresPaid(): number {
    return this.ledgerCache.reduce((total, entry) => total + entry.payout, 0);
  }
}

function validateSpinWager(config: GameConfiguration, wager: WagerInput): void {
    if (wager.selectedWays !== config.waysPolicy.totalWays || wager.totalWager !== wager.lineBet * wager.selectedWays) {
      throw new ApiHttpError(400, { code: "INVALID_WAGER", message: "Spin wager is invalid.", details: { wager } });
    }
    if (wager.lineBet < config.limits.minBet || wager.lineBet > config.limits.maxBet) {
      throw new ApiHttpError(400, { code: "INVALID_WAGER", message: "Spin wager is outside configured limits.", details: { wager, limits: config.limits } });
    }
}

function rowToWalletTransaction(row: SpinWalletTransactionRow): WalletTransactionRecord {
  return {
    transactionId: row.wallet_transaction_id,
    playerId: row.player_id,
    type: row.transaction_type,
    amount: parseSafeInteger(row.amount),
    balanceBefore: parseSafeInteger(row.balance_before),
    balanceAfter: parseSafeInteger(row.balance_after),
    actor: row.actor,
    source: row.source,
    correlationId: row.correlation_id,
    createdAt: row.created_at.toISOString(),
    metadata: cloneJson(row.metadata_json)
  };
}

function fingerprintWager(wager: WagerInput): string {
  return JSON.stringify({ lineBet: wager.lineBet, selectedWays: wager.selectedWays, totalWager: wager.totalWager });
}

function idempotencyConflict(request: { clientSpinId: string; sessionId: string }): ApiHttpError {
  return new ApiHttpError(409, {
    code: "IDEMPOTENCY_CONFLICT",
    message: "clientSpinId has already been used with different wager data.",
    details: { clientSpinId: request.clientSpinId, sessionId: request.sessionId }
  });
}

function limitExceeded(
  scopeId: string,
  limit: string,
  current: number,
  attempted: number,
  maximum: number
): ApiHttpError {
  return new ApiHttpError(409, {
    code: "OPERATOR_LIMIT_EXCEEDED",
    message: "Spin violates active operator limits.",
    details: { scopeId, limit, current, attempted, maximum }
  });
}

function budgetProtectionActive(action: BudgetProtectionActionRecord, message: string): ApiHttpError {
  return new ApiHttpError(409, {
    code: "BUDGET_PROTECTION_ACTIVE",
    message,
    details: {
      scopeId: action.scopeId,
      action: action.action,
      message
    }
  });
}

function validateWalletRequest(request: WalletTransactionRequest): void {
  if (!Number.isSafeInteger(request.amount) || request.amount <= 0) {
    throw new ApiHttpError(400, {
      code: "INVALID_TRANSACTION_AMOUNT",
      message: "Wallet transaction amount must be a positive integer.",
      details: { amount: request.amount }
    });
  }
}

function calculateBalanceAfter(balance: number, request: WalletTransactionRequest): number {
  const balanceAfter = request.type === "debit" ? balance - request.amount : balance + request.amount;
  if (!Number.isSafeInteger(balanceAfter)) {
    throw new ApiHttpError(400, {
      code: "INVALID_BALANCE_RESULT",
      message: "Wallet transaction would produce an unsafe integer balance.",
      details: { playerId: request.playerId, balance, amount: request.amount }
    });
  }
  if (balanceAfter < 0) {
    throw new ApiHttpError(409, {
      code: "INSUFFICIENT_BALANCE",
      message: "Insufficient balance for this transaction.",
      details: { playerId: request.playerId, balance, amount: request.amount }
    });
  }
  return balanceAfter;
}

function parseSafeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("Unsafe integer value read from PostgreSQL.");
  }
  return parsed;
}

function metadataSpinId(metadata: Record<string, unknown>): string | null {
  return typeof metadata.spinId === "string" ? metadata.spinId : null;
}

function cloneJson<T>(value: T): T {
  return structuredClone(value) as T;
}

function jsonParam(value: unknown): string {
  return JSON.stringify(value);
}