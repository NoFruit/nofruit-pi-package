// 定位：xng 环境自检编排——启动自检（start_session 阶段一次性调用）。
// 按"仓库 → 文件 → py"块序串行（文件同步依赖 git 仓库，py 同步依赖文件同步）：
// 每块先判别（轻量只读），判别不过才修复；修复后闭环复查，复查不过直接抛错（不再二次修复）。
// 版本提示只产出 note，不动作；任何修复失败抛错（启动中止）。
//
// 对外接口：createXngCheck(exec) 返回基础积木；exec 形如 pi.exec：
//   exec(cmd, args, opts?) -> Promise<{ stdout, stderr, code }>
//   selfCheckXng(cacheDir?) -> Promise<XngResult> 自检全流程；失败抛错
import { createXngGit, xngRepoDir, type ExecFn, type XngResult } from "./xng-git.ts";
import { createXngPy } from "./xng-py.ts";

export function createXngCheck(exec: ExecFn) {
	const git = createXngGit(exec);
	const py = createXngPy(exec);
	return { selfCheckXng };

	// 自检：仓库块（git 存在→sparse）→ 文件块（tracked 一致性）→ py 块（python/venv/依赖/本体）；
	// 每块判别不过才修复，修复后闭环复查；版本提示仅 note；失败抛错
	async function selfCheckXng(cacheDir?: string): Promise<XngResult> {
		const repoDir = xngRepoDir(cacheDir);
		const actions: string[] = [];
		let note: string | undefined;

		// 仓库块
		if (!(await git.hasXngGit(cacheDir))) {
			await git.pullXng(cacheDir);
			actions.push("pull");
			if (!(await git.hasXngGit(cacheDir))) {
				throw new Error("闭环复查失败：拉取后 git 仓库仍不可用");
			}
		}
		if (!(await git.hasXngSparse(cacheDir))) {
			await git.setupSparse(cacheDir);
			actions.push("setupSparse");
			if (!(await git.hasXngSparse(cacheDir))) {
				throw new Error("闭环复查失败：sparse 配置后仍未激活");
			}
		}
		if (await git.newerXngAvailable(cacheDir)) {
			note = "上游存在新版（未自动更新）";
		}

		// 文件块
		if (!(await git.isXngClean(cacheDir))) {
			await git.checkoutXng(cacheDir);
			actions.push("checkout -f");
			if (!(await git.isXngClean(cacheDir))) {
				throw new Error("闭环复查失败：checkout 后工作树仍不一致");
			}
		}

		// py 块
		if (!(await py.hasXngPy())) {
			throw new Error("本机默认 python 不满足 xng 版本要求");
		}
		if (!(await py.hasXngVenv(cacheDir))) {
			await py.createVenv(cacheDir);
			actions.push("createVenv");
			if (!(await py.hasXngVenv(cacheDir))) {
				throw new Error("闭环复查失败：venv 创建后仍不存在");
			}
		}
		if (!(await py.hasXngDeps(cacheDir)).complete) {
			await py.installDeps(cacheDir);
			actions.push("installDeps");
			if (!(await py.hasXngDeps(cacheDir)).complete) {
				throw new Error("闭环复查失败：依赖安装后仍未装齐");
			}
		}
		if (!(await py.hasXngInstalled(cacheDir))) {
			await py.installXng(cacheDir);
			actions.push("installXng");
			if (!(await py.hasXngInstalled(cacheDir))) {
				throw new Error("闭环复查失败：本体安装后仍未装入");
			}
		}

		return {
			ok: true,
			repoDir,
			actions,
			note,
		};
	}
}
