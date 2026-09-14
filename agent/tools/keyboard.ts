import { defineTool } from "eve/tools";
import { computerFor, keyboardSchema, keyboardInputSchema, normalizePhysicalInput } from "../lib/physical";
export default defineTool({
  description: "One keyboard action into the focused visible interface. Observe screen afterward.",
  inputSchema: keyboardInputSchema,
  async execute(rawInput, ctx) {
    const input = keyboardSchema.parse(normalizePhysicalInput(rawInput));
    const computer = await computerFor(ctx);
    if (input.action === "type") await computer.type(input.text);
    else if (input.action === "press") await computer.pressKey(input.key);
    else await computer.hotkey(input.keys);
    return { performed: true };
  },
});
