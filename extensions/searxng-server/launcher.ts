// 定位：manager 接生者 + 生命周期感知——探测/启动 manager，自动连接与心跳维持，转发查询/关闭指令。
// 状态收口：xng 状态只问 manager（它是 xng 进程引用的唯一持有者），不直接探测 xng。
// 同步信息 = pipe：manager 在 = 可连（探测获知），关 = 连接断（close 获知）；地址固定，无额外状态。
// 启动权只在 start 命令（ensureManager）；watch 不 spawn——manager 出现自动连上，消失自动断开。
// 启动判断：pipe 可连 = manager 已存在；连不上 → spawn（竞态由 pipe 独占仲裁：谁 listen 成功谁活，
// 让位者自动退出，无"正在启动"状态需要区分）→ 轮询等就位（自己或别人的 manager 都算）。
// 对外接口：
//   launchManager(ttlSeconds?) -> ChildProcess   spawn manager 进程（detached 独立存活）
//   managerOk() -> Promise<boolean>  判别：pipe 可连 = manager 正常；任何失败 false
//   xngStatus() -> Promise<boolean>  判别：问 manager（"status"）→ xng 是否正常；连不上/无响应/非 ok 一律 false
//   ensureManager(ttlSeconds?) -> Promise<Socket>  不存在则 spawn 并等就位；返回连接（引用）；超时抛错
//   sendHeartbeat(conn) -> void  心跳（"ping"，刷新 manager 倒计时）；连接已断则跳过
//   stopManager() -> Promise<boolean>  临时连接发关闭指令（无论本进程是否持有连接）；连不上返回 false
//   startWatch(onState) -> void  开始周期感知（幂等）：manager 出现自动连上+心跳，消失自动断开；状态回调
//   stopWatch() -> void  停止感知、断开连接（心跳停 → pi 全关时 manager 倒计时自毁）

import { spawn, type ChildProcess } from "node:child_process";
import { connect, type Socket } from "node:net";
import { fileURLToPath } from "node:url";

// manager 脚本路径（与 launcher 同目录）
const MANAGER_PATH = fileURLToPath(new URL("./manager.ts", import.meta.url));
// 与 manager.ts 保持一致（一处改动需同步）
const PIPE_NAME = "\\\\.\\pipe\\xng-manager";
// 心跳周期：manager 自毁 60s 的 2/3（冗余 1.5 倍）；丢 1 次心跳会提前自毁，
// 由 ensureManager 幂等拉起兜底（要容 1 次丢失需 < 30000）
export const HEARTBEAT_INTERVAL_MS = 40000;
export function launchManager(ttlSeconds?: number): ChildProcess {
	const args =
		ttlSeconds === undefined
			? [MANAGER_PATH]
			: [MANAGER_PATH, String(ttlSeconds)];
	const child = spawn(process.execPath, args, {
		detached: true,
		stdio: "ignore",
		windowsHide: true,
	});
	child.unref();
	return child;
}

// 判别：pipe 可连 = manager 正常；连接失败/超时一律 false
export function managerOk(timeoutMs = 2000): Promise<boolean> {
	return new Promise((resolve) => {
		const sock = connect(PIPE_NAME);
		let done = false;
		const finish = (ok: boolean) => {
			if (done) return;
			done = true;
			sock.destroy();
			resolve(ok);
		};
		sock.once("connect", () => finish(true));
		sock.once("error", () => finish(false));
		sock.setTimeout(timeoutMs, () => finish(false));
	});
}


// 判别：问 manager（"status"）→ xng 是否正常；连不上/超时/回写非 xng:ok 一律 false
export function xngStatus(timeoutMs = 5000): Promise<boolean> {
	return new Promise((resolve) => {
		const sock = connect(PIPE_NAME);
		let done = false;
		const finish = (ok: boolean) => {
			if (done) return;
			done = true;
			sock.destroy();
			resolve(ok);
		};
		sock.once("connect", () => sock.write("status"));
		sock.on("data", (chunk) => finish(chunk.toString().trim() === "xng:ok"));
		sock.once("error", () => finish(false));
		sock.setTimeout(timeoutMs, () => finish(false));
	});
}
// 确保 manager 存在：试连 pipe；连不上 → spawn（只 spawn 一次）→ 轮询等就位；
// 连接成功 = 拿到 manager 引用（无论自己还是别人 spawn 的）；超过时限抛错
export function ensureManager(
	ttlSeconds?: number,
	timeoutMs = 10000,
): Promise<Socket> {
	return new Promise((resolve, reject) => {
		let spawned = false;
		let timer: NodeJS.Timeout | undefined;
		const tryConnect = () => {
			const sock = connect(PIPE_NAME);
			sock.once("connect", () => {
				if (timer) clearTimeout(timer);
				resolve(sock);
			});
			sock.once("error", () => {
				sock.destroy();
				if (!spawned) {
					spawned = true;
					launchManager(ttlSeconds);
				}
				setTimeout(tryConnect, 500);
			});
		};
		timer = setTimeout(() => reject(new Error("manager 就位超时")), timeoutMs);
		tryConnect();
	});
}

