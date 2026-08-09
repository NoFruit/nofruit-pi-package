// 定位：把 xng（searxng）源码仓库拉到本机 pi 的 cache 目录。blobless clone（--filter=blob:none）：
// tree 全量、blob 按需懒拉取（clone -c 持久化连接配置进仓库 config）。默认机器已有 git；拉取失败统一抛错。
// xng 上游 utils/templates 下存在 Windows 无法检出的路径（含 : 的文件名与符号链接），
// 用 sparse 黑名单排除（/* 全量 + 排除 SPARSE_BLACKLIST）。
//
// 对外接口：createXngGit(exec) 返回基础积木；exec 形如 pi.exec：
//   exec(cmd, args, opts?) -> Promise<{ stdout, stderr, code }>
//   pullXng(cacheDir?)  -> Promise<string>  blobless clone（--no-checkout）到 cache；失败如实抛出
//   updateXng(cacheDir?) -> Promise<string>  与 origin 同步（fetch + ff-only 快进，走仓库内持久化代理）；git 报错仅抛出
//   checkoutXng(cacheDir?) -> Promise<string>  纯修复：checkout -f 默认分支，强制工作树与仓库一致（丢弃本地改动；无网络依赖）；git 报错仅抛出
//   setupSparse(cacheDir?)   -> Promise<string>  配置 sparse 黑名单（/* 全量、排除 SPARSE_BLACKLIST）；失败抛错
//   hasXngGit(cacheDir?)      -> Promise<boolean> 预期位置是否是健康 git 工作树；否则 false
//   isXngClean(cacheDir?)     -> Promise<boolean> tracked 是否与 xng 版本一致（无改动/无删除；未跟踪文件忽略）
//   hasXngSparse(cacheDir?)   -> Promise<boolean> sparse-checkout 是否已激活（黑名单已配）；否则 false
//   newerXngAvailable(cacheDir?) -> Promise<boolean> 上游 origin HEAD 与本地不同；检查失败视为无新版
//   initXng(cacheDir?)         -> Promise<XngResult> 编排：幂等初始化。已存在跳过；否则 pull → setupSparse（不物化）；失败抛错
//   fixXng(cacheDir?)          -> Promise<XngResult> 编排：修复已存在的仓库，按需 setupSparse / checkout -f / update（ff-only）；本地修复失败返回 ok:false
// cacheDir 缺省 ~/.pi/cache；仓库落在 <cacheDir>/searxng-server/searxng

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

// 连接默认值：gitee 镜像
const XNG_REMOTE = "https://gitee.com/mirrors/SearXNG.git";
// 代理默认值：空 = 不强制代理
const XNG_PROXY = "";
// sparse 黑名单：win 无法检出的路径（含 : 的文件名、符号链接），后续按需追加
const SPARSE_BLACKLIST = [
	"utils/templates/etc/httpd/sites-available/searxng.conf:socket",
	"utils/templates/etc/nginx/default.apps-available/searxng.conf:socket",
	"utils/templates/etc/uwsgi/apps-archlinux/searxng.ini:socket",
	"utils/templates/etc/uwsgi/apps-available/searxng.ini:socket",
	"utils/templates/etc/apache2",
];
const REPO_REL = join("searxng-server", "searxng");

// 仓库位置约定：<cacheDir>/searxng-server/searxng（模块级共享，xng-py 等依赖它）
export function xngRepoDir(cacheDir?: string): string {
	return join(cacheDir ?? defaultCacheDir(), REPO_REL);
}

function defaultCacheDir(): string {
	return join(homedir(), ".pi", "cache");
}
export interface ExecResult {
	stdout: string;
	stderr: string;
	code: number;
}

export interface XngResult {
	ok: boolean;
	repoDir: string;
	actions: string[];
	/** 非致命提示（已存在跳过、本地已修复但同步失败等） */
	note?: string;
	/** 修复失败原因（ok=false 时给出） */
	reason?: string;
}

export type ExecFn = (
	cmd: string,
	args: string[],
	opts?: { timeout?: number },
) => Promise<ExecResult>;

