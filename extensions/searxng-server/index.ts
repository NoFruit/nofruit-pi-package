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
	type ManagerWatchState,
} from "./launcher.ts";

// UI 引用（底部组件）：从命令/事件 ctx 捕获，供 watch 回调使用
let ui: ExtensionContext["ui"] | undefined;

// 状态行组件 key（独立一行，不与 footer 其他状态混排）
const STATUS_KEY = "searxng-server";

// 状态文本（英文纯文本，命令输出用）：标题大写 + 空格分隔（组件自身显示文本，标题写在文本里）
function statusTextFor(state: ManagerWatchState): string {
	if (state === "online") return "SEARXNG-SERVER online";
	if (state === "degraded") return "SEARXNG-SERVER degraded (xng not ready)";
	return "SEARXNG-SERVER offline (manager not running)";
}

// 状态行（组件用，着色）：online 绿（success）、offline/degraded 灰（dim，与其他 footer 一致）
function statusLineFor(
	state: ManagerWatchState,
	theme: ExtensionContext["ui"]["theme"],
): string {
	if (state === "online") return theme.fg("success", statusTextFor(state));
	return theme.fg("dim", statusTextFor(state));
}

// 启动：manager 不存在则拉起（存在则连上）；连接/心跳由 watch 自动接管
async function doStart(): Promise<void> {
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

// 状态查询：即时探活结果
async function doStatus(): Promise<void> {
	if (!(await managerOk())) {
		ui?.notify(statusTextFor("offline"), "info");
		return;
	}
	ui?.notify(
		statusTextFor((await xngStatus()) ? "online" : "degraded"),
		"info",
	);
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("searxng-server", {
		description: "xng service control: start | stop | status",
		handler: async (args, ctx) => {
			ui = ctx.ui;
			const sub = (args || "").split(/\s+/)[0];
			if (sub === "start") await doStart();
			else if (sub === "stop") await doStop();
			else if (sub === "status") await doStatus();
			else ui?.notify("usage: /searxng-server start|stop|status", "info");
		},
	});

	// watch 常驻：manager 出现自动连上+心跳，消失自动断开；状态条实时反映（不自动启动 xng）
	pi.on("session_start", async (_event, ctx) => {
		ui = ctx.ui;
		startWatch((state) => {
			const theme = ui?.theme;
			if (theme) ui?.setStatus(STATUS_KEY, statusLineFor(state, theme));
		});
	});

	// 清理：停 watch（断连、心跳停 → pi 全关时 manager 倒计时自毁兜底）
	pi.on("session_shutdown", async () => {
		stopWatch();
		ui?.setStatus(STATUS_KEY, undefined);
	});
}
