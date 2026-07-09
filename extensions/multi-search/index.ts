import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export default function (pi: ExtensionAPI) {
  // Locate search binary relative to this extension directory
  // On Windows the binary is search.exe, on Unix it is search
  const extDir = dirname(fileURLToPath(import.meta.url));
  const binaryName = process.platform === "win32" ? "search.exe" : "search";
  const binaryPath = join(extDir, "dist", binaryName);

  pi.registerTool({
    name: "multi_search",
    label: "Multi-Engine Search",
    description:
      "Search across multiple engines (arxiv, duckduckgo, github, hackernews, wikipedia, bing) and return merged JSON results. Use this for technical research, code search, news, and general web queries.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      engines: Type.Optional(
        Type.String({
          description:
            "Comma-separated engine names. Available: arxiv, duckduckgo, github, hackernews, wikipedia, bing. Default: arxiv,duckduckgo,github",
        })
      ),
      max_results: Type.Optional(
        Type.Number({
          description: "Max results per engine (default: 5)",
        })
      ),
      timeout: Type.Optional(
        Type.Number({
          description: "Timeout per engine in seconds (default: 15)",
        })
      ),
      no_proxy: Type.Optional(
        Type.Boolean({
          description: "Set to true to disable proxy (default: false, proxy is used)",
        })
      ),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const args: string[] = [params.query];
      if (params.engines) args.push("--engines", params.engines);
      if (params.max_results)
        args.push("--max-results", String(params.max_results));
      if (params.timeout)
        args.push("--timeout", String(params.timeout));
      if (params.no_proxy)
        args.push("--no-proxy");

      // Pre-check: binary must exist (pi.exec does NOT throw on ENOENT;
      // it resolves with code=1 and empty stdout, which would produce
      // an unhelpful "(see attached image)" instead of a clear error).
      if (!existsSync(binaryPath)) {
        const platform = process.platform;
        const setupScript =
          platform === "win32" ? "./setup.bat" :
          platform === "linux" || platform === "darwin" ? "bash setup.sh" :
          `setup.bat (Windows) / bash setup.sh (Unix)  (unsupported platform: ${platform})`;
        return {
          content: [
            {
              type: "text",
              text: `Search binary not found: ${binaryPath}

System: ${platform}
Run \`${setupScript}\` in the extension directory to build dist/search(.exe).`,
            },
          ],
          details: { reason: "binary_not_found", platform },
        };
      }

      try {
        const result = await pi.exec(binaryPath, args, { signal });
        // Guard: empty stdout triggers "(see attached image)" placeholder bug
        // in OpenAI-compatible providers (hasText = textResult.length > 0).
        // search.py always prints JSON, so empty stdout means the binary
        // crashed before printing (import error, killed, etc).
        const text = result.stdout && result.stdout.trim()
          ? result.stdout
          : `Search produced no output (exit code ${result.code}).\nstderr:\n${result.stderr || "(empty)"}`;
        return {
          content: [{ type: "text", text }],
          details: { exitCode: result.code, stderr: result.stderr },
        };
      } catch (e: any) {
        return {
          content: [
            {
              type: "text",
              text: `Search failed: ${e.message}`,
            },
          ],
          details: { error: String(e) },
        };
      }
    },
  });
}
