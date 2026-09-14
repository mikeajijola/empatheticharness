import { z } from "zod";
import type { ToolContext } from "eve/tools";
import { getComputer } from "./computer";
export const mouseSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("move"), x: z.number().int().nonnegative(), y: z.number().int().nonnegative() }).strip(),
  z.object({ action: z.literal("click"), x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), button: z.enum(["left", "right"]).optional() }).strip(),
  z.object({ action: z.literal("scroll"), deltaX: z.number().int().min(-5000).max(5000).default(0), deltaY: z.number().int().min(-5000).max(5000) }).strip(),
]);
export const keyboardSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("type"), text: z.string().max(4000) }).strip(),
  z.object({ action: z.literal("press"), key: z.string().min(1).max(30) }).strip(),
  z.object({ action: z.literal("hotkey"), keys: z.array(z.string().min(1).max(30)).min(1).max(4) }).strip(),
]);
export function computerFor(ctx: ToolContext) {
  const initialUrl = ctx.session.auth.initiator?.attributes.initialUrl;
  return getComputer(ctx.session.id, { callId: ctx.callId, ...(typeof initialUrl === "string" ? { initialUrl } : {}) });
}

// Flat model-facing schemas keep required discriminators visible across providers.
// The strict action-specific schemas above validate relationships at execution.
export const mouseInputSchema = z.object({
  action: z.enum(["move", "click", "scroll"]),
  x: z.number().int().nonnegative().nullish(), y: z.number().int().nonnegative().nullish(),
  button: z.enum(["left", "right"]).nullish(),
  deltaX: z.number().int().min(-5000).max(5000).nullish(), deltaY: z.number().int().min(-5000).max(5000).nullish(),
}).strict();
export const keyboardInputSchema = z.object({
  action: z.enum(["type", "press", "hotkey"]), text: z.string().max(4000).nullish(),
  key: z.string().max(30).nullish(), keys: z.array(z.string().max(30)).max(4).nullish(),
}).strict();

export function normalizePhysicalInput(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null && value !== undefined));
}
