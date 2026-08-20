// 定位：manager 进程本体——单例 + 倒计时主体 + xng 生命周期（拉起/守护/关闭）：
// 启动即建 named pipe（单例锁 + 心跳通道），listen 成功 = 我是单例 → 拉起 xng；
// 周期探活 xng，消失（外部杀掉/崩溃）→ 直接重启（守护，只归 manager 负责）；
// 任何心跳数据刷新倒计时，耗尽 → 关闭 xng → 自毁退出。
// 用法：node manager.ts [秒数]——秒数缺省用 DEFAULT_TTL_SECONDS。

import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { openSync, writeFileSync, appendFileSync } from "node:fs";
import { createServer, connect } from "node:net";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { xngRepoDir } from "./xng-git.ts";
import { xngExtraDir } from "./xng-py.ts";

// 单例锁 + 心跳通道（Windows named pipe；谁先 listen 谁活，第二个 EADDRINUSE 让位）。
// PIPE_NAME 与 launcher.ts 保持一致（一处改动需同步）
const PIPE_NAME = "\\\\.\\pipe\\xng-manager";
// xng 服务监听端口（搜索工具统一契约；SEARXNG_PORT 环境变量可覆盖）
const XNG_PORT = Number(process.env.SEARXNG_PORT ?? 8888);
// 倒计时检查周期
const CHECK_INTERVAL_MS = 1000;
// xng 守护探活周期（探出消失后快速重启）
const XNG_WATCH_INTERVAL_MS = 5000;

// xng 启动日志：<cacheDir>/searxng-server/xng.log（追加；排查启动失败用）
const xngLogPath = (repoDir: string) => join(repoDir, "..", "xng.log");

// xng 覆盖设置：启动时顺手写运行时文件（与 xng.log 同级）并注入 SEARXNG_SETTINGS_PATH。
// 字段维护为 const（暂无独立 yml）：当前 search.formats 开 json（pi-web-access 固定 format=json）+ 引擎出网代理。
// 代理地址单源（settings 注入与可用性探测共用）；httpx 挂载语法 all:// 匹配 http/https。
// 关键语义：settings_loader 文件模式默认整体替换（不带 use_default_settings: true 会丢全部默认键），
// 必须带 use_default_settings: true 才与默认 settings.yml 合并；合并时列表/标量整体替换 → formats 必须列全。
const PROXY_HOST = "127.0.0.1";
const PROXY_PORT = 7890;
const SETTINGS_OVERRIDE_YAML = `use_default_settings: true
search:
  formats:
    - html
    - json
outgoing:
  proxies:
    all://:
      - http://${PROXY_HOST}:${PROXY_PORT}
`;

// 启动 xng（.venv python -m searx.webapp；env 注入 SEARXNG_SECRET + PYTHONPATH=附加模块目录；cwd=仓库）；
// 返回 xng 进程引用（持有者即唯一管理者）；spawn 失败抛错。前置假设：调用方是单例（xng 唯一性由 manager 唯一性保证）
function startXng(cacheDir?: string): ChildProcess {
	const repoDir = xngRepoDir(cacheDir);
	// 顺手写覆盖设置（const 字段级；与 xng.log 同级运行时文件）供 SEARXNG_SETTINGS_PATH 注入合并
	const settingsRuntimePath = join(repoDir, "..", "settings.yml");
	writeFileSync(settingsRuntimePath, SETTINGS_OVERRIDE_YAML);
	const logFd = openSync(xngLogPath(repoDir), "a");
	const child = spawn(
		join(repoDir, ".venv", "Scripts", "python.exe"),
		["-m", "searx.webapp"],
		{
			cwd: repoDir,
			windowsHide: true,
			env: {
				...process.env,
				SEARXNG_SECRET: randomBytes(32).toString("hex"),
				// 覆盖设置注入（const 运行时文件，与默认 settings.yml 合并）
				SEARXNG_SETTINGS_PATH: settingsRuntimePath,
				// pwd 桩等 file 类附加模块经 PYTHONPATH 进程级注入（追加原值防覆盖）
				PYTHONPATH: [xngExtraDir(cacheDir), process.env.PYTHONPATH]
					.filter(Boolean)
					.join(";"),
			},
			stdio: ["ignore", logFd, logFd],
		},
	);
	if (child.pid === undefined) {
		throw new Error("xng spawn failed: no pid");
	}
	return child;
}

// 停止 xng：taskkill /F /PID 强制结束；进程不存在或失败抛错（带 stderr）
function stopXng(pid: number): void {
	execFileSync("taskkill", ["/F", "/PID", String(pid)], { windowsHide: true });
}

