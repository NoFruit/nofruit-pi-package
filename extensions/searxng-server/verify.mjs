// 定位：node 直跑验证脚本（非正式测试）。按段跑当前模块的原子功能，打印结果供人眼确认；
// 某步抛错会打印堆栈并以非零码退出。
// 跑法：node verify.mjs            全部段
//       node verify.mjs dep-parse  只跑指定段（可多个，空格分隔）
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDepText, diffDeps } from "./dep-parse.ts";
import { xngRepoDir, createXngGit } from "./xng-git.ts";
import { createXngPy } from "./xng-py.ts";
import { createXngCheck } from "./xng-check.ts";
import {
	launchManager,
	managerOk,
	ensureManager,
	sendHeartbeat,
	stopManager,
} from "./launcher.ts";

// exec 适配器：node 的 execFile（回调风格）转成 ExecFn 形状（Promise<{stdout, stderr, code}>）
const exec = (cmd, args, opts) =>
	new Promise((resolve) => {
		execFile(
			cmd,
			args,
			{ timeout: opts?.timeout, windowsHide: true },
			(err, stdout, stderr) => {
				resolve({
					stdout: String(stdout),
					stderr: String(stderr),
					code: err ? (err.code ?? 1) : 0,
				});
			},
		);
	});

const repo = xngRepoDir();
const pyExe = join(repo, ".venv", "Scripts", "python.exe");

