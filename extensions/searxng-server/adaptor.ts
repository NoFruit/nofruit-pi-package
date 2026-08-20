// 定位：把本地 xng 服务转接给搜索消费者（配置菜单勾选的插件）。
// 机制：tool_call 时点做注入判定——每次搜索独立判定，健康注入、不健康撤销；
// 勾选（routed）= 持久路由意图（跨会话，adaptor.json），服务恢复后自动重新转接，
// 唯一门控是最终依赖判断（manager 在 + xng 通），无失败冻结等中间状态。
// 零持久化于消费者侧：不写其配置文件（保持默认设置），env/input 进程内作用域。
// 通道：pi-web-access 显式 provider 优先于自动路由 → 健康时覆盖调用者 provider 为
// searxng + 注入 SEARXNG_BASE_URL（getBaseUrl 每次调用实时读 env），不健康时双恢复。
// 前提（一次性，用户侧）：web-search.json 配 ssrf.allowRanges: ["127.0.0.0/8"]。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { xngRepoDir } from "./xng-git.ts";
import type { XngFacts } from "./status.ts";

// xng 服务地址（端口即契约；与 manager.ts 同源：SEARXNG_PORT 可覆盖）
export const XNG_BASE_URL = `http://127.0.0.1:${Number(process.env.SEARXNG_PORT ?? 8888)}`;

// 注入通道 env 键（消费者原生读取，非私有协议）
const ENV_KEY = "SEARXNG_BASE_URL";

// 支持表：可被转接的搜索消费者（包名 → 工具名列表）。新增消费者 = 加一行。
export const SUPPORTED: ReadonlyArray<{
	package: string;
	tools: readonly string[];
}> = [{ package: "pi-web-access", tools: ["web_search"] }];

// 勾选持久化：<cache>/searxng-server/adaptor.json；XNG_ADAPTOR_CONFIG 可覆盖（测试用）
const CONFIG_PATH =
	process.env.XNG_ADAPTOR_CONFIG ?? join(xngRepoDir(), "..", "adaptor.json");

export interface ConfigRow {
	package: string;
	enabled: boolean;
}

function loadRouted(): Set<string> {
	try {
		const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as {
			routed?: unknown;
		};
		const list = Array.isArray(raw.routed) ? raw.routed : [];
		return new Set(list.filter((s): s is string => typeof s === "string"));
	} catch {
		return new Set();
	}
}

function saveRouted(routed: Set<string>): void {
	mkdirSync(dirname(CONFIG_PATH), { recursive: true });
	writeFileSync(CONFIG_PATH, JSON.stringify({ routed: [...routed] }, null, 2));
}

// 勾选状态（内存镜像，load 于模块加载；命令改动后 applyConfig 同步写盘）
let routed = loadRouted();

// 配置菜单数据：支持表每行 + 当前勾选
export function configRows(): ConfigRow[] {
	return SUPPORTED.map((e) => ({
		package: e.package,
		enabled: routed.has(e.package),
	}));
}

// 应用勾选（命令 UI 结果 → 内存 + 持久化）
export function applyConfig(rows: ConfigRow[]): string[] {
	routed = new Set(rows.filter((r) => r.enabled).map((r) => r.package));
	saveRouted(routed);
	return [...routed];
}

// 原值保留：首次判定时捕获消费者自身设置，不健康时恢复（保持默认设置）
let originalValue: string | undefined;
let captured = false;

// 消费者路由策略（pi-web-access）：显式 provider 优先于自动路由 → 健康时覆盖调用者 provider
// 为 searxng（env 注入仍必要：isSearXNGAvailable 依赖 baseUrl 非空），不健康时恢复调用者原值；
// 覆盖是本次调用级（input 每次独立），env 是进程级（首次捕获原值）。
const PROVIDER_OVERRIDE = "searxng";

// 单次判定：工具属于勾选插件的工具表 且 健康 → 注入本地地址（env + provider），本次搜索走 xng；
// 勾选但不健康 → 恢复原值/删除（回退消费者默认通路）；未勾选 → 完全不干预。
export function onToolCall(
	toolName: string,
	f: XngFacts,
	input?: Record<string, unknown>,
): void {
	const entry = SUPPORTED.find((e) => e.tools.includes(toolName));
	if (!entry || !routed.has(entry.package)) return;
	if (!captured) {
		originalValue = process.env[ENV_KEY];
		captured = true;
	}
	const originalProvider = input?.provider;
	if (f.managerAlive && f.xngOk) {
		process.env[ENV_KEY] = XNG_BASE_URL;
		if (input) input.provider = PROVIDER_OVERRIDE;
	} else {
		if (originalValue === undefined) delete process.env[ENV_KEY];
		else process.env[ENV_KEY] = originalValue;
		if (input) {
			if (originalProvider === undefined) delete input.provider;
			else input.provider = originalProvider;
		}
	}
}
