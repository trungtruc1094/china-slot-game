import { createHash } from "node:crypto";
import type { Clock } from "./session-service.js";
import type { TeviAuthContext } from "./tevi-auth-adapter.js";

export interface TopupServiceConfig {
  appId: string;
  billingChannelId: string;
  depositMinStars: number;
  depositMaxStars: number;
}

export interface IssueDepositTokenRequest {
  appId: string;
  billingChannelId: string;
  playerId: string;
  teviSubject: string;
  amount: number;
  requestId: string;
  userAppToken: string;
}

export type TeviPaymentClientResult = TeviPaymentClientSuccess | TeviPaymentClientFailure;

export interface TeviPaymentClientSuccess {
  ok: true;
  depositToken: string;
}

export interface TeviPaymentClientFailure {
  ok: false;
  code: "TEVI_PAYMENT_CONFIG_MISSING" | "TEVI_TOP_UP_SIGNATURE_FAILED";
  reasonCode: string;
  statusCode: number;
  providerStatusCode?: number;
}

export interface TeviPaymentClientPort {
  issueDepositToken(request: IssueDepositTokenRequest): Promise<TeviPaymentClientResult>;
}

export type TopupSignatureStatus = "issued" | "failed";

export interface TopupSignatureIssuanceInput {
  providerName: "tevi";
  playerId: string | null;
  teviSubject: string | null;
  amount: number | null;
  requestId: string;
  depositTokenFingerprint: string | null;
  status: TopupSignatureStatus;
  failureReason: string | null;
  providerStatusCode: number | null;
  providerMetadata: Record<string, unknown>;
  createdAt: Date;
}

export interface TopupSignatureIssuanceRecord extends Omit<TopupSignatureIssuanceInput, "createdAt"> {
  id: string;
  createdAt: string;
}

export interface TopupSignatureIssuanceRepository {
  findByRequestId(requestId: string): Promise<TopupSignatureIssuanceRecord[]>;
  create(record: TopupSignatureIssuanceInput): Promise<TopupSignatureIssuanceRecord>;
}

export type TopupSignatureResult = TopupSignatureSuccess | TopupSignatureFailure;

export interface TopupSignatureSuccess {
  ok: true;
  depositToken: string;
  tokenFingerprint: string;
}

export interface TopupSignatureFailure {
  ok: false;
  code: "INVALID_TOP_UP_AMOUNT" | "TEVI_TOP_UP_LIMIT_EXCEEDED" | "TEVI_PAYMENT_CONFIG_MISSING" | "TEVI_TOP_UP_SIGNATURE_FAILED" | "TEVI_AUTH_REQUIRED" | "TEVI_TOP_UP_DUPLICATE_REQUEST";
  reasonCode: string;
  statusCode: number;
  providerStatusCode?: number;
}

export interface TopupSignatureRequest {
  playerId: string;
  teviAuth: TeviAuthContext;
  amount: number;
  requestId: string;
  userAppToken: string;
}

const systemClock: Clock = { now: () => new Date() };

export class TopupService {
  public constructor(
    private readonly config: TopupServiceConfig,
    private readonly paymentClient: TeviPaymentClientPort,
    private readonly issuanceRepository: TopupSignatureIssuanceRepository,
    private readonly clock: Clock = systemClock
  ) {}

  public async issueSignature(request: TopupSignatureRequest): Promise<TopupSignatureResult> {
    const baseMetadata = {
      appId: this.config.appId,
      billingChannelId: this.config.billingChannelId
    };

    if (!request.playerId.trim() || request.teviAuth.provider !== "tevi" || !request.teviAuth.subject.trim()) {
      const failure = { ok: false, code: "TEVI_AUTH_REQUIRED", reasonCode: "AUTH_CONTEXT_INVALID", statusCode: 401 } as const;
      await this.recordFailure(request, failure, baseMetadata);
      return failure;
    }

    const amountFailure = this.validateAmount(request.amount);
    if (amountFailure) {
      await this.recordFailure(request, amountFailure, baseMetadata);
      return amountFailure;
    }

    const existingIssuances = await this.issuanceRepository.findByRequestId(request.requestId);
    if (existingIssuances.length > 0) {
      console.warn("[tevi-topup] duplicate top-up signature request rejected", {
        requestId: request.requestId,
        playerId: request.playerId,
        teviSubject: request.teviAuth.subject,
        amount: request.amount,
        reasonCode: "REQUEST_ID_ALREADY_USED"
      });
      return {
        ok: false,
        code: "TEVI_TOP_UP_DUPLICATE_REQUEST",
        reasonCode: "REQUEST_ID_ALREADY_USED",
        statusCode: 409
      };
    }

    const providerResult = await this.paymentClient.issueDepositToken({
      appId: this.config.appId,
      billingChannelId: this.config.billingChannelId,
      playerId: request.playerId,
      teviSubject: request.teviAuth.subject,
      amount: request.amount,
      requestId: request.requestId,
      userAppToken: request.userAppToken
    });

    if (!providerResult.ok) {
      await this.recordFailure(request, providerResult, baseMetadata);
      console.warn("[tevi-topup] deposit token issuance failed", {
        requestId: request.requestId,
        playerId: request.playerId,
        teviSubject: request.teviAuth.subject,
        amount: request.amount,
        reasonCode: providerResult.reasonCode,
        providerStatusCode: providerResult.providerStatusCode
      });
      return providerResult;
    }

    const tokenFingerprint = fingerprintDepositToken(providerResult.depositToken);
    await this.issuanceRepository.create({
      providerName: "tevi",
      playerId: request.playerId,
      teviSubject: request.teviAuth.subject,
      amount: request.amount,
      requestId: request.requestId,
      depositTokenFingerprint: tokenFingerprint,
      status: "issued",
      failureReason: null,
      providerStatusCode: null,
      providerMetadata: baseMetadata,
      createdAt: this.clock.now()
    });

    return {
      ok: true,
      depositToken: providerResult.depositToken,
      tokenFingerprint
    };
  }

  private validateAmount(amount: number): TopupSignatureFailure | undefined {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      return { ok: false, code: "INVALID_TOP_UP_AMOUNT", reasonCode: "AMOUNT_NOT_POSITIVE_INTEGER", statusCode: 400 };
    }

    if (amount < this.config.depositMinStars) {
      return { ok: false, code: "TEVI_TOP_UP_LIMIT_EXCEEDED", reasonCode: "AMOUNT_BELOW_MIN", statusCode: 400 };
    }

    if (amount > this.config.depositMaxStars) {
      return { ok: false, code: "TEVI_TOP_UP_LIMIT_EXCEEDED", reasonCode: "AMOUNT_ABOVE_MAX", statusCode: 400 };
    }

    return undefined;
  }

  private async recordFailure(
    request: TopupSignatureRequest,
    failure: TopupSignatureFailure | TeviPaymentClientFailure,
    providerMetadata: Record<string, unknown>
  ): Promise<void> {
    await this.issuanceRepository.create({
      providerName: "tevi",
      playerId: request.playerId.trim() ? request.playerId : null,
      teviSubject: request.teviAuth.subject.trim() ? request.teviAuth.subject : null,
      amount: Number.isSafeInteger(request.amount) ? request.amount : null,
      requestId: request.requestId,
      depositTokenFingerprint: null,
      status: "failed",
      failureReason: failure.reasonCode,
      providerStatusCode: failure.providerStatusCode ?? null,
      providerMetadata,
      createdAt: this.clock.now()
    });
  }
}

export function fingerprintDepositToken(depositToken: string): string {
  return createHash("sha256").update(depositToken).digest("hex");
}
