import { defineAgent, defineDynamic } from "eve";
import { gateway, wrapLanguageModel } from "ai";
import { boundaryMiddleware } from "./lib/boundary";
import { selectedSimulatorModel } from "../lib/models";

export default defineAgent({
  model: defineDynamic({ events: {
    // Resolve the same immutable selection for every step, while preserving the tool boundary.
    "step.started": (_event, ctx) => ({
      model: wrapLanguageModel({ model: gateway(selectedSimulatorModel(ctx.session.auth.initiator?.attributes.simulatorModel)), middleware: boundaryMiddleware }),
    }),
  } }),
  reasoning: "low",
  defaultTools: false,
  compaction: { thresholdPercent: 0.9 },
  limits: { maxInputTokensPerSession: 500_000, maxOutputTokensPerSession: 20_000, sessionTimeoutMs: 1_800_000 },
});
