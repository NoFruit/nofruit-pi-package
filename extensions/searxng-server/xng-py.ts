// 定位：判断本机默认 python 环境是否符合 xng（searxng）的版本要求，在 xng 仓库创建虚拟环境，
// 并判别 .venv 是否装齐 requirements.txt 声明的全部依赖、xng 本体是否装入，以及附加模块
// （配置 XNG_EXTRA_MODULES：pip 类如 tzdata、file 类如 pwd 桩）是否齐全。
// 版本要求与上游 setup.py 的 python_requires（>=3.10）同步维护，随 xng 版本升级而调整。
// 默认环境指 PATH 中的 python 命令（不尝试 python3）。
//
// 对外接口：createXngPy(exec) 返回基础积木；exec 形如 pi.exec：
//   exec(cmd, args, opts?) -> Promise<{ stdout, stderr, code }>
//   hasXngPy() -> Promise<boolean> 本机默认 python 版本是否 >= xng 要求；命令缺失/版本解析失败/低于要求一律 false
//   createVenv(cacheDir?) -> Promise<string> 在 xng 仓库创建 .venv（python -m venv）；已存在跳过；失败抛错
//   hasXngDeps(cacheDir?) -> Promise<{ complete, missing }> .venv 是否装齐 requirements 全部依赖；
//     前置假设 venv 已建、仓库健康；requirements 缺失/venv 缺失/命令失败一律抛错
//   installDeps(cacheDir?, indexUrl?) -> Promise<void> 用 .venv 的 pip 按 requirements.txt 装齐依赖
//     （pip 幂等：已满足的自动跳过）；indexUrl 未传/为空 → 用 XNG_PIP_INDEX（默认清华镜像），
//     XNG_PIP_INDEX 置空 → 不加 --index-url 走 pip 默认官方源；前置假设 venv 已建、仓库健康；失败抛错
//   installXng(cacheDir?) -> Promise<void> 用 .venv 的 pip editable 安装 xng 仓库自身
//     （生成 searxng-run 命令）；下载源固定 XNG_PIP_INDEX（置空则 pip 默认官方源）；
//     前置假设 venv 已建、依赖已装、仓库健康；失败抛错
//   hasXngInstalled(cacheDir?) -> Promise<boolean> searxng 本体是否已装入 .venv（pip list 出现
//     searxng 包）；前置假设 venv 已建、仓库健康；pip list 失败抛错
//   hasXngVenv(cacheDir?) -> Promise<boolean> .venv 是否已创建（目录存在）；前置假设仓库健康
//   hasXngExtras(cacheDir?) -> Promise<{ complete, missing }> 附加模块（配置 XNG_EXTRA_MODULES）是否齐全：
//     pip 类看 venv pip list、file 类看 extra-modules 目录清单；前置假设 venv 已建、仓库健康；pip list 失败抛错
//   installExtras(cacheDir?) -> Promise<void> 按配置逐项安装附加模块（pip 类 pip install、file 类从资产
//     模板拷贝）；幂等（pip 已装跳过、file 覆盖拷贝）；下载源固定 XNG_PIP_INDEX（置空则 pip 默认）；失败抛错

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExecFn, ExecResult } from "./xng-git.ts";
import { xngRepoDir } from "./xng-git.ts";
import { parseDepText, diffDeps, type DepRecord } from "./dep-parse.ts";
// xng 要求的最低 Python 版本（setup.py python_requires=">=3.10"）
const XNG_PY_MIN_MAJOR = 3;
const XNG_PY_MIN_MINOR = 10;
// pip 下载源：默认清华镜像（本机直连官方源不稳定）；置空则用 pip 默认官方源
export const XNG_PIP_INDEX = "https://pypi.tuna.tsinghua.edu.cn/simple";
// 附加模块目录（file 类落点，相对 xng 仓库，落在 cache 内）：<cacheDir>/searxng-server/extra-modules
// （仓库外独立目录，venv 重建不影响；部署时经 PYTHONPATH 注入供 python import）
const XNG_EXTRA_REL = join("..", "extra-modules");

// 附加模块配置：部署附加物（非 requirements、非 xng 本体）
//   kind "pip"：从 pip 装进 venv（判别=venv pip list 含 name；修复=pip install name）
//   kind "file"：从扩展资产模板拷贝到 extra-modules 目录（判别=目录文件名清单含 name；修复=拷贝）
const XNG_EXTRA_MODULES = [
	{ name: "tzdata", kind: "pip" },
	{ name: "pwd.py", kind: "file", template: "pwd-stub.py" },
];

