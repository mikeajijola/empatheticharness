import { defineTool } from "eve/tools";
import { computerFor, mouseSchema, mouseInputSchema, normalizePhysicalInput } from "../lib/physical";
export default defineTool({
  description: "One spatial mouse action. Coordinates are viewport pixels. Observe screen after every action.",
  inputSchema: mouseInputSchema,
  async execute(rawInput, ctx) {
    const input = mouseSchema.parse(normalizePhysicalInput(rawInput));
    const computer = await computerFor(ctx);
    if (input.action === "move") await computer.moveMouse(input.x, input.y);
    else if (input.action === "click") await computer.click(input.x, input.y, input.button);
    else await computer.scroll(input.deltaX, input.deltaY);
    return { performed: true };
  },
});
