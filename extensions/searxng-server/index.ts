import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// 定位：扩展入口。当前模块（xng-git / xng-py / dep-parse）测试走 node 直跑，暂不暴露给 pi。
export default function (_pi: ExtensionAPI) {
	// 暂不注册任何工具
}