// 部署资产目录（扩展自带文件，如附加模块模板）
const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), "assets");

// pip 下载源参数：indexUrl 未传/为空 → 用 XNG_PIP_INDEX；XNG_PIP_INDEX 也为空 → 不加 --index-url（pip 默认官方源）
function pipIndexArgs(indexUrl?: string): string[] {
	const index = indexUrl || XNG_PIP_INDEX;
	return index ? ["--index-url", index] : [];
}
export function createXngPy(exec: ExecFn) {
	return { hasXngPy, createVenv, hasXngDeps, installDeps, installXng, hasXngInstalled, hasXngVenv, hasXngExtras, installExtras };

	// 判断：本机默认 python 是否符合 xng 版本要求；python 探测失败/不符合一律 false（不尝试 python3）
	async function hasXngPy(): Promise<boolean> {
		const ver = await probePythonVersion();
		if (!ver) return false;
		const [major, minor] = ver;
		return (
			major > XNG_PY_MIN_MAJOR ||
			(major === XNG_PY_MIN_MAJOR && minor >= XNG_PY_MIN_MINOR)
		);
	}

	// 探测：python --version 解析主次版本；失败返回 null
	async function probePythonVersion(): Promise<[number, number] | null> {
		let res: ExecResult;
		try {
			res = await exec("python", ["--version"], { timeout: 10000 });
		} catch {
			res = { stdout: "", stderr: "", code: 1 };
		}
		return parseVersion(res);
	}

	// 解析 --version 输出（Python X.Y...），主次版本；解析失败返回 null
	function parseVersion(res: ExecResult): [number, number] | null {
		const m = /Python (\d+)\.(\d+)/.exec(res.stdout + " " + res.stderr);
		return m ? [Number(m[1]), Number(m[2])] : null;
	}

	// 创建虚拟环境：python -m venv .venv（前置假设：python 健康、仓库健康）；已存在跳过；失败抛错
	async function createVenv(cacheDir?: string): Promise<string> {
		const repoDir = xngRepoDir(cacheDir);
		if (existsSync(join(repoDir, ".venv"))) {
			return repoDir;
		}
		await runPy(["-m", "venv", join(repoDir, ".venv")], "venv");
		return repoDir;
	}

	// python 失败即抛错（带 stderr），原子功能专用
	async function runPy(args: string[], what: string): Promise<void> {
		const res = await exec("python", args, { timeout: 120000 });
		if (res.code !== 0) {
			throw new Error(
				`python ${what} failed (exit ${res.code}): ${res.stderr || res.stdout}`,
			);
		}
	}

	// 判别：.venv 是否装齐 requirements.txt 声明的全部依赖（前置假设：venv 已建、仓库健康）。
	// requirements 缺失/读取失败、venv 缺失、pip list 失败一律抛错；返回完整度 + 缺失清单（规范化包名）
	async function hasXngDeps(cacheDir?: string): Promise<{ complete: boolean; missing: string[] }> {
		const repoDir = xngRepoDir(cacheDir);
		const reqText = readFileSync(join(repoDir, "requirements.txt"), "utf8");
		const depsReq = parseDepText(reqText, "requirements");
		const depsInstalled = await venvPipList(repoDir);
		const diff = diffDeps(depsReq, depsInstalled);
		return { complete: diff.onlyA.length === 0, missing: diff.onlyA };
	}

	// venv 内 pip list 解析为 DepRecord[]；失败抛错
	async function venvPipList(repoDir: string): Promise<DepRecord[]> {
		const res = await exec(
			join(repoDir, ".venv", "Scripts", "python.exe"),
			["-m", "pip", "list"],
			{ timeout: 30000 },
		);
		if (res.code !== 0) {
			throw new Error(
				`python pip list failed (exit ${res.code}): ${res.stderr || res.stdout}`,
			);
		}
		return parseDepText(res.stdout, "pip-list");
	}

	// 判别：.venv 是否已创建（目录存在）；前置假设仓库健康
	async function hasXngVenv(cacheDir?: string): Promise<boolean> {
		return existsSync(join(xngRepoDir(cacheDir), ".venv"));
	}

	// 判别：searxng 本体是否已装入 .venv（editable 安装完成后 pip list 出现 searxng 包）。
	// 前置假设：venv 已建、仓库健康；pip list 失败抛错；返回 boolean
	async function hasXngInstalled(cacheDir?: string): Promise<boolean> {
		const repoDir = xngRepoDir(cacheDir);
		const depsInstalled = await venvPipList(repoDir);
		return depsInstalled.some((r) => r.name === "searxng");
	}

	// 安装：用 .venv 的 pip 按 requirements.txt 装齐依赖（pip 幂等：已满足的自动跳过，只装缺的/不符的）。
	// 下载源：indexUrl 未传/为空 → 用 XNG_PIP_INDEX（默认清华镜像）；XNG_PIP_INDEX 也为空 → 不加
	// --index-url，走 pip 默认官方源。前置假设：venv 已建、仓库健康；pip 失败抛错（带 stderr）
	async function installDeps(cacheDir?: string, indexUrl?: string): Promise<void> {
		const repoDir = xngRepoDir(cacheDir);
		const args = ["-m", "pip", "install", "-r", join(repoDir, "requirements.txt"), ...pipIndexArgs(indexUrl)];
		await runVenvPip(repoDir, args, "install");
	}

	// venv 内 python 执行 pip 命令；失败抛错（带 stderr）
	async function runVenvPip(repoDir: string, args: string[], what: string): Promise<void> {
		const res = await exec(join(repoDir, ".venv", "Scripts", "python.exe"), args, {
			timeout: 600000,
		});
		if (res.code !== 0) {
			throw new Error(`pip ${what} failed (exit ${res.code}): ${res.stderr || res.stdout}`);
		}
	}

	// 安装本体：用 .venv 的 pip editable 安装 xng 仓库自身（setup.py 的 console_scripts 生成 searxng-run
	// 命令）。setup.py 构建时 import searx（需已装依赖），故 --use-pep517 --no-build-isolation 在 venv
	// 内走 PEP 660 editable wheel 构建（legacy develop 内层会强制隔离环境，缺依赖会失败）；
	// 先装 setuptools/wheel 到 venv。下载源固定 XNG_PIP_INDEX（置空则 pip 默认官方源）。
	// 前置假设：venv 已建、依赖已装、仓库健康；失败抛错
	async function installXng(cacheDir?: string): Promise<void> {
		const repoDir = xngRepoDir(cacheDir);
		const indexArgs = pipIndexArgs();
		await runVenvPip(
			repoDir,
			["-m", "pip", "install", "setuptools", "wheel", ...indexArgs],
			"install setuptools wheel",
		);
		await runVenvPip(
			repoDir,
			["-m", "pip", "install", "-e", repoDir, "--use-pep517", "--no-build-isolation", ...indexArgs],
			"install -e",
		);
	}

	// 判别：附加模块是否齐全（配置的健康集 vs 实际：pip 类看 venv pip list，file 类看 extra-modules
	// 目录文件名清单）；返回缺失清单；目录不存在视为全部 file 类缺失（不抛）；pip list 失败抛错
	async function hasXngExtras(
		cacheDir?: string,
	): Promise<{ complete: boolean; missing: string[] }> {
		const repoDir = xngRepoDir(cacheDir);
		const installedNames = new Set((await venvPipList(repoDir)).map((r) => r.name));
		let dirNames = new Set<string>();
		try {
			dirNames = new Set(
				parseDepText(readdirSync(xngExtraDir(cacheDir)).join("\n"), "dir-list").map(
					(r) => r.name,
				),
			);
		} catch {
			// extra-modules 目录不存在：视为全部 file 类缺失
		}
		const missing = XNG_EXTRA_MODULES.filter((m) =>
			m.kind === "pip" ? !installedNames.has(m.name) : !dirNames.has(m.name),
		).map((m) => m.name);
		return { complete: missing.length === 0, missing };
	}

	// 安装：按配置逐项安装附加模块（pip 类 pip install、file 类从资产模板拷贝）；幂等；失败抛错
	async function installExtras(cacheDir?: string): Promise<void> {
		const repoDir = xngRepoDir(cacheDir);
		const extraDir = xngExtraDir(cacheDir);
		for (const m of XNG_EXTRA_MODULES) {
			if (m.kind === "pip") {
				await runVenvPip(
					repoDir,
					["-m", "pip", "install", m.name, ...pipIndexArgs()],
					`install ${m.name}`,
				);
			} else {
				mkdirSync(extraDir, { recursive: true });
				copyFileSync(join(ASSETS_DIR, m.template ?? m.name), join(extraDir, m.name));
			}
		}
	}
}

// 附加模块目录：<cacheDir>/searxng-server/extra-modules（相对 xng 仓库推导，跟随 cacheDir 语义）
export function xngExtraDir(cacheDir?: string): string {
	return join(xngRepoDir(cacheDir), XNG_EXTRA_REL);
}