// 段表：name -> 跑该段
const segments = {
	// dep-parse：真实 requirements.txt vs 真实 pip list
	"dep-parse": async () => {
		const reqText = readFileSync(join(repo, "requirements.txt"), "utf8");
		const pipRes = await exec(pyExe, ["-m", "pip", "list"]);
		const depsReq = parseDepText(reqText, "requirements");
		const depsInstalled = parseDepText(pipRes.stdout, "pip-list");
		const diff = diffDeps(depsReq, depsInstalled);
		console.log(
			"requirements parsed:",
			depsReq.length,
			"entries (sample:",
			JSON.stringify(depsReq[0]),
			")",
		);
		console.log(
			"pip list parsed:",
			depsInstalled.length,
			"entries (sample:",
			JSON.stringify(depsInstalled[0]),
			")",
		);
		console.log(
			"diff: onlyA",
			diff.onlyA.length,
			"/ onlyB",
			diff.onlyB,
			"/ both",
			diff.both.length,
		);
	},

	// xng-py：python 版本探测 + venv 创建（已存在则跳过）
	"xng-py": async () => {
		const py = createXngPy(exec);
		console.log("hasXngPy:", await py.hasXngPy());
		console.log("hasXngVenv:", await py.hasXngVenv());
		console.log("createVenv:", JSON.stringify(await py.createVenv()));
		console.log("hasXngDeps:", JSON.stringify(await py.hasXngDeps()));
		console.log("hasXngInstalled:", await py.hasXngInstalled());
		console.log("hasXngExtras:", JSON.stringify(await py.hasXngExtras()));
		console.log("installExtras:", await py.installExtras());
		console.log("hasXngExtras recheck:", JSON.stringify(await py.hasXngExtras()));
	},

	// install-deps：用 .venv 的 pip 装齐 requirements 依赖（网络写操作，默认清华镜像源）
	"install-deps": async () => {
		const py = createXngPy(exec);
		await py.installDeps();
		console.log(
			"installDeps done, recheck hasXngDeps:",
			JSON.stringify(await py.hasXngDeps()),
		);
	},

	// install-xng：editable 安装 xng 仓库自身（网络写操作，生成 searxng-run 命令）
	"install-xng": async () => {
		const py = createXngPy(exec);
		await py.installXng();
		const res = await exec(join(repo, ".venv", "Scripts", "python.exe"), [
			"-c",
			"import searx; print(searx.__file__)",
		]);
		console.log("import searx:", res.stdout.trim());
	},
	"xng-git": async () => {
		const xng = createXngGit(exec);
		console.log("hasXngGit:", await xng.hasXngGit());
		console.log("isXngClean:", await xng.isXngClean());
		console.log("hasXngSparse:", await xng.hasXngSparse());
		console.log("newerXngAvailable:", await xng.newerXngAvailable());
	},
	"self-check": async () => {
		const check = createXngCheck(exec);
		const r = await check.repairXng();
		if (r.errors.length) throw new Error(r.errors[0]);
		console.log("repairXng (strict):", JSON.stringify(r));
	},
	probe: async () => {
		const check = createXngCheck(exec);
		console.log("probeXng:", JSON.stringify(await check.probeXng()));
	},
	status: async () => {
		const { resolveState, sameState, displayFor } = await import("./status.ts");
		// 事实组合 → 期望状态（穷尽表）
		const cases = [
			[{ managerAlive: false, xngOk: false, filesOk: true }, "offline", "ok"],
			[{ managerAlive: false, xngOk: false, filesOk: false }, "offline", "bad"],
			[{ managerAlive: true, xngOk: false, filesOk: true }, "degraded", null],
			[{ managerAlive: true, xngOk: false, filesOk: false }, "degraded", null],
			[{ managerAlive: true, xngOk: true, filesOk: true }, "online", null],
			[{ managerAlive: true, xngOk: true, filesOk: false }, "online", null],
		];
		let failed = 0;
		for (const [f, wantKind, wantFiles] of cases) {
			const s = resolveState(f);
			const ok =
				s.kind === wantKind && (wantFiles === null || s.files === wantFiles);
			if (!ok) failed++;
			console.log(
				`${ok ? "PASS" : "FAIL"} ${JSON.stringify(f)} -> ${JSON.stringify(s)}${ok ? "" : ` (want ${wantKind}/${wantFiles})`}`,
			);
		}
		// sameState：离线子维度参与相等；主态忽略 files
		const eq = [
			[
				sameState(
					{ kind: "offline", files: "ok" },
					{ kind: "offline", files: "ok" },
				),
				true,
			],
			[
				sameState(
					{ kind: "offline", files: "ok" },
					{ kind: "offline", files: "bad" },
				),
				false,
			],
			[sameState({ kind: "online" }, { kind: "online" }), true],
			[sameState({ kind: "online" }, { kind: "degraded" }), false],
		];
		for (const [got, want] of eq) {
			if (got !== want) failed++;
			console.log(
				`${got === want ? "PASS" : "FAIL"} sameState -> ${got} (want ${want})`,
			);
		}
		console.log(
			"display:",
			JSON.stringify(
				["online", "degraded", "files-error", "offline"].map((k) => {
					const st =
						k === "files-error"
							? { kind: "offline", files: "bad" }
							: k === "offline"
								? { kind: "offline", files: "ok" }
								: { kind: k };
					return displayFor(st);
				}),
			),
		);
		if (failed) process.exit(1);
	},
	fix: async () => {
		const check = createXngCheck(exec);
		console.log("repairXng:", JSON.stringify(await check.repairXng()));
	},
	manager: async () => {
		// 探针：xng healthz（判别，任何失败 false）
		const up = async () => {
			try {
				const res = await fetch("http://127.0.0.1:8888/healthz", {
					signal: AbortSignal.timeout(2000),
				});
				return res.status === 200;
			} catch {
				return false;
			}
		};
		// 探针：进程存在性（tasklist 查 PID）
		const alive = (pid) =>
			new Promise((resolve) => {
				execFile(
					"tasklist",
					["/FI", `PID eq ${pid}`],
					{ windowsHide: true },
					(e, so) => resolve(so.includes("node.exe")),
				);
			});
		if (await up()) throw new Error("port 8888 busy, clean up first");
		// a：manager 启动即拉起 xng（TTL 15s 覆盖 xng 冷启动 5-8s）
		const child = launchManager(15);
		console.log("manager pid:", child.pid);
		// c：倒计时内 xng 保持可访问
		let reachable = false;
		for (let i = 0; i < 12; i++) {
			await new Promise((r) => setTimeout(r, 1000));
			if (await up()) {
				reachable = true;
				break;
			}
		}
		console.log("xng reachable within ttl (healthz 200):", reachable);
		// b：超过倒计时，manager 自毁
		for (let i = 0; i < 20; i++) {
			await new Promise((r) => setTimeout(r, 1000));
			if (!(await alive(child.pid))) break;
		}
		console.log("manager self-destructed after ttl:", !(await alive(child.pid)));
		// b'：自毁前 manager 关闭了 xng
		await new Promise((r) => setTimeout(r, 1500));
		console.log("xng down with manager (healthz unreachable):", !(await up()));
	},
	"manager-flock": async () => {
		const TTL = 30; // 自毁 30s
		const HB = 20000; // 心跳 20s（与 40/60 成比例的 2/3）
		const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
		const xngUp = async () => {
			try {
				const r = await fetch("http://127.0.0.1:8888/healthz", {
					signal: AbortSignal.timeout(2000),
				});
				return r.status === 200;
			} catch {
				return false;
			}
		};
		// 模拟工具注入（后续 adaptor）：manager 正常 + xng 正常 → 才给 xng 地址
		const inject = async () => {
			if (!(await managerOk())) return undefined;
			if (!(await xngUp())) return undefined;
			return "http://127.0.0.1:8888";
		};
		// 搜索函数：拿到注入地址才向 xng 请求搜索
		const search = async (q) => {
			const addr = await inject();
			if (!addr) return { injected: false, status: 0 };
			const r = await fetch(`${addr}/search?q=${encodeURIComponent(q)}`, {
				signal: AbortSignal.timeout(30000),
			});
			const text = await r.text();
			return { injected: true, status: r.status, bytes: text.length };
		};
		if (await managerOk()) throw new Error("leftover manager, clean up first");
		// 三实例同时启动 manager（单例仲裁：一个 listen 成功，其余让位）
		const [c1, c2, c3] = await Promise.all([
			ensureManager(TTL),
			ensureManager(TTL),
			ensureManager(TTL),
		]);
		console.log(
			"3 concurrent ensureManager: all got refs (singleton arbitration)",
		);
		// 第一次搜索：manager 刚启动，xng 大概率未就绪（注入未发生 → 搜索工具走别的）
		console.log(
			"first search (just started):",
			JSON.stringify(await search("nofruit test one")),
		);
		// 等 xng 就绪
		let up = false;
		for (let i = 0; i < 15; i++) {
			await sleep(1000);
			if (await xngUp()) {
				up = true;
				break;
			}
		}
		console.log("xng ready (healthz 200):", up);
		// 第二次搜索：应注入成功并真实搜索
		console.log(
			"second search (ready):",
			JSON.stringify(await search("nofruit test two")),
		);
		// 发信器：三连接心跳持续，观察超过 TTL 不自毁
		const hb = setInterval(() => {
			sendHeartbeat(c1);
			sendHeartbeat(c2);
			sendHeartbeat(c3);
		}, HB);
		await sleep(35000);
		console.log("heartbeats 35s (> ttl 30s), manager alive:", await managerOk());
		// 销毁所有 launch：心跳停止 → 倒计时耗尽 → 自动自毁
		clearInterval(hb);
		c1.destroy();
		c2.destroy();
		c3.destroy();
		console.log("all launches destroyed (heartbeat stopped)");
		await sleep(35000);
		console.log("manager self-destructed after 35s:", !(await managerOk()));
		console.log("xng down with manager:", !(await xngUp()));
	},
	"manager-guard": async () => {
		const { execFile } = await import("node:child_process");
		const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
		// 观察手段：HTTP 直探 xng（零 pipe 信号）；进程存在性用 tasklist
		const up = async () => {
			try {
				const r = await fetch("http://127.0.0.1:8888/healthz", {
					signal: AbortSignal.timeout(2000),
				});
				return r.status === 200;
			} catch {
				return false;
			}
		};
		const findXngPid = () =>
			new Promise((resolve) => {
				execFile("netstat", ["-ano"], { windowsHide: true }, (e, so) => {
					const m = (so || "").match(/:8888\s.*LISTENING\s+(\d+)/);
					resolve(m ? m[1] : null);
				});
			});
		const killPid = (pid) =>
			new Promise((resolve) => {
				execFile(
					"taskkill",
					["/F", "/PID", String(pid)],
					{ windowsHide: true },
					() => resolve(),
				);
			});
		if (await up()) throw new Error("port 8888 has a service, clean up first");
		// 准备：拉起 manager（正确运行前提）
		await ensureManager(60);
		let ready = false;
		for (let i = 0; i < 15; i++) {
			await sleep(1000);
			if (await up()) {
				ready = true;
				break;
			}
		}
		console.log("1. xng ready:", ready);
		const oldPid = await findXngPid();
		console.log("2. old xng pid:", oldPid);
		// 砍 xng（外部杀掉）
		await killPid(oldPid);
		console.log("3. xng killed externally, zero intervention from now");
		// 零干预观察：等 manager 守护自动复活
		let revived = false;
		let newPid = null;
		for (let i = 0; i < 20; i++) {
			await sleep(1000);
			if (await up()) {
				revived = true;
				newPid = await findXngPid();
				break;
			}
		}
		console.log(
			"4. manager revived xng:",
			revived,
			"| new pid:",
			newPid,
			"| differs:",
			newPid !== oldPid,
		);
		// 清理：stop 命令走 stopManager（测试收尾允许）
		await stopManager();
		await sleep(1000);
		console.log("5. cleaned up, 8888 free:", !(await up()));
	},
};

const names = process.argv.slice(2);
const targets = names.length ? names : Object.keys(segments);
for (const name of targets) {
	if (!segments[name]) {
		console.error(
			"unknown segment:",
			name,
			"(available:",
			Object.keys(segments).join(", "),
			")",
		);
		process.exit(1);
	}
	console.log("---", name, "---");
	await segments[name]();
}
console.log("all OK");
