// 定位：依赖文本的底层解析与对比。把 requirements.txt 与 pip list 的终端输出解析为统一
// 数据格式（DepRecord），并基于规范化包名集合判断两者之间的交并集关系。
// 纯函数模块：不依赖 exec / pi 环境，可独立运行与单测。
//
// 对外接口：
//   parseDepText(text, kind) -> DepRecord[]  解析 requirements（name==version，含 [extras]）或
//     pip-list（表头两行 + "name  version" 行）文本；空行/注释/选项行/无法识别的行跳过
//   diffDeps(a, b) -> DepDiff  基于规范化包名的集合关系（onlyA / onlyB / both），version 不参与

// 统一数据格式：包名（规范化）+ 版本串
export interface DepRecord {
	/** 规范化包名：小写、[-_.]+ 归一为 -（PEP 503） */
	name: string;
	/** 版本：requirements 侧为约束串（如 "==0.28.1"），pip 侧为已装版本（如 "25.0.1"）；无版本时省略 */
	version?: string;
}

export type DepTextKind = "requirements" | "pip-list";

// 解析：把 requirements / pip list 文本解析为统一 DepRecord[]；无法识别的行跳过
export function parseDepText(text: string, kind: DepTextKind): DepRecord[] {
	const out: DepRecord[] = [];
	for (const line of text.split(/\r?\n/)) {
		const rec = kind === "requirements" ? parseRequirementLine(line) : parsePipListLine(line);
		if (rec) out.push(rec);
	}
	return out;
}

// requirements 单行：name[extras]约束；跳过空行、# 注释行、- 开头的选项/引用行（-r、-e、--xxx）
function parseRequirementLine(line: string): DepRecord | null {
	const s = line.trim();
	if (!s || s.startsWith("#") || s.startsWith("-")) return null;
	const m = /^([^\s=[<>&~!]+)(?:\[[^\]]*\])?\s*(.*)$/.exec(s);
	if (!m) return null;
	const rec: DepRecord = { name: normalizeName(m[1]) };
	const version = m[2].trim();
	if (version) rec.version = version;
	return rec;
}

// pip list 单行：跳过表头（Package Version）与分隔线，其余 "name  version"（空白分隔）
function parsePipListLine(line: string): DepRecord | null {
	const s = line.trim();
	if (!s || /^Package\s+Version$/.test(s) || /^-+\s+-+$/.test(s)) return null;
	const parts = s.split(/\s+/);
	if (parts.length < 2) return null;
	const rec: DepRecord = { name: normalizeName(parts[0]) };
	if (parts[1]) rec.version = parts[1];
	return rec;
}

// 规范化包名：小写、[-_.]+ 归一为 -（PEP 503）
function normalizeName(name: string): string {
	return name.replace(/[-_.]+/g, "-").toLowerCase();
}

// 对比结果：A、B 之间的差集与交集
export interface DepDiff {
	/** 在 A 不在 B（如：声明了但未安装） */
	onlyA: string[];
	/** 在 B 不在 A（如：安装了但未声明） */
	onlyB: string[];
	/** 交集 */
	both: string[];
}

// 对比：基于规范化包名的集合关系；并集 = onlyA + onlyB + both 合并
export function diffDeps(a: DepRecord[], b: DepRecord[]): DepDiff {
	const setA = new Set(a.map((r) => r.name));
	const setB = new Set(b.map((r) => r.name));
	const onlyA: string[] = [];
	const onlyB: string[] = [];
	const both: string[] = [];
	for (const name of setA) {
		if (setB.has(name)) both.push(name);
		else onlyA.push(name);
	}
	for (const name of setB) {
		if (!setA.has(name)) onlyB.push(name);
	}
	return { onlyA, onlyB, both };
}
