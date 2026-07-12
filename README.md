# nofruit-pi-package

个人 pi 环境仓库。三合一：多机同步 + 标配包清单 + 临时开发孵化器。

## 换机器恢复

1. 装 pi：`npm install -g @earendil-works/pi-coding-agent`
2. 装本包：`pi install git:git@github.com:NoFruit/nofruit-pi-package`
3. 照 [`packages.md`](./packages.md) 装外部标配包
4. 启动 `pi`

## 孵化器约定

- 临时工具放 `extensions/`，成熟后拆成独立公开 repo（加 `pi-package` keyword、去 `private`、发 npm），再从本仓库移除
- 当前孵化中：`extensions/multi-search`（多引擎聚合搜索）

## pi 范式

- 本包 `private: true`，不发布 npm、不进官方画廊（个人同步包）
- `package.json` 的 `pi` manifest 声明 extensions/skills/prompts/themes 路径
- 外部包（见 `packages.md`）与本包在 `settings.json` 的 `packages` 数组里是**平级独立条目**，不是依赖关系
- `package-lock.json` 仅在本包有 `dependencies` 时才有意义；当前零依赖，不保留