export function createXngGit(exec: ExecFn) {
	return { pullXng, updateXng, checkoutXng, setupSparse, hasXngGit, isXngClean, initXng, fixXng, hasXngSparse, newerXngAvailable };

	// 拉取：blobless clone（--no-checkout）下载 git 头到 cache，不物化工作树；出错如实抛出
	async function pullXng(cacheDir?: string): Promise<string> {
		const repoDir = xngRepoDir(cacheDir);
		await runGit(
			["clone", "-c", `http.proxy=${XNG_PROXY}`, "--filter=blob:none", "--no-checkout", XNG_REMOTE, repoDir],
			`clone ${XNG_REMOTE}`
		);
		return repoDir;
	}

	// git 失败信息归类：超时 / 连接断开 / 其余 git 报错
	function gitFailure(e: unknown): string {
		const msg = e instanceof Error ? e.message : String(e);
		if (/timeout|timed out/i.test(msg)) return `${msg}（超时）`;
		if (/SSL|EOF|reset|broken pipe|early close/i.test(msg)) return `${msg}（连接断开）`;
		return `${msg}（git 报错）`;
	}

	// 默认分支名：解析 origin/HEAD 指向的分支（如 master）；git 报错仅抛出
	async function defaultBranch(repoDir: string): Promise<string> {
		const res = await exec("git", ["-C", repoDir, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { timeout: 10000 });
		if (res.code !== 0) {
			throw new Error(
				`git symbolic-ref origin/HEAD failed (exit ${res.code}): ${res.stderr || res.stdout}`
			);
		}
		return res.stdout.trim().replace(/^origin\//, "");
	}

	// 同步：与 origin 对齐（fetch + ff-only 快进），前置条件是仓库已存在；git 报错仅抛出
	async function updateXng(cacheDir?: string): Promise<string> {
		const repoDir = xngRepoDir(cacheDir);
		const branch = await defaultBranch(repoDir);
		await runGit(["-C", repoDir, "fetch", "origin"], "fetch origin");
		await runGit(
			["-C", repoDir, "merge", "--ff-only", `origin/${branch}`],
			`merge --ff-only origin/${branch}`
		);
		return repoDir;
	}
	// 修复/物化：checkout -f 默认分支，强制工作树与仓库一致（丢弃本地改动），覆盖空 index、游离态、半物化；无网络依赖；git 报错仅抛出
	async function checkoutXng(cacheDir?: string): Promise<string> {
		const repoDir = xngRepoDir(cacheDir);
		const branch = await defaultBranch(repoDir);
		await runGit(["-C", repoDir, "checkout", "-f", branch], `checkout -f ${branch}`);
		return repoDir;
	}


	// 稀疏配置：no-cone（gitignore 式）模式，/* 全量物化 + 排除黑名单
	async function setupSparse(cacheDir?: string): Promise<string> {
		const repoDir = xngRepoDir(cacheDir);
		await runGit(
			["-C", repoDir, "sparse-checkout", "init", "--no-cone"],
			"sparse-checkout init"
		);
		await runGit(
			["-C", repoDir, "sparse-checkout", "set", "--no-cone", "/*", ...SPARSE_BLACKLIST.map((p) => `!${p}`)],
			"sparse-checkout set"
		);
		await runGit(
			["-C", repoDir, "config", "core.protectNTFS", "false"],
			"config core.protectNTFS false"
		);
		return repoDir;
	}

	// 健康判定：目录在 git 工作树内且 rev-parse 输出 true；目录缺失/非 git 一律 false
	async function hasXngGit(cacheDir?: string): Promise<boolean> {
		const res = await quietGit(xngRepoDir(cacheDir), [
			"rev-parse",
			"--is-inside-work-tree",
		]);
		return res.code === 0 && res.stdout.trim() === "true";
	}

	// 一致性判定：tracked 文件与 xng 版本一致（--untracked-files=no 忽略未跟踪文件；
	// tracked 损失/编辑是风险，多出的未跟踪文件不算）
	async function isXngClean(cacheDir?: string): Promise<boolean> {
		if (!(await hasXngGit(cacheDir))) return false;
		const res = await quietGit(xngRepoDir(cacheDir), ["status", "--porcelain", "--untracked-files=no"]);
		return res.code === 0 && res.stdout.trim() === "";
	}

	// git 失败即抛错（带 stderr），拉取入口专用
	async function runGit(args: string[], what: string): Promise<void> {
		const res = await exec("git", args, { timeout: 120000 });
		if (res.code !== 0) {
			throw new Error(
				`git ${what} failed (exit ${res.code}): ${res.stderr || res.stdout}`,
			);
		}
	}

	// 探测用 git：任何异常都折算成 code 1，不抛错
	async function quietGit(
		repoDir: string,
		gitArgs: string[],
	): Promise<ExecResult> {
		return exec("git", ["-C", repoDir, ...gitArgs], { timeout: 10000 }).catch(
			() => ({ stdout: "", stderr: "", code: 1 }),
		);
	}

	// 仓库位置约定见模块级 xngRepoDir（<cacheDir>/searxng-server/searxng）

	// 编排：幂等初始化。已存在（hasXngGit）则跳过；否则拉取 git → setupSparse；git 失败抛错
	// 目录存在但非 git（如 .git 被删）：git clone 拒绝非空目录，改用 git init + fetch 往现有目录装 .git，不清残留
	// 不物化工作树：建立文件内容（含清残留）归 fixXng 负责，init 只管"git 存在 + sparse 配好"
	async function initXng(cacheDir?: string): Promise<XngResult> {
		const repoDir = xngRepoDir(cacheDir);
		if (await hasXngGit(cacheDir)) {
			return { ok: true, repoDir, actions: [], note: "已存在，跳过" };
		}
		const actions: string[] = [];
		if (existsSync(repoDir)) {
			await initGitInDir(repoDir);
			actions.push("init-git(装入现有目录)");
		} else {
			await pullXng(cacheDir);
			actions.push("pull");
		}
		actions.push("setupSparse");
		await setupSparse(cacheDir);
		return { ok: true, repoDir, actions };
	}

	// 往现有目录装 .git：init + remote + config 持久化 + blobless fetch + 设置 origin/HEAD
	// （clone -c 的持久化在这里用 config 手动等价写入）
	async function initGitInDir(repoDir: string): Promise<void> {
		await runGit(["-C", repoDir, "init"], "init");
		await runGit(["-C", repoDir, "remote", "add", "origin", XNG_REMOTE], "remote add origin");
		await runGit(["-C", repoDir, "config", "http.proxy", XNG_PROXY], "config http.proxy");
		await runGit(["-C", repoDir, "config", "remote.origin.promisor", "true"], "config promisor");
		await runGit(["-C", repoDir, "config", "remote.origin.partialclonefilter", "blob:none"], "config partialclonefilter");
		await runGit(["-C", repoDir, "fetch", "--filter=blob:none", "origin"], "fetch origin");
		await runGit(["-C", repoDir, "remote", "set-head", "origin", "-a"], "remote set-head origin -a");
	}

	// 编排：修复已存在的仓库，按需执行 setupSparse / checkout -f / update（ff-only）
	// 本地修复失败返回 ok:false + reason；update 的网络失败不算修复失败（本地已修复，记 note）
	// 仓库不存在属于存在层（hasXngGit/init）的职责，直接返回 ok:false
	async function fixXng(cacheDir?: string): Promise<XngResult> {
		const repoDir = xngRepoDir(cacheDir);
		const actions: string[] = [];
		if (!(await hasXngGit(cacheDir))) {
			return {
				ok: false,
				repoDir,
				actions,
				reason: "仓库不存在或不是健康 git 工作树（请先 init）",
			};
		}
		try {
			// sparse 未激活 → 配置黑名单
			if (!(await hasXngSparse(cacheDir))) {
				await setupSparse(cacheDir);
				actions.push("setupSparse");
			}
			// HEAD 缺失（clone 未 checkout）或有改动 → checkout -f 强制物化，丢弃本地改动
			if (!(await headExists(cacheDir)) || !(await isXngClean(cacheDir))) {
				await checkoutXng(cacheDir);
				actions.push("checkout -f");
			}
		} catch (e) {
			return { ok: false, repoDir, actions, reason: gitFailure(e) };
		}
		// 与上游对齐（ff-only）；网络失败不算修复失败——本地已修复，记 note
		try {
			await updateXng(cacheDir);
			actions.push("update");
		} catch (e) {
			if (networkish(e)) {
				return {
					ok: true,
					repoDir,
					actions,
					note: `本地已修复；与上游同步失败（网络）：${gitFailure(e)}`
				};
			}
			return { ok: false, repoDir, actions, reason: gitFailure(e) };
		}
		return { ok: true, repoDir, actions, note: actions.length ? undefined : "无需修复" };
	}

	// 判别：sparse-checkout 是否已激活（list 有输出即激活；全量/未初始化都是空）
	async function hasXngSparse(cacheDir?: string): Promise<boolean> {
		const res = await quietGit(xngRepoDir(cacheDir), ["sparse-checkout", "list"]);
		return res.code === 0 && res.stdout.trim() !== "";
	}

	// 判别：上游是否存在新版（ls-remote origin HEAD 与本地 HEAD 不同）；检查失败视为无新版
	async function newerXngAvailable(cacheDir?: string): Promise<boolean> {
		const repoDir = xngRepoDir(cacheDir);
		const local = await quietGit(repoDir, ["rev-parse", "--verify", "--quiet", "HEAD"]);
		if (local.code !== 0) return false;
		const remote = await quietGit(repoDir, ["ls-remote", "origin", "HEAD"]);
		if (remote.code !== 0) return false;
		const remoteHead = remote.stdout.trim().split(/\s+/)[0];
		return Boolean(remoteHead) && remoteHead !== local.stdout.trim();
	}

	// 私有探测：HEAD 是否存在（区分"clone 完没 checkout 的空 index"与正常仓库）
	async function headExists(cacheDir?: string): Promise<boolean> {
		const res = await quietGit(xngRepoDir(cacheDir), ["rev-parse", "--verify", "--quiet", "HEAD"]);
		return res.code === 0;
	}

	// 网络类失败判定（超时/连接断开/域名解析）：update 阶段这类失败记 note 而非 reason
	function networkish(e: unknown): boolean {
		const msg = e instanceof Error ? e.message : String(e);
		return /timeout|timed out|SSL|EOF|reset|broken pipe|early close|could not resolve|failed to connect|connection/i.test(msg);
	}
}
