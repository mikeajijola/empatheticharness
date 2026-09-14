import { recentScreenshots } from './visual-history';
import { withRateLimitRetry } from "../../lib/model-retry";
export { withRateLimitRetry } from "../../lib/model-retry";
import type { LanguageModelMiddleware } from "ai";
export const environmentalTools = ["keyboard", "mouse", "screen"] as const;
export function assertToolSurface(tools: readonly { type: string; name: string }[] | undefined): string[] {
  const names = (tools ?? []).map(t => t.name).sort();
  if (tools?.some(t => t.type !== "function") || JSON.stringify(names) !== JSON.stringify(environmentalTools)) {
    throw new Error(`CAPABILITY_BOUNDARY_VIOLATION: ${names.join(",")}`);
  }
  return names;
}
export const boundaryMiddleware: LanguageModelMiddleware = {
  specificationVersion: "v4",
  async wrapStream({ doStream, params }) { return withRateLimitRetry(doStream, undefined, params.abortSignal); },
  async wrapGenerate({ doGenerate, params }) { return withRateLimitRetry(doGenerate, undefined, params.abortSignal); },
  async transformParams({ params }) {
    const names = assertToolSurface(params.tools);
    console.info(JSON.stringify({ kind: "effective-model-tools", tools: names, at: new Date().toISOString() }));
    return { ...params, prompt: recentScreenshots(params.prompt), maxOutputTokens: Math.min(params.maxOutputTokens ?? 4096, 4096) };
  },
};