// 探活：xng healthz 返回 200 视为正常；不可达/超时/非 200 一律 false
async function xngOk(cacheDir?: string): Promise<boolean> {
	try {
		const res = await fetch(`http://127.0.0.1:${XNG_PORT}/healthz`, {
			signal: AbortSignal.timeout(3000),
		});
		return res.status === 200;
	} catch {
		return false;
	}
}

// 独立小功能：启动时快速探测系统代理可用性（本地 TCP 短超时，不阻塞 xng 启动）；
// 不可达 → xng.log 追加提示行（manager stdio 被 ignore，console 无处可见，只能落文件）
function proxyOk(timeoutMs = 1000): Promise<boolean> {
	return new Promise((resolve) => {
		const sock = connect({ host: PROXY_HOST, port: PROXY_PORT });
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
async function noteProxyIfDown(repoDir: string): Promise<void> {
	if (await proxyOk()) return;
	appendFileSync(
		xngLogPath(repoDir),
		`[manager] proxy ${PROXY_HOST}:${PROXY_PORT} unreachable, remember to turn it on (engines will fail)\n`,
	);
}
const DEFAULT_TTL_SECONDS = 60;

const ttlSeconds = Number(process.argv[2] ?? DEFAULT_TTL_SECONDS);
const ttlMs = ttlSeconds * 1000;
// xng 进程引用（持有者即唯一管理者；探活/关闭都经它）
let xngChild: ChildProcess | undefined;
// 最后心跳时刻（单线程事件循环，读写无竞态；初始 = 启动时刻，无心跳也到期自毁）
let lastHeartbeat = Date.now();

// 自毁：关闭 xng（失败 exit 1 不掩盖）→ 退出 → pipe 内核自动释放
// 守护重启：旧 xng 进程还活着则先 taskkill（防新实例绑定端口冲突），再拉起新实例。
// 失败如实抛错（由守护 tick 捕获记录，不杀 manager 自身）
function restartXng(): ChildProcess {
	if (xngChild !== undefined && xngChild.exitCode === null) {
		stopXng(xngChild.pid!);
		console.log(`[manager] xng ${xngChild.pid} stopped by guard`);
	}
	xngChild = startXng();
	console.log(`[manager] xng ${xngChild.pid} restarted by guard`);
	return xngChild;
}

// 自毁：关闭 xng（进程已死则跳过；失败 exit 1 不掩盖）→ 退出 → pipe 内核自动释放
function shutdown(): void {
	if (xngChild !== undefined && xngChild.exitCode === null) {
		try {
			stopXng(xngChild.pid!);
			console.log(`[manager] xng ${xngChild.pid} closed`);
		} catch (e) {
			console.error(
				`[manager] failed to stop xng: ${e instanceof Error ? e.message : String(e)}`,
			);
			process.exit(1);
		}
	}
	console.log(`[manager] pid=${process.pid} ttl expired, self-destruct`);
	process.exit(0);
}

const server = createServer((socket) => {
	// 协议：收到 "stop" 走有序关闭；"status" 回写 xng 健康（xng:ok / xng:down）；
	// 其余任何数据视为心跳刷新倒计时
	socket.on("data", (chunk) => {
		const msg = chunk.toString().trim();
		if (msg === "stop") {
			shutdown();
		} else if (msg === "status") {
			xngOk().then((ok) => socket.write(ok ? "xng:ok" : "xng:down"));
		} else {
			lastHeartbeat = Date.now();
		}
	});
});

server.on("error", (e) => {
	if ((e as NodeJS.ErrnoException).code === "EADDRINUSE") {
		// 已有 manager 占住 pipe：让位退出（不启动 xng，不碰任何进程）
		console.log(`[manager] another manager holds ${PIPE_NAME}, yielding`);
		process.exit(0);
	}
	throw e;
});

// listen 成功 = 我是单例：拉起 xng（持有进程引用）+ 启动倒计时检查
server.listen(PIPE_NAME, () => {
	xngChild = startXng();
	// 独立探测：代理不可达 → 追加提示到 xng.log（异步，不阻塞 xng 启动）
	void noteProxyIfDown(xngRepoDir());
	console.log(
		`[manager] pid=${process.pid} xng=${xngChild.pid} singleton up, ttl ${ttlSeconds}s`,
	);
	// 倒计时检查
	setInterval(() => {
		if (Date.now() - lastHeartbeat >= ttlMs) {
			shutdown();
		}
	}, CHECK_INTERVAL_MS);
	// 守护：周期探活 xng，消失 → 直接重启（失败记录，不杀 manager 自身）
	setInterval(async () => {
		try {
			if (!(await xngOk())) {
				restartXng();
			}
		} catch (e) {
			console.error(
				`[manager] guard restart failed: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
	}, XNG_WATCH_INTERVAL_MS);
});
