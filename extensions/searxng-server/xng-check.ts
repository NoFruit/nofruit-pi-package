// 定位：xng 环境自检编排——按"仓库 → 文件 → py"块序串行（文件同步依赖 git 仓库，py 同步依赖文件同步）。
// 两个入口（供命令/状态行/测试复用，exec 形如 pi.exec）：
//   probeXng(cacheDir?)   纯判别：是否满足启动标准；无修复、永不抛错、无网络请求。
//     返回粗粒度不达标块名（repo/sparse/files/python/venv/deps/xng/extras）。
//   repairXng(cacheDir?)  容错修复流：每块"判别→修复→闭环复查"；块失败记录错误并跳过依赖块
//     （repo 败→跳过 files/py；files 败→跳过 py；venv 败→跳过 deps/xng；deps 败→跳过 xng）；永不抛错。
import {
	createXngGit,
	xngRepoDir,
	type ExecFn,
} from "./xng-git.ts";
import { createXngPy } from "./xng-py.ts";

// 纯判别结果：ok + 粗粒度问题块名
export interface XngProbeResult {
	ok: boolean;
	/** 不达标块名（粗粒度；仅日志/命令输出用） */
	problems: string[];
	repoDir: string;
}

// 容错修复结果：永不抛错，错误/跳过块汇总
export interface XngRepairResult {
	ok: boolean;
	repoDir: string;
	actions: string[];
	/** 真实失败（含块内错误信息） */
	errors: string[];
	/** 因上游块失败被跳过的块（非错误，仅告知） */
	skipped: string[];
	note?: string;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createXngCheck(exec: ExecFn) {
	const git = createXngGit(exec);
	const py = createXngPy(exec);
	return { probeXng, repairXng };

	// 判别辅助：异常折算为 false（probe 永不抛错；venv/deps 等前置缺失会抛错，一律视为不达标）
	async function judgeOk(fn: () => Promise<boolean>): Promise<boolean> {
		try {
			return await fn();
		} catch {
			return false;
		}
	}

	// 纯判别：判定"是否满足启动标准"（与自检同一套判别集；无修复、永不抛错、无网络请求）
	async function probeXng(cacheDir?: string): Promise<XngProbeResult> {
		const repoDir = xngRepoDir(cacheDir);
		const problems: string[] = [];
		if (await git.hasXngGit(cacheDir)) {
			if (!(await git.hasXngSparse(cacheDir))) problems.push("sparse");
			if (!(await git.isXngClean(cacheDir))) problems.push("files");
			if (!(await py.hasXngPy())) problems.push("python");
			if (!(await py.hasXngVenv(cacheDir))) problems.push("venv");
			if (!(await judgeOk(() => py.hasXngDeps(cacheDir).then((r) => r.complete))))
				problems.push("deps");
			if (!(await judgeOk(() => py.hasXngInstalled(cacheDir))))
				problems.push("xng");
			if (
				!(await judgeOk(() => py.hasXngExtras(cacheDir).then((r) => r.complete)))
			)
				problems.push("extras");
		} else {
			problems.push("repo");
		}
		return { ok: problems.length === 0, problems, repoDir };
	}

	// 容错修复流：分块"判别→修复→闭环复查"；块失败记录错误、跳过依赖块、继续后续，永不抛错
	async function repairXng(cacheDir?: string): Promise<XngRepairResult> {
		const repoDir = xngRepoDir(cacheDir);
		const actions: string[] = [];
		const errors: string[] = [];
		const skipped: string[] = [];
		let note: string | undefined;
		let repoOk = false;
		let fileOk = false;

		// 仓库块：git 存在 → sparse → 上游新版提示；失败跳过文件/py 块
		try {
			if (!(await git.hasXngGit(cacheDir))) {
				await git.pullXng(cacheDir);
				actions.push("pull");
				if (!(await git.hasXngGit(cacheDir))) {
					throw new Error(
						"closed-loop failed: repo still not a git repo after pull",
					);
				}
			}
			if (!(await git.hasXngSparse(cacheDir))) {
				await git.setupSparse(cacheDir);
				actions.push("setupSparse");
				if (!(await git.hasXngSparse(cacheDir))) {
					throw new Error("closed-loop failed: sparse still inactive after setup");
				}
			}
			repoOk = true;
			if (await git.newerXngAvailable(cacheDir))
				note = "newer upstream available (not auto-updated)";
		} catch (e) {
			errors.push(`repo block: ${errMsg(e)}`);
			skipped.push("files block", "py block");
		}

		// 文件块：tracked 一致性（checkout -f 修复）；失败跳过 py 块
		if (repoOk) {
			try {
				if (!(await git.isXngClean(cacheDir))) {
					await git.checkoutXng(cacheDir);
					actions.push("checkout -f");
					if (!(await git.isXngClean(cacheDir))) {
						throw new Error(
							"closed-loop failed: worktree still dirty after checkout",
						);
					}
				}
				fileOk = true;
			} catch (e) {
				errors.push(`files block: ${errMsg(e)}`);
				skipped.push("py block");
			}
		}

		// py 块：python（机器级，只报告）→ venv → deps → xng → extras（依赖链：venv 依赖文件，deps/xng 依赖 venv）
		if (repoOk && fileOk) {
			let venvOk = false;
			if (await py.hasXngPy()) {
				try {
					if (!(await py.hasXngVenv(cacheDir))) {
						await py.createVenv(cacheDir);
						actions.push("createVenv");
						if (!(await py.hasXngVenv(cacheDir))) {
							throw new Error("closed-loop failed: venv still missing after create");
						}
					}
					venvOk = true;
				} catch (e) {
					errors.push(`py block: ${errMsg(e)}`);
					skipped.push("deps block", "xng block", "extras block");
				}
			} else {
				errors.push("py block: default python below xng requirement (>=3.10)");
			}

			if (venvOk) {
				let depsOk = false;
				try {
					if (!(await py.hasXngDeps(cacheDir)).complete) {
						await py.installDeps(cacheDir);
						actions.push("installDeps");
						if (!(await py.hasXngDeps(cacheDir)).complete) {
							throw new Error(
								"closed-loop failed: deps still incomplete after install",
							);
						}
					}
					depsOk = true;
				} catch (e) {
					errors.push(`py block: ${errMsg(e)}`);
				}
				if (depsOk) {
					try {
						if (!(await py.hasXngInstalled(cacheDir))) {
							await py.installXng(cacheDir);
							actions.push("installXng");
							if (!(await py.hasXngInstalled(cacheDir))) {
								throw new Error("closed-loop failed: searxng still not installed");
							}
						}
					} catch (e) {
						errors.push(`py block: ${errMsg(e)}`);
					}
				} else {
					skipped.push("xng block");
				}
				try {
					if (!(await py.hasXngExtras(cacheDir)).complete) {
						await py.installExtras(cacheDir);
						actions.push("installExtras");
						if (!(await py.hasXngExtras(cacheDir)).complete) {
							throw new Error(
								"closed-loop failed: extras still missing after install",
							);
						}
					}
				} catch (e) {
					errors.push(`py block: ${errMsg(e)}`);
				}
			}
		}

		return { ok: errors.length === 0, repoDir, actions, errors, skipped, note };
	}

}
