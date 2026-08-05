import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { createXngGit } from "./xng-git.ts";

// 内置硬编码冒烟脚本（func 缺省时执行它）
const DEFAULT_SCRIPT =
  `console.log("searxng-server node test OK: node=" + process.version + " cwd=" + process.cwd())`;

const XNG_FUNCS = ["pullXng", "updateXng", "checkoutXng", "setupSparse", "hasXngGit", "isXngClean"] as const;

export default function (pi: ExtensionAPI) {
  const xng = createXngGit((cmd, args, opts) => pi.exec(cmd, args, opts));

  pi.registerTool({
    name: "searxng_run_node",
    label: "SearXNG Server · 测试入口",
    description:
      "测试入口：func 缺省时用 pi 自己的 node 环境跑脚本（process.execPath + pi.exec，无需额外安装 node）；" +
      "给 func 时路由到 xng-git 接口执行对应函数（pullXng/updateXng/checkoutXng/setupSparse/hasXngGit/isXngClean），git 报错仅抛出。",
    promptSnippet: "Run node smoke test or route xng-git functions",
    parameters: Type.Object({
      func: Type.Optional(
        StringEnum(XNG_FUNCS, { description: "要调用的 xng-git 函数；缺省跑 node 冒烟测试" }),
      ),
      script: Type.Optional(
        Type.String({ description: "func 缺省时用 node -e 执行的脚本" }),
      ),
    }),
    async execute(_toolCallId, params) {
      if (params.func) {
        return routeXng(xng, params.func);
      }
      const code = params.script ?? DEFAULT_SCRIPT;
      const result = await pi.exec(process.execPath, ["-e", code], { timeout: 15000 });
      const text = [result.stdout, result.stderr && `[stderr]\n${result.stderr}`]
        .filter(Boolean)
        .join("\n");
      return {
        content: [{ type: "text", text: text || "(no output)" }],
        details: {
          nodeVersion: process.version,
          execPath: process.execPath,
          exitCode: result.code,
          script: code,
        },
      };
    },
  });
}

type Xng = ReturnType<typeof createXngGit>;

// 路由：把 func + 参数映射到 xng-git 接口，返回文本结果
async function routeXng(
  xng: Xng,
  func: (typeof XNG_FUNCS)[number],
): Promise<{ content: { type: "text"; text: string }[]; details: Record<string, unknown> }> {
  switch (func) {
    case "pullXng": {
      const repoDir = await xng.pullXng();
      return {
        content: [{ type: "text", text: `已拉取到 ${repoDir}` }],
        details: { repoDir },
      };
    }
    case "updateXng": {
      const repoDir = await xng.updateXng();
      return {
        content: [{ type: "text", text: `已更新到最新：${repoDir}` }],
        details: { repoDir },
      };
    }
    case "checkoutXng": {
      const repoDir = await xng.checkoutXng();
      return {
        content: [{ type: "text", text: `已 checkout 默认分支：${repoDir}` }],
        details: { repoDir },
      };
    }
    case "setupSparse": {
      const repoDir = await xng.setupSparse();
      return {
        content: [{ type: "text", text: `已配置 sparse-checkout（/* 全量、排除黑名单）：${repoDir}` }],
        details: { repoDir },
      };
    }
    case "hasXngGit": {
      const healthy = await xng.hasXngGit();
      return {
        content: [{ type: "text", text: healthy ? "true：健康 git" : "false：不是健康 git" }],
        details: { healthy },
      };
    }
    case "isXngClean": {
      const clean = await xng.isXngClean();
      return {
        content: [{ type: "text", text: clean ? "true：与 xng 版本一致" : "false：有改动或非 git" }],
        details: { clean },
      };
    }
    default:
      throw new Error(`未知 xng-git 函数：${func}`);
  }
}
