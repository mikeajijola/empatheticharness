import { defineTool, toolOutput, toolOutputPart } from "eve/tools";
import { z } from "zod";
import { computerFor } from "../lib/physical";
export default defineTool({
  description: "Observe the current visible viewport as rendered pixels.",
  inputSchema: z.object({}).strict(),
  async execute(_input, ctx) { return (await computerFor(ctx)).screenshot(); },
  toModelOutput(observation) {
    return toolOutput.content([
      toolOutputPart.text(`Viewport: ${observation.width} × ${observation.height} pixels. Mouse x/y use these pixel coordinates, with origin at the top-left; do not use a 0–1000 normalized coordinate scale.`),
      toolOutputPart.file(observation.base64, { mediaType: observation.mediaType }),
    ]);
  },
});
