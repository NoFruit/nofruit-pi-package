// 定位：配置菜单（custom TUI）——"插件 | on/off" 列表，空格翻转，↑↓ 移动，Enter 保存，Esc 取消。
// 仅 TUI 可用（调用方在非 TUI 模式降级）；组件无法自动化测试，仅结构验证。
import { Key, matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { ConfigRow } from "./adaptor.ts";

export type ConfigResult = ConfigRow[] | null; // null = cancelled

export async function showConfig(
	ui: ExtensionUIContext,
	initial: ConfigRow[],
): Promise<ConfigResult> {
	return ui.custom<ConfigResult>((tui, theme, _kb, done) => {
		const rows = initial.map((r) => ({ ...r }));
		let cursor = 0;
		let cachedLines: string[] | undefined;

		const refresh = () => {
			cachedLines = undefined;
			tui.requestRender();
		};
		const finish = (cancelled: boolean) => done(cancelled ? null : rows);

		function handleInput(data: string): void {
			if (matchesKey(data, Key.up)) {
				cursor = Math.max(0, cursor - 1);
				refresh();
				return;
			}
			if (matchesKey(data, Key.down)) {
				cursor = Math.min(rows.length - 1, cursor + 1);
				refresh();
				return;
			}
			if (matchesKey(data, Key.space)) {
				rows[cursor].enabled = !rows[cursor].enabled;
				refresh();
				return;
			}
			if (matchesKey(data, Key.enter)) {
				finish(false);
				return;
			}
			if (matchesKey(data, Key.escape)) {
				finish(true);
			}
		}

		function render(width: number): string[] {
			if (cachedLines) return cachedLines;
			const rw = Math.max(1, width);
			const lines: string[] = [];
			lines.push(theme.fg("accent", "─".repeat(rw)));
			lines.push(
				"  " +
					theme.fg("text", theme.bold("search routing")) +
					theme.fg("dim", "  (space toggle, enter save, esc cancel)"),
			);
			lines.push("");
			const nameW = Math.max(...rows.map((r) => visibleWidth(r.package))) + 2;
			for (let i = 0; i < rows.length; i++) {
				const active = i === cursor;
				const prefix = active ? theme.fg("accent", "> ") : "  ";
				const name =
					rows[i].package +
					" ".repeat(Math.max(0, nameW - visibleWidth(rows[i].package)));
				const mark = rows[i].enabled
					? theme.fg("success", "● on")
					: theme.fg("dim", "○ off");
				const line = `${prefix}${theme.fg("text", name)}${mark}`;
				lines.push(active ? theme.bg("selectedBg", theme.fg("text", line)) : line);
			}
			lines.push("");
			lines.push(
				theme.fg("dim", "  space toggle • up/down move • enter save • esc cancel"),
			);
			lines.push(theme.fg("accent", "─".repeat(rw)));
			cachedLines = lines;
			return lines;
		}

		return {
			render,
			invalidate: refresh,
			handleInput,
		};
	});
}
