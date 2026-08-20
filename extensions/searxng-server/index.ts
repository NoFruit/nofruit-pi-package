// 定位：searxng-server 扩展入口——判断层接线（watch 事实 + 文件哨兵）→ 状态机（status.ts）→ 状态行渲染。
// 命令：start（预判环境）| stop | status | fix（容错重建）。
// 检查频率（无后台全量轮询）：全量 probe 仅在启动、offline 切换瞬间、哨兵变化、命令触发时跑；
// offline 周期仅 5 stat 哨兵（零进程零扫描），哨兵丢失/恢复才升级全量。
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	ensureManager,
	managerOk,
	xngStatus,
	stopManager,
	startWatch,
	stopWatch,
	type ManagerFacts,
} from "./launcher.ts";
import { createXngCheck } from "./xng-check.ts";
import { xngRepoDir } from "./xng-git.ts";
import type { ExecFn } from "./xng-git.ts";
import { xngExtraDir } from "./xng-py.ts";
import {
	resolveState,
	sameState,
	displayFor,
	type XngFacts,
	type XngState,
} from "./status.ts";

// UI 引用（底部组件）：从命令/事件 ctx 捕获，供渲染回调使用
let ui: ExtensionContext["ui"] | undefined;

// 状态行组件 key（独立一行，不与 footer 其他状态混排）
const STATUS_KEY = "searxng-server";

// —— 判断层状态（facts 单一信息源；filesOk 初始 true = 未知按正常，初始显示默认 offline）——
const facts: XngFacts = { managerAlive: false, xngOk: false, filesOk: true };
let lastState: XngState | null = null;
let prevManagerAlive = false; // offline 切换瞬间全量 probe 用
let sentinelBad = false; // 上次哨兵结果（变化才升级全量）
let fixing = false; // 修复运行中：抑制 tick 触发 probe（半成品勿判）
let probePromise: Promise<string[]> | null = null; // 进行中的全量 probe（并发去重）

// exec 适配器（pi.exec → ExecFn；default export 里赋值）
let exec: ExecFn;

// 渲染：状态变化（sameState）才 setStatus
function syncStatus(): void {
	const state = resolveState(facts);
	if (lastState && sameState(state, lastState)) return;
	lastState = state;
	const theme = ui?.theme;
	if (!theme) return;
	const d = displayFor(state);
	ui?.setStatus(STATUS_KEY, theme.fg(d.color, d.text));
}

// —— 判断层：文件事实（哨兵 + 全量 probe）——
// 哨兵：5 stat 纯元数据（零进程、零扫描、无网络），任一缺失 = 一定不达标
function sentinelOk(cacheDir?: string): boolean {
	const repoDir = xngRepoDir(cacheDir);
	return (
		existsSync(repoDir) &&
		existsSync(join(repoDir, ".git")) &&
		existsSync(join(repoDir, "requirements.txt")) &&
		existsSync(join(repoDir, ".venv", "Scripts", "python.exe")) &&
		existsSync(join(xngExtraDir(cacheDir), "pwd.py"))
	);
}

// 全量 probe：probeXng → 写回 filesOk；返回问题清单；并发复用同一 promise
function refreshFiles(): Promise<string[]> {
	if (probePromise) return probePromise;
	probePromise = (async () => {
		try {
			const check = createXngCheck(exec);
			const probe = await check.probeXng();
			facts.filesOk = probe.ok;
			sentinelBad = !sentinelOk();
			return probe.problems;
		} catch {
			facts.filesOk = false;
			return ["probe"];
		} finally {
			probePromise = null;
			syncStatus();
		}
	})();
	return probePromise;
}

// watch 事实回调：更新 facts → offline 过渡全量 probe → 哨兵（仅 offline）→ 渲染
async function onWatchFacts(f: ManagerFacts): Promise<void> {
	facts.managerAlive = f.managerAlive;
	facts.xngOk = f.xngOk;
	// offline 切换瞬间：全量 probe 一次（哨兵外的单文件损伤在此确认）
	if (!f.managerAlive && prevManagerAlive && !fixing) {
		prevManagerAlive = false;
		await refreshFiles();
	}
	prevManagerAlive = f.managerAlive;
	// 文件哨兵仅 offline 跑（服务存活时文件不参与）；哨兵变化才升级全量，未变不动
	if (!f.managerAlive && !fixing) {
		const nowBad = !sentinelOk();
		if (nowBad !== sentinelBad) {
			sentinelBad = nowBad;
			await refreshFiles();
		}
	}
	syncStatus();
}

