// 定位：判断本机默认 python 环境是否符合 xng（searxng）的版本要求，在 xng 仓库创建虚拟环境，
// 并判别 .venv 是否装齐 requirements.txt 声明的全部依赖。
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
//     searxng 包）；前置假设 venv 已建、仓库健康；pip list 失败抛错

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExecFn, ExecResult } from "./xng-git.ts";
import { xngRepoDir } from "./xng-git.ts";
import { parseDepText, diffDeps, type DepRecord } from "./dep-parse.ts";
// xng 要求的最低 Python 版本（setup.py python_requires=">=3.10"）
const XNG_PY_MIN_MAJOR = 3;
const XNG_PY_MIN_MINOR = 10;
// pip 下载源：默认清华镜像（本机直连官方源不稳定）；置空则用 pip 默认官方源
export const XNG_PIP_INDEX = "https://pypi.tuna.tsinghua.edu.cn/simple";

export function createXngPy(exec: ExecFn) {
	return { hasXngPy, createVenv, hasXngDeps, installDeps, installXng, hasXngInstalled, hasXngVenv };

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
		const args = ["-m", "pip", "install", "-r", join(repoDir, "requirements.txt")];
		const index = indexUrl || XNG_PIP_INDEX;
		if (index) {
			args.push("--index-url", index);
		}
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
		const indexArgs = XNG_PIP_INDEX ? ["--index-url", XNG_PIP_INDEX] : [];
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
}
