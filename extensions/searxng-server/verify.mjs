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
			"requirements 解析:",
			depsReq.length,
			"条（样例:",
			JSON.stringify(depsReq[0]),
			"）",
		);
		console.log(
			"pip list 解析:",
			depsInstalled.length,
			"条（样例:",
			JSON.stringify(depsInstalled[0]),
			"）",
		);
		console.log(
			"diff: onlyA",
			diff.onlyA.length,
			"条 / onlyB",
			diff.onlyB,
			"/ both",
			diff.both.length,
			"条",
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
		console.log("hasXngExtras 复查:", JSON.stringify(await py.hasXngExtras()));
	},

	// install-deps：用 .venv 的 pip 装齐 requirements 依赖（网络写操作，默认清华镜像源）
	"install-deps": async () => {
		const py = createXngPy(exec);
		await py.installDeps();
		console.log("installDeps 完成，复查 hasXngDeps:", JSON.stringify(await py.hasXngDeps()));
	},

	// install-xng：editable 安装 xng 仓库自身（网络写操作，生成 searxng-run 命令）
	"install-xng": async () => {
		const py = createXngPy(exec);
		await py.installXng();
		const res = await exec(join(repo, ".venv", "Scripts", "python.exe"), ["-c", "import searx; print(searx.__file__)"]);
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
		console.log("selfCheckXng:", JSON.stringify(await check.selfCheckXng()));
	},
};

const names = process.argv.slice(2);
const targets = names.length ? names : Object.keys(segments);
for (const name of targets) {
	if (!segments[name]) {
		console.error(
			"未知段:",
			name,
			"（可用:",
			Object.keys(segments).join(", "),
			"）",
		);
		process.exit(1);
	}
	console.log("---", name, "---");
	await segments[name]();
}
console.log("全部 OK");