// 启动：预判环境健康（不达标拒绝并告知，避免白等 manager 超时）；通过才拉起，意外错误走默认抛错
async function doStart(): Promise<void> {
	const problems = await refreshFiles();
	if (problems.length) {
		ui?.notify(
			`searxng-server: env not ready (${problems.join(", ")}), run fix first`,
			"error",
		);
		return;
	}
	await ensureManager();
	ui?.notify("searxng-server: start requested", "info");
}

// 停止：明确关闭指令 → manager 有序关闭；watch 探测到消失后自动断开
async function doStop(): Promise<void> {
	const ok = await stopManager();
	ui?.notify(
		ok ? "searxng-server: stopped" : "searxng-server: not running",
		"info",
	);
}

// 状态查询：新鲜事实（manager → xng → 文件）→ 状态 → 报告
async function doStatus(): Promise<void> {
	const alive = await managerOk();
	facts.managerAlive = alive;
	facts.xngOk = alive ? await xngStatus() : false;
	const problems = await refreshFiles();
	const d = displayFor(resolveState(facts));
	ui?.notify(
		problems.length ? `${d.text} (${problems.join(", ")})` : d.text,
		problems.length ? "error" : "info",
	);
}

// 修复：按仓库→文件→py 流程重建环境；分块容错（错误告知、跳过依赖块、不中断）；完成后复查
async function doFix(): Promise<void> {
	fixing = true;
	ui?.notify("searxng-server: fix started (repo -> files -> py)", "info");
	const check = createXngCheck(exec);
	let result;
	try {
		result = await check.repairXng();
	} catch (e) {
		ui?.notify(
			`searxng-server: fix failed: ${e instanceof Error ? e.message : String(e)}`,
			"error",
		);
		fixing = false;
		return;
	}
	for (const err of result.errors) {
		ui?.notify(`searxng-server: ${err}`, "error");
	}
	const done = result.actions.length
		? `actions: ${result.actions.join(", ")}`
		: "nothing to fix";
	const skipped = result.skipped.length
		? `; skipped: ${result.skipped.join(", ")}`
		: "";
	ui?.notify(
		`searxng-server: fix ${result.ok ? "done" : "incomplete"} (${done}${skipped}${result.errors.length ? `; errors: ${result.errors.length}` : ""})`,
		result.ok ? "info" : "error",
	);
	fixing = false;
	await refreshFiles();
}

export default function (pi: ExtensionAPI) {
	// pi.exec 适配成 ExecFn 形状（xng-check 需要 { stdout, stderr, code }）
	exec = ((cmd: string, args: string[], opts?: { timeout?: number }) =>
		pi.exec(cmd, args, { timeout: opts?.timeout })) as unknown as ExecFn;

	pi.registerCommand("searxng-server", {
		description: "xng service control: start | stop | status | fix",
		handler: async (args, ctx) => {
			ui = ctx.ui;
			const sub = (args || "").split(/\s+/)[0];
			if (sub === "start") await doStart();
			else if (sub === "stop") await doStop();
			else if (sub === "status") await doStatus();
			else if (sub === "fix") await doFix();
			else ui?.notify("usage: /searxng-server start|stop|status|fix", "info");
		},
	});

	// watch 常驻：manager 出现自动连上+心跳，消失自动断开；每 tick 回调事实（不自动启动 xng）
	pi.on("session_start", async (_event, ctx) => {
		ui = ctx.ui;
		startWatch((f) => {
			void onWatchFacts(f);
		});
		// 启动自检：初始默认 offline，全量 probe 一次后按实刷新
		void refreshFiles();
	});

	// 清理：停 watch（断连、心跳停 → pi 全关时 manager 倒计时自毁兜底）
	pi.on("session_shutdown", async () => {
		stopWatch();
		ui?.setStatus(STATUS_KEY, undefined);
	});
}
