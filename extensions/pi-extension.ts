import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawnSync } from "node:child_process";
import { isProtectedCall, smartFormatPrunedText, dehydrateImages } from "/Users/yangyu/.agents/plugins/universal-jev/src/compactor.js";
import { recordPruneEvent } from "/Users/yangyu/.agents/plugins/universal-jev/src/telemetry.js";


const JEV_CLI = "/Users/yangyu/.local/bin/jev";
const PRUNE_THRESHOLD_CHARS = 4000;

import fs from "node:fs";

export default function (pi: ExtensionAPI) {
  try {
    fs.appendFileSync("/tmp/pi_extension_audit.log", `[AUDIT] Universal Jev loaded in Pi PID ${process.pid} at ${new Date().toISOString()}\n`);
  } catch {}

  // 1. Session start notice
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Universal Jev Compactor & Decision Engine Loaded ✓", "info");
  });

  // 2. In-flight tool result pruning (Automatic 95% noise reduction with source code immunity)
  pi.on("tool_result", async (event, ctx) => {
    const { toolName, toolCallId, input, content } = event;
    if (!content || !Array.isArray(content)) return;

    for (let i = 0; i < content.length; i++) {
      const part = content[i];
      if (part.type === "text" && typeof part.text === "string" && part.text.length > PRUNE_THRESHOLD_CHARS) {
        // Zero-destructive protection barrier for project source code
        if (isProtectedCall(toolName, input, part.text)) {
          continue;
        }

        // Prune massive transient terminal output
        const pruned = smartFormatPrunedText(part.text, 12, 35);
        if (pruned && pruned.length < part.text.length) {
          const savings = part.text.length - pruned.length;
          recordPruneEvent({
            agent: 'Pi',
            command: typeof input?.command === 'string' ? input.command : toolName,
            originalChars: part.text.length,
            prunedChars: pruned.length
          });
          part.text = pruned;
          ctx.ui.notify(`[Jev] Pruned ${savings} chars of transient log output to protect context budget.`, "info");
        }
      }
    }
  });

  // 3. Automated Context Image Dehydration (>= 3 rounds)
  pi.on("context", async (event, ctx) => {
    if (!event.messages || !Array.isArray(event.messages)) return;
    const result = dehydrateImages(event.messages, 3);
    if (result && result.dehydratedCount > 0) {
      recordPruneEvent({
        agent: 'Pi',
        command: `Image Dehydration (${result.dehydratedCount} imgs, >=3 rounds)`,
        originalChars: result.charsSaved,
        prunedChars: 0,
      });
      try {
        ctx.ui.notify(
          `[Universal Jev] 自动完成 ${result.dehydratedCount} 张历史图片脱水，已释放约 ${result.tokensSaved.toLocaleString()} tokens 预算！`,
          "info"
        );
      } catch {}
      return { messages: result.messages as typeof event.messages };
    }
  });

  // 4. Register Jev Decision Tools for Pi
  pi.registerTool({
    name: "jev_decide_noul",
    label: "Jev Noul Verification",
    description: "Calibrated boolean verification returning true probability between 0.0 and 1.0 (millisecond System 1 decision).",
    parameters: Type.Object({
      question: Type.String({ description: "Yes/No verification question" }),
      state: Type.String({ description: "Context or assertion to verify" })
    }),
    async execute(_id, params) {
      const res = spawnSync(JEV_CLI, ["--noul", params.question, "--state", params.state], {
        encoding: "utf-8"
      });
      return {
        content: [{ type: "text", text: res.stdout || res.stderr || "{}" }],
        details: {}
      };
    }
  });

  pi.registerTool({
    name: "jev_decide_choice",
    label: "Jev Choice Classification",
    description: "Fast, calibrated multi-option classification with relative probabilities.",
    parameters: Type.Object({
      question: Type.String({ description: "Classification instruction" }),
      state: Type.String({ description: "Context or text to classify" }),
      criteria: Type.String({ description: "Comma-separated key:description pairs, e.g. 'bug:Issue,feat:Feature'" })
    }),
    async execute(_id, params) {
      const res = spawnSync(JEV_CLI, ["--choice", params.question, "--criteria", params.criteria, "--state", params.state], {
        encoding: "utf-8"
      });
      return {
        content: [{ type: "text", text: res.stdout || res.stderr || "{}" }],
        details: {}
      };
    }
  });
}
