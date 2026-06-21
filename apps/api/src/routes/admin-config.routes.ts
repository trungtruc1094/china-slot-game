import { Router } from "express";
import { ZodError } from "zod";
import { calculateRtpReport, runSimulation } from "@china-slot-game/game-math";
import type { GameConfigurationRecord, GameConfigurationRepository } from "../domain/game-configuration-repository.js";
import { requireAdminRole } from "../middleware/admin-auth.js";
import { ApiHttpError } from "../middleware/error-handler.js";
import { okEnvelope } from "../schemas/api-envelope.js";
import {
  activateDraftRequestSchema,
  attachMathReportRequestSchema,
  createDraftConfigRequestSchema,
  rollbackConfigRequestSchema,
  runSimulationRequestSchema,
  updateDraftConfigRequestSchema
} from "../schemas/admin-config.schema.js";

const maxSimulationDurationMs = 1_000;

export function createAdminConfigRouter(configRepository: GameConfigurationRepository): Router {
  const router = Router();

  router.post("/admin/configs/drafts", async (request, response, next) => {
    try {
      const { actor } = requireAdminRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator"]);
      const parsedRequest = createDraftConfigRequestSchema.parse(request.body);
      const draft = await configRepository.createDraft({
        id: parsedRequest.id,
        config: parsedRequest.config,
        actor,
        metadata: parsedRequest.reason ? { reason: parsedRequest.reason } : {}
      });
      response.status(201).json(okEnvelope({ draft: serializeRecord(draft) }, request.requestId));
    } catch (error) {
      next(normalizeDraftError(error));
    }
  });

  router.put("/admin/configs/drafts/:id", async (request, response, next) => {
    try {
      const { actor } = requireAdminRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator"]);
      const parsedRequest = updateDraftConfigRequestSchema.parse(request.body);
      const draft = await configRepository.updateDraft({
        id: request.params.id ?? "",
        config: parsedRequest.config,
        actor,
        metadata: parsedRequest.reason ? { reason: parsedRequest.reason } : {}
      });
      response.status(200).json(okEnvelope({ draft: serializeRecord(draft) }, request.requestId));
    } catch (error) {
      next(normalizeDraftError(error));
    }
  });

  router.get("/admin/configs/drafts", async (request, response, next) => {
    try {
      requireAdminRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator", "support", "viewer"]);
      const drafts = (await configRepository.list())
        .filter((record) => record.status === "draft")
        .map((record) => serializeRecord(record));
      response.status(200).json(okEnvelope({ drafts }, request.requestId));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/configs/drafts/:id/math-report", async (request, response, next) => {
    try {
      const { actor } = requireAdminRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator"]);
      const parsedRequest = attachMathReportRequestSchema.parse(request.body);
      const draft = await configRepository.read(request.params.id ?? "");
      if (!draft || draft.status !== "draft") {
        throw new ApiHttpError(404, {
          code: "CONFIG_NOT_FOUND",
          message: "Draft configuration was not found.",
          details: { id: request.params.id }
        });
      }
      const report = calculateRtpReport(
        draft.config,
        parsedRequest.wager ? { wager: parsedRequest.wager } : {}
      );
      const mathReport = await configRepository.attachMathReport({
        draftId: draft.id,
        report,
        actor
      });
      response.status(201).json(okEnvelope({ mathReport: serializeMathReport(mathReport) }, request.requestId));
    } catch (error) {
      next(normalizeDraftError(error, "INVALID_MATH_REPORT_REQUEST"));
    }
  });

  router.get("/admin/configs/drafts/:id/math-report", async (request, response, next) => {
    try {
      requireAdminRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator", "support", "viewer"]);
      const mathReport = await configRepository.getMathReportForDraft(request.params.id ?? "");
      if (!mathReport) {
        throw new ApiHttpError(404, {
          code: "MATH_REPORT_NOT_FOUND",
          message: "Math report was not found for this draft configuration.",
          details: { id: request.params.id }
        });
      }
      response.status(200).json(okEnvelope({ mathReport: serializeMathReport(mathReport) }, request.requestId));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/configs/drafts/:id/simulations", async (request, response, next) => {
    try {
      const { actor } = requireAdminRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator"]);
      const parsedRequest = runSimulationRequestSchema.parse(request.body);
      const draft = await configRepository.read(request.params.id ?? "");
      if (!draft || draft.status !== "draft") {
        throw new ApiHttpError(404, {
          code: "CONFIG_NOT_FOUND",
          message: "Draft configuration was not found.",
          details: { id: request.params.id }
        });
      }
      const mathReport = await configRepository.getMathReportForDraft(draft.id);
      if (!mathReport) {
        throw new ApiHttpError(404, {
          code: "MATH_REPORT_NOT_FOUND",
          message: "A math report must be attached before simulation.",
          details: { id: draft.id }
        });
      }
      if (mathReport.report.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
        throw new ApiHttpError(409, {
          code: "CONFIG_MATH_REPORT_BLOCKED",
          message: "Draft configuration has blocking math diagnostics.",
          details: { id: draft.id, mathReportId: mathReport.id }
        });
      }

      const simulationInput = {
        spinCount: parsedRequest.spinCount,
        ...(parsedRequest.seed ? { seed: parsedRequest.seed } : {}),
        ...(parsedRequest.wager ? { wager: parsedRequest.wager } : {}),
        theoreticalRtp: mathReport.report.theoreticalRtp
      };
      const startedAt = Date.now();
      const result = runSimulation(draft.config, simulationInput);
      const durationMs = Date.now() - startedAt;
      if (durationMs > maxSimulationDurationMs) {
        throw new ApiHttpError(409, {
          code: "SIMULATION_LIMIT_EXCEEDED",
          message: "Simulation exceeded the configured runtime limit.",
          details: { durationMs, maxSimulationDurationMs }
        });
      }
      const simulationRun = await configRepository.storeSimulationRun({
        draftId: draft.id,
        input: simulationInput,
        result,
        actor
      });
      response.status(201).json(okEnvelope({ simulationRun: serializeSimulationRun(simulationRun) }, request.requestId));
    } catch (error) {
      next(normalizeDraftError(error, "INVALID_SIMULATION_REQUEST"));
    }
  });

  router.get("/admin/configs/drafts/:id/simulations", async (request, response, next) => {
    try {
      requireAdminRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator", "support", "viewer"]);
      const simulationRuns = (await configRepository.listSimulationRuns(request.params.id ?? ""))
        .map((run) => serializeSimulationRun(run));
      response.status(200).json(okEnvelope({ simulationRuns }, request.requestId));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/configs/drafts/:id/simulations/:runId", async (request, response, next) => {
    try {
      requireAdminRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator", "support", "viewer"]);
      const simulationRun = await configRepository.getSimulationRun(request.params.id ?? "", request.params.runId ?? "");
      if (!simulationRun) {
        throw new ApiHttpError(404, {
          code: "SIMULATION_NOT_FOUND",
          message: "Simulation run was not found.",
          details: { id: request.params.id, runId: request.params.runId }
        });
      }
      response.status(200).json(okEnvelope({ simulationRun: serializeSimulationRun(simulationRun) }, request.requestId));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/configs/drafts/:id/activate", async (request, response, next) => {
    try {
      const { actor } = requireAdminRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator"]);
      const parsedRequest = activateDraftRequestSchema.parse(request.body);
      const draft = await configRepository.read(request.params.id ?? "");
      if (!draft || draft.status !== "draft") {
        throw new ApiHttpError(draft ? 409 : 404, {
          code: draft ? "CONFIG_STATUS_CONFLICT" : "CONFIG_NOT_FOUND",
          message: draft ? "Only draft configurations can be activated." : "Draft configuration was not found.",
          details: { id: request.params.id, status: draft?.status }
        });
      }
      const mathReport = await configRepository.getMathReportForDraft(draft.id);
      if (!mathReport) {
        throw new ApiHttpError(404, {
          code: "MATH_REPORT_NOT_FOUND",
          message: "A math report must be attached before activation.",
          details: { id: draft.id }
        });
      }
      const simulationRuns = await configRepository.listSimulationRuns(draft.id);
      if (simulationRuns.length === 0) {
        throw new ApiHttpError(404, {
          code: "SIMULATION_NOT_FOUND",
          message: "At least one simulation run must exist before activation.",
          details: { id: draft.id }
        });
      }
      const activeConfig = await configRepository.activateDraft({
        id: draft.id,
        actor,
        ...(parsedRequest.reason ? { reason: parsedRequest.reason } : {})
      });
      response.status(200).json(okEnvelope({ activeConfig: serializeRecord(activeConfig) }, request.requestId));
    } catch (error) {
      next(normalizeDraftError(error, "INVALID_ACTIVATION_REQUEST"));
    }
  });

  router.post("/admin/configs/rollback", async (request, response, next) => {
    try {
      const { actor } = requireAdminRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator"]);
      const parsedRequest = rollbackConfigRequestSchema.parse(request.body);
      const activeConfig = await configRepository.rollbackToVersion({
        targetVersionId: parsedRequest.targetVersionId,
        actor,
        ...(parsedRequest.reason ? { reason: parsedRequest.reason } : {})
      });
      response.status(200).json(okEnvelope({ activeConfig: serializeRecord(activeConfig) }, request.requestId));
    } catch (error) {
      next(normalizeDraftError(error, "INVALID_ACTIVATION_REQUEST"));
    }
  });

  router.get("/admin/configs/audit-events", async (request, response, next) => {
    try {
      requireAdminRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator", "support", "viewer"]);
      const auditEvents = (await configRepository.listAuditEvents()).map((event) => serializeAuditEvent(event));
      response.status(200).json(okEnvelope({ auditEvents }, request.requestId));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/configs/drafts/:id", async (request, response, next) => {
    try {
      requireAdminRole(request.header("x-admin-role"), request.header("x-admin-actor"), ["operator", "support", "viewer"]);
      const record = await configRepository.read(request.params.id ?? "");
      if (!record || record.status !== "draft") {
        throw new ApiHttpError(404, {
          code: "CONFIG_NOT_FOUND",
          message: "Draft configuration was not found.",
          details: { id: request.params.id }
        });
      }
      response.status(200).json(okEnvelope({ draft: serializeRecord(record) }, request.requestId));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function normalizeDraftError(error: unknown, code = "INVALID_CONFIG_DRAFT"): unknown {
  if (error instanceof ZodError) {
    return new ApiHttpError(400, {
      code,
      message: "Admin configuration payload is invalid.",
      details: { issues: error.issues }
    });
  }
  return error;
}

function serializeRecord(record: GameConfigurationRecord): Record<string, unknown> {
  return {
    id: record.id,
    configId: record.configId,
    versionId: record.versionId,
    versionNumber: record.versionNumber ?? null,
    mathReportId: record.mathReportId ?? null,
    status: record.status,
    config: record.config,
    metadata: record.metadata,
    createdBy: record.createdBy,
    updatedBy: record.updatedBy,
    activatedBy: record.activatedBy ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    activatedAt: record.activatedAt?.toISOString() ?? null
  };
}

function serializeMathReport(record: {
  id: string;
  draftId: string;
  configId: string;
  configVersionId: string;
  report: unknown;
  createdBy: string;
  createdAt: Date;
}): Record<string, unknown> {
  return {
    id: record.id,
    draftId: record.draftId,
    configId: record.configId,
    configVersionId: record.configVersionId,
    report: record.report,
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString()
  };
}

function serializeSimulationRun(record: {
  id: string;
  draftId: string;
  configId: string;
  configVersionId: string;
  input: unknown;
  result: unknown;
  createdBy: string;
  createdAt: Date;
}): Record<string, unknown> {
  return {
    id: record.id,
    draftId: record.draftId,
    configId: record.configId,
    configVersionId: record.configVersionId,
    input: record.input,
    result: record.result,
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString()
  };
}

function serializeAuditEvent(record: {
  id: string;
  action: string;
  targetId: string;
  actor: string;
  reason?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}): Record<string, unknown> {
  return {
    id: record.id,
    action: record.action,
    targetId: record.targetId,
    actor: record.actor,
    reason: record.reason ?? null,
    metadata: record.metadata,
    createdAt: record.createdAt.toISOString()
  };
}