// 心跳：写 "ping"（manager 收到即刷新倒计时）；连接已断则跳过（防 EPIPE 崩溃）
export function sendHeartbeat(conn: Socket): void {
	if (conn.destroyed) return;
	conn.write("ping");
}

// 立即关闭：临时连接发 "stop"（无论本进程是否持有连接）；连不上/超时返回 false
export function stopManager(timeoutMs = 3000): Promise<boolean> {
	return new Promise((resolve) => {
		const sock = connect(PIPE_NAME);
		let done = false;
		const finish = (ok: boolean) => {
			if (done) return;
			done = true;
			sock.destroy();
			resolve(ok);
		};
		sock.once("connect", () => {
			sock.write("stop");
			setTimeout(() => finish(true), 300);
		});
		sock.once("error", () => finish(false));
		sock.setTimeout(timeoutMs, () => finish(false));
	});
}

// —— manager 连接管理（watch）——

// watch 回调产出的事实：manager 单例存活 + xng 是否正常（状态机层合成唯一状态）
export interface ManagerFacts {
	managerAlive: boolean;
	xngOk: boolean;
}

let managerConn: Socket | null = null;
let watchTimer: ReturnType<typeof setInterval> | undefined;
let lastHeartbeatAt = 0;
let onFacts: ((f: ManagerFacts) => void) | undefined;
let tickBusy = false;

// 纯连接（不 spawn）：pipe 可连则返回连接，否则 null
function tryConnect(timeoutMs = 2000): Promise<Socket | null> {
	return new Promise((resolve) => {
		const sock = connect(PIPE_NAME);
		sock.once("connect", () => resolve(sock));
		sock.once("error", () => {
			sock.destroy();
			resolve(null);
		});
		sock.setTimeout(timeoutMs, () => {
			sock.destroy();
			resolve(null);
		});
	});
}

// 周期 tick：探测 manager → 自动连接/断开 → 问 xng → 回调事实 → 到周期发心跳
async function watchTick(): Promise<void> {
	if (tickBusy) return;
	tickBusy = true;
	try {
		if (!(await managerOk())) {
			if (managerConn) {
				managerConn.destroy();
				managerConn = null;
			}
			onFacts?.({ managerAlive: false, xngOk: false });
			return;
		}
		if (!managerConn || managerConn.destroyed) {
			managerConn = await tryConnect();
			lastHeartbeatAt = 0;
		}
		const xOk = await xngStatus();
		onFacts?.({ managerAlive: true, xngOk: xOk });
		if (managerConn && Date.now() - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
			sendHeartbeat(managerConn);
			lastHeartbeatAt = Date.now();
		}
	} finally {
		tickBusy = false;
	}
}

// 开始周期感知（幂等）：manager 出现自动连上并心跳，消失自动断开；不 spawn（启动权在 start 命令）。
// 每 tick 回调事实（managerAlive/xngOk）；立即跑首个 tick。
export function startWatch(onFactsChange: (f: ManagerFacts) => void, intervalMs = 5000): void {
	onFacts = onFactsChange;
	if (watchTimer) return;
	void watchTick();
	watchTimer = setInterval(watchTick, intervalMs);
}

// 停止感知、断开连接（心跳停 → pi 全关时 manager 倒计时自毁）
export function stopWatch(): void {
	if (watchTimer) {
		clearInterval(watchTimer);
		watchTimer = undefined;
	}
	if (managerConn) {
		managerConn.destroy();
		managerConn = null;
	}
	onFacts = undefined;
}
