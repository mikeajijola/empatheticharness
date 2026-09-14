import type { LanguageModelV4Prompt } from '@ai-sdk/provider';

/** Keep action/text history intact; only omit older screenshot payloads from model calls. */
export function recentScreenshots(prompt: LanguageModelV4Prompt, keep = 5): LanguageModelV4Prompt {
  let remaining = keep;
  return [...prompt].reverse().map(message => {
    if (message.role !== 'tool') return message;
    return { ...message, content: [...message.content].reverse().map(part => {
      if (part.type !== 'tool-result' || part.toolName !== 'screen' || part.output.type !== 'content') return part;
      if (!part.output.value.some(p => p.type === 'file' && p.mediaType.startsWith('image/'))) return part;
      if (remaining-- > 0) return part;
      return { ...part, output: { ...part.output, value: part.output.value.map(p =>
        p.type === 'file' && p.mediaType.startsWith('image/')
          ? { type: 'text' as const, text: '[Older screenshot archived in report. Use recent screenshots for current state.]' } : p) } };
    }).reverse() };
  }).reverse();
}
