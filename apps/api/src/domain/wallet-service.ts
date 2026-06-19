import { ApiHttpError } from "../middleware/error-handler.js";
import type { Clock } from "./session-service.js";

export type WalletTransactionType = "debit" | "credit" | "free_spin_award" | "jackpot_award" | "adjustment";

export interface WalletTransactionRequest {
  playerId: string;
  type: WalletTransactionType;
  amount: number;
  actor: string;
  source: string;
  metadata?: Record<string, unknown>;
}

export interface Wallet {
  playerId: string;
  balance: number;
}

export interface WalletTransactionRecord {
  transactionId: string;
  playerId: string;
  type: WalletTransactionType;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  actor: string;
  source: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface WalletTransactionResult {
  wallet: Wallet;
  transaction: WalletTransactionRecord;
}

export interface WalletTransactionBatchResult {
  wallet: Wallet;
  transactions: WalletTransactionRecord[];
}

export interface WalletTransactionBatchCommitOptions {
  afterBalanceCommit?: (result: WalletTransactionBatchResult) => void;
}

export interface WalletServiceTestHooks {
  failAfterBalanceUpdate?: (request: WalletTransactionRequest) => boolean;
}

const starterBalance = 1000;

export class WalletService {
  private readonly walletsByPlayerId = new Map<string, Wallet>();
  private readonly transactionsByPlayerId = new Map<string, WalletTransactionRecord[]>();
  private readonly queuesByPlayerId = new Map<string, Promise<void>>();
  private nextTransactionNumber = 1;

  public constructor(
    private readonly clock: Clock,
    private readonly testHooks: WalletServiceTestHooks = {}
  ) {}

  public getWallet(playerId: string): Wallet {
    return { ...this.getOrCreateWallet(playerId) };
  }

  public getTransactions(playerId: string): WalletTransactionRecord[] {
    return [...(this.transactionsByPlayerId.get(playerId) ?? [])];
  }

  public listTransactions(): WalletTransactionRecord[] {
    return [...this.transactionsByPlayerId.values()].flatMap((transactions) => [...transactions]);
  }

  public applyTransaction(request: WalletTransactionRequest): Promise<WalletTransactionResult> {
    return this.applyTransactionBatch([request]).then((result) => {
      const transaction = result.transactions[0];

      if (!transaction) {
        throw new ApiHttpError(500, {
          code: "WALLET_TRANSACTION_FAILED",
          message: "Wallet transaction could not be committed.",
          details: {}
        });
      }

      return { wallet: result.wallet, transaction };
    });
  }

  public applyTransactionBatch(
    requests: WalletTransactionRequest[],
    commitOptions: WalletTransactionBatchCommitOptions = {}
  ): Promise<WalletTransactionBatchResult> {
    const firstRequest = requests[0];

    if (!firstRequest || requests.some((request) => request.playerId !== firstRequest.playerId)) {
      return Promise.reject(new ApiHttpError(400, {
        code: "INVALID_WALLET_BATCH",
        message: "Wallet transaction batch must target one player.",
        details: {}
      }));
    }

    return this.enqueue(firstRequest.playerId, () => Promise.resolve(this.applyTransactionBatchInLock(requests, commitOptions)));
  }

  private applyTransactionBatchInLock(
    requests: WalletTransactionRequest[],
    commitOptions: WalletTransactionBatchCommitOptions
  ): WalletTransactionBatchResult {
    const firstRequest = requests[0];

    if (!firstRequest) {
      throw new ApiHttpError(400, {
        code: "INVALID_WALLET_BATCH",
        message: "Wallet transaction batch must target one player.",
        details: {}
      });
    }

    for (const request of requests) {
      this.validateRequest(request);
    }

    const wallet = this.getOrCreateWallet(firstRequest.playerId);
    const transactions = this.getOrCreateTransactions(firstRequest.playerId);
    const initialBalance = wallet.balance;
    const transactionCountBefore = transactions.length;
    const nextTransactionNumberBefore = this.nextTransactionNumber;
    const batchTransactions: WalletTransactionRecord[] = [];

    try {
      for (const request of requests) {
        const balanceBefore = wallet.balance;
        const balanceAfter = this.calculateBalanceAfter(wallet.balance, request);
        wallet.balance = balanceAfter;

        if (this.testHooks.failAfterBalanceUpdate?.(request) === true) {
          throw new Error("Injected wallet transaction failure");
        }

        const transaction: WalletTransactionRecord = {
          transactionId: `txn_${this.nextTransactionNumber++}`,
          playerId: request.playerId,
          type: request.type,
          amount: request.amount,
          balanceBefore,
          balanceAfter,
          actor: request.actor,
          source: request.source,
          createdAt: this.clock.now().toISOString(),
          metadata: request.metadata ?? {}
        };
        transactions.push(transaction);
        batchTransactions.push(transaction);
      }

      const result = {
        wallet: { ...wallet },
        transactions: batchTransactions
      };
      commitOptions.afterBalanceCommit?.(result);
      return result;
    } catch (error) {
      wallet.balance = initialBalance;
      transactions.length = transactionCountBefore;
      this.nextTransactionNumber = nextTransactionNumberBefore;
      if (error instanceof ApiHttpError) {
        throw error;
      }
      throw new ApiHttpError(500, {
        code: "WALLET_TRANSACTION_FAILED",
        message: "Wallet transaction could not be committed.",
        details: {}
      });
    }
  }

  private enqueue<T>(playerId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queuesByPlayerId.get(playerId) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    this.queuesByPlayerId.set(playerId, next.then(() => undefined, () => undefined));
    return next;
  }

  private validateRequest(request: WalletTransactionRequest): void {
    if (!Number.isSafeInteger(request.amount) || request.amount <= 0) {
      throw new ApiHttpError(400, {
        code: "INVALID_TRANSACTION_AMOUNT",
        message: "Wallet transaction amount must be a positive integer.",
        details: { amount: request.amount }
      });
    }
  }

  private calculateBalanceAfter(balance: number, request: WalletTransactionRequest): number {
    const balanceAfter = request.type === "debit"
      ? balance - request.amount
      : balance + request.amount;

    if (!Number.isSafeInteger(balanceAfter)) {
      throw new ApiHttpError(400, {
        code: "INVALID_BALANCE_RESULT",
        message: "Wallet transaction would produce an unsafe integer balance.",
        details: {
          playerId: request.playerId,
          balance,
          amount: request.amount
        }
      });
    }

    if (balanceAfter < 0) {
      throw new ApiHttpError(409, {
        code: "INSUFFICIENT_BALANCE",
        message: "Insufficient balance for this transaction.",
        details: {
          playerId: request.playerId,
          balance,
          amount: request.amount
        }
      });
    }

    return balanceAfter;
  }

  private getOrCreateWallet(playerId: string): Wallet {
    const existing = this.walletsByPlayerId.get(playerId);

    if (existing) {
      return existing;
    }

    const wallet = {
      playerId,
      balance: starterBalance
    };
    this.walletsByPlayerId.set(playerId, wallet);
    return wallet;
  }

  private getOrCreateTransactions(playerId: string): WalletTransactionRecord[] {
    const existing = this.transactionsByPlayerId.get(playerId);

    if (existing) {
      return existing;
    }

    const transactions: WalletTransactionRecord[] = [];
    this.transactionsByPlayerId.set(playerId, transactions);
    return transactions;
  }
}
