# 外部标配包

换机器时照着装。这些包不在 nofruit 本体内（pi 范式里它们与本包是 settings 里平级独立的条目，不是依赖），只是个人用着顺手、每台机器都装。

## pi-web-access

- **用途**：网络搜索 / URL 抓取 / GitHub 仓库克隆 / PDF 提取 / YouTube 与本地视频分析
- **安装**：`pi install npm:pi-web-access`
- **为啥好用**：`fetch_content` 一次拿到干净页面正文，比手搓 curl+grep 快且全；社区下载量 138K/月，主流选择
- **记录**：2026-07-13
- **备注**：已替换 nofruit 原有的 `web-fetch` / `web-search` 两个简版 skill
