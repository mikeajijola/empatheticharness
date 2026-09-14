import { z } from 'zod';

export const simulatorModels = [
  { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'openai/gpt-5.6-sol', label: 'GPT-5.6 Sol' },
  { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
] as const;
export const simulatorModelSchema = z.enum(['anthropic/claude-sonnet-5', 'openai/gpt-5.6-sol', 'google/gemini-3.8-flash']);
export type SimulatorModel = z.infer<typeof simulatorModelSchema>;
export const defaultSimulatorModel: SimulatorModel = 'anthropic/claude-sonnet-5';
export function selectedSimulatorModel(value: unknown): SimulatorModel {
  return simulatorModelSchema.parse(value ?? defaultSimulatorModel);
}
