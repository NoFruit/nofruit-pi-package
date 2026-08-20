// 定位：状态机层——判断层事实（facts）→ 唯一状态 → 显示描述；状态是被动信息位，UI 订阅变化渲染。
// 状态模型（三主态 + 默认态文件子维度）：
//   online        managerAlive && xngOk         服务已启动
//   degraded      managerAlive && !xngOk        服务启动但 xng 未启动
//   offline       其余一切（默认态），files: ok | bad   bad = 文件/环境不达标（红色显示）
// 文件只在默认态参与竞争（服务存活时不存在文件子态）；facts 单一信息源：
// manager/xng 来自 launcher watch，文件来自哨兵/全量 probe。
// 判断层产出的事实（中间产物）
export interface XngFacts {
	/** manager 单例是否存活（pipe 可连） */
	managerAlive: boolean;
	/** xng 服务是否正常（仅 managerAlive 时有意义；只问 manager） */
	xngOk: boolean;
	/** 文件/环境是否满足启动标准（哨兵/全量 probe 产出） */
	filesOk: boolean;
}

// 唯一状态（三主态；offline 携带文件子维度）
export type XngState =
	| { kind: "online" }
	| { kind: "degraded" }
	| { kind: "offline"; files: "ok" | "bad" };

// 状态机：事实 → 唯一状态（纯函数，被动投影）
export function resolveState(f: XngFacts): XngState {
	if (!f.managerAlive) {
		return { kind: "offline", files: f.filesOk ? "ok" : "bad" };
	}
	return f.xngOk ? { kind: "online" } : { kind: "degraded" };
}

// 状态相等（事件驱动渲染：状态变化才触发）
export function sameState(a: XngState, b: XngState): boolean {
	if (a.kind !== b.kind) return false;
	if (a.kind === "offline") return a.files === (b as typeof a).files;
	return true;
}

// 显示描述：状态 → 文本 + 颜色 token（UI 层忠实渲染，theme 应用在调用方）
export interface XngDisplay {
	text: string;
	color: "success" | "dim" | "error";
}

export function displayFor(state: XngState): XngDisplay {
	switch (state.kind) {
		case "online":
			return { text: "SEARXNG-SERVER online", color: "success" };
		case "degraded":
			return { text: "SEARXNG-SERVER degraded (xng not ready)", color: "dim" };
		case "offline":
			return state.files === "bad"
				? { text: "SEARXNG-SERVER offline (files differ)", color: "error" }
				: { text: "SEARXNG-SERVER offline", color: "dim" };
	}
}
