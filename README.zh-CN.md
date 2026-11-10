# zcode-beautify

[English](README.md) | [中文](README.zh-CN.md)

美化 **ZCode 桌面客户端**：任意图片一键设为背景壁纸，并用 Material Design 3（莫奈取色）动态配色适配整个 UI——还附带实时悬浮设置面板。

> 📷 欢迎贡献截图——向 `docs/screenshot.png` 提 PR 即可。

## 功能

- **壁纸**——任意本地图片作为固定背景层,铺在 UI 之下;三种取景模式:`cover`(填满裁剪)、`contain`(完整显示,背后是同图模糊放大底)、`smart`(AI 适应:本地分析画面主体,自动选择最佳取景与焦点位置)。
- **莫奈配色**——用 Google 官方 MD3 算法从壁纸提取 source color,生成 light/dark 双套调色板,映射覆盖 ZCode 的 35+ 个语义 CSS 变量。
- **预览液态玻璃**——右侧文件预览面板同款玻璃化:它原本的底是 `--color-background`,而插件把该变量改成了 `transparent`,于是预览文字直接压在花壁纸上;玻璃层把可读的磨砂面补回来。独立开关与模糊 / 浓度 / 圆角三个旋钮,默认关闭。
- **侧栏液态玻璃**——可选的左侧栏玻璃化:磨砂背景、斜向镜面高光、发光描边与悬浮投影,让侧栏读起来像一块玻璃而不是壁纸上的"透明洞"。配色由 `--color-sidebar` 用 `color-mix` 推导,自动跟随莫奈方案(关闭莫奈时跟随 ZCode 原生色)。默认关闭,可调模糊 / 浓度 / 圆角;圆角设为 0 则贴着窗口边缘。
- **实时设置面板**——ZCode 窗口内可拖拽的悬浮面板:blur/dim 滑块、Monet 开关、壁纸透显开关、一键换图、还原;所有调整即时预览并自动保存。
- **对话控制**——内置 `/beautify` 斜杠命令与 MCP 工具,让 ZCode 智能体代你设壁纸、调主题。
- **重启后自动恢复**——注入的主题随渲染器一起消失,所以由插件负责把它放回来:`on-start`(默认)由 ZCode 启动时拉起的 MCP 宿主恢复一次;`always` 常驻一个后台服务,主题与设置面板都能扛过重启。可在设置面板里切换。

## 原理

ZCode 是 Electron 应用,UI 主题由 Tailwind v4 的 `--color-*` CSS 自定义属性驱动,且 production 版**默认不带调试端口**。本插件:

1. 以 `--remote-debugging-port=9222` 启动 ZCode(仅需一次 `launch`);
2. 通过 Chrome DevTools Protocol 向 renderer 注入 CSS/JS:
   - 固定定位的壁纸层(图片以 data URI 嵌入),
   - 背景类变量改为半透明,让壁纸透出,
   - MD3 light/dark 调色板覆盖 ZCode 的语义 token;
3. `serve` 模式保持注入会话不关闭,主题与设置面板在渲染器刷新后自动存活。

不修改任何安装文件,ZCode 升级不受影响。

## 环境要求

- Node.js ≥ 20(在 PATH 中)。
- ZCode 桌面客户端(Windows / macOS / Linux)。

## 两种包，都可以直接把链接扔给 AI 安装

只需把 <https://github.com/Logocceai/zcode-beautify> 交给你的 AI 智能体——它会 clone 仓库并按其中的说明执行。选对包：

| | **插件包**（`INSTALL-FOR-AI.md`） | **技能包**（`skill-pack/SKILL.md`） |
|---|---|---|
| 目标 | **ZCode 桌面客户端** | **任意** Electron 应用 |
| AI 角色 | 安装器——装好现成插件 | 开发者——从零构建工具 |
| 你说 | "给我的 ZCode 装这个美化插件" | "给我的 XX 应用做壁纸/取色美化" |
| 产物 | ZCode 里可用的 /beautify 命令 + MCP 工具 | 一个新的本地美化工具 |

插件包复制即用的提示词：

```text
https://github.com/Logocceai/zcode-beautify
把这个美化插件安装到我的 ZCode 桌面客户端，按仓库中的 INSTALL-FOR-AI.md 执行。
```

离线环境？两种包都在 [Releases 页面](https://github.com/Logocceai/zcode-beautify/releases) 附有 zip。

## 安装（手动路径）

### 方式 A —— ZCode 插件市场(推荐)

1. 打开 ZCode → **设置 → 插件管理 → 发现**。
2. 点 **+**,添加本仓库(GitHub URL 或本地 clone 路径)。
3. 在 *zcode-beautify* 卡片上点 **获取**。`/beautify` 命令与 MCP 工具立即可用。

仓库内已附带 `dist/` 预构建单文件产物,无需本地构建。

### 方式 B —— clone 直接运行

```bash
git clone https://github.com/Logocceai/zcode-beautify.git
cd zcode-beautify
node dist/cli.js --help        # 预构建产物,零安装
```

## 快速开始

```bash
# 1) 完全退出 ZCode 后执行一次,以 CDP 调试端口重启 ZCode
node dist/cli.js launch

# 2) 设置壁纸并自动适配配色
node dist/cli.js apply "D:\pictures\wallpaper.jpg" --blur 6 --dim 30

# 3) 给所有启动入口补上调试端口,这样正常启动 ZCode 也能开出端口
#    需要管理员权限的入口会被报告并跳过
node dist/cli.js repair-launchers

# 4) 选择重启后由谁恢复主题
#    on-start(默认)= 不占内存,但没有设置面板
#    always        = 后台常驻,主题与面板都扛过重启
node dist/cli.js recovery on-start

# 5) 仅 on-start 模式需要:现在起一个服务拿到实时设置面板
#    --detach 让服务转入后台,启动它的终端(或智能体会话)结束后面板依然可用
node dist/cli.js serve --detach
```

`serve` 运行时,ZCode 右下角出现 🎨 按钮。点开即可实时调 blur/dim、循环切换取景模式(cover → contain → smart)、开关 Monet 配色与壁纸透显、更换壁纸图片或一键还原——所有调整即时预览、自动保存。服务未运行时,面板会明确显示 ⚠ 离线提示,而不是装作配置全为 0。

也可以直接在 ZCode 里输入 `/beautify <图片路径>` 让智能体操作,之后说"模糊调高一点"即可(由 `apply_options` MCP 工具处理)。

## CLI 命令

| 命令 | 用途 |
|---|---|
| `launch [--port N]` | 以调试端口启动 ZCode(需先完全退出) |
| `apply <image> [--blur] [--dim] [--fit] [--no-monet] [--sidebar-glass] [--sidebar-blur] [--sidebar-tint] [--sidebar-radius]` | 设壁纸并适配配色(`--fit cover\|contain\|smart`);`--sidebar-glass` / `--preview-glass` 开启侧栏 / 预览液态玻璃 |
| `colors` | 不换图,重新应用已存主题 |
| `serve [--detach] [--api-port M]` | 守护模式 + 设置面板 + 本地控制 API(默认 API 端口 9223);`--detach` 使其脱离启动它的终端存活 |
| `watch` | 无面板守护模式:ZCode 重启后自动重注入 |
| `recovery [off\|on-start\|always]` | 重启后由谁恢复主题(默认 `on-start`) |
| `autostart [install\|uninstall]` | 注册登录时自启的常驻服务(`always` 模式使用) |
| `repair-launchers [--dry-run]` | 给所有缺调试端口的启动入口补上参数 |
| `reset` | 移除壁纸与配色覆盖 |
| `status` | 查看 CDP 可达性与渲染器目标 |

## MCP 工具

| 工具 | 用途 |
|---|---|
| `set_background` | 设壁纸 + 莫奈配色 |
| `apply_options` | 不重传图片,单独调 blur/dim/monet/壁纸透显/取景模式/侧栏与预览液态玻璃 |
| `refresh_theme` | 重启后重注入已存主题 |
| `reset_appearance` | 移除壁纸与覆盖,还原默认 |
| `beautify_status` | 查看已存配置 |
| `recovery_status` | 查看恢复模式、自启项状态与 CDP 可达性 |
| `set_recovery_mode` | 在 `off` / `on-start` / `always` 间切换 |
| `repair_launchers` | 给缺调试端口的启动入口补参数 |

## 项目结构

```
├─ src/
│  ├─ cli.ts                 # CLI 入口:launch / apply / colors / reset / status / watch / serve
│  ├─ core/
│  │  ├─ cdp.ts              # 精简 Chrome DevTools Protocol 客户端 + 注入脚本
│  │  ├─ inject.ts           # 装配注入载荷(壁纸层 CSS + token 覆盖)
│  │  ├─ autostart.ts        # 用户级开机自启注册(VBS / LaunchAgent / XDG)
│  │  ├─ launchers.ts        # 找出缺调试端口的启动入口并补上
│  │  ├─ launch.ts           # 配置持久化 + ZCode 启动器(感知单实例锁)
│  │  ├─ monet.ts            # 图片解码、MD3 取色、智能适配(smart fit)分析
│  │  ├─ recovery.ts         # off / on-start / always —— 重启后由谁恢复主题
│  │  ├─ server.ts           # serve 模式:本地控制 API + 持久注入会话
│  │  ├─ session.ts          # CLI 与 MCP 共用的应用/还原操作
│  │  └─ tokens.ts           # MD3 调色板 → ZCode 的 Tailwind v4 --color-* 变量映射
│  ├─ panel/panelScript.ts   # 注入式设置面板(DOM + CSS + 逻辑)
│  └─ mcp/server.ts          # 向 ZCode 智能体暴露工具的 MCP 服务
├─ commands/beautify.md      # /beautify 斜杠命令
├─ skills/beautify/SKILL.md  # 面向智能体的工作流文档
├─ .zcode-plugin/plugin.json # ZCode 插件清单(命令、技能、MCP 服务)
├─ marketplace.json          # 市场索引,让仓库可在 ZCode 插件市场被发现
├─ scripts/bundle.mjs        # esbuild 打包(dist/ 为自包含产物,已入库)
└─ dist/                     # 预构建 cli.js + mcp/server.js —— 用户零构建
```

用户数据位于 `~/.zcode/cli/plugins/data/zcode-beautify/`:`config.json`(当前配置)、`config.backup.json`(还原时记住的壁纸备份)、`wallpaper.*`(壁纸副本,原图移动或删除后主题依然有效)。

## 开发

```bash
npm install
npm run build    # 类型检查 + 编译到 dist/
npm run bundle   # 预构建单文件产物(仓库随附)
```

`dist/` 已提交入库,用户无需构建。修改 `src/` 后请运行 `npm run bundle` 并提交更新后的产物。

## 技能包(`skill-pack/`)

`skill-pack/` 是一份自包含、平台无关的 AI 编码智能体技能包(Claude、DeepSeek、Codex、豆包……均可):把文件夹交给任意智能体,它就能为**任意** Electron 应用重建这套美化能力——CDP 通道、MD3 取色、注入模板、实时调参 API,以及来自实战的踩坑清单。与本仓库同步版本。可从 [Releases 页面](https://github.com/Logocceai/zcode-beautify/releases)下载 zip,或直接阅读 [`skill-pack/SKILL.md`](skill-pack/SKILL.md)。

## 风险与限制

- 注入通过 CDP(Chrome DevTools 协议)实现,属**非官方**手段,ZCode 更新可能使其失效;`reset` 可随时还原默认外观。
- ZCode 只在以 `--remote-debugging-port` 启动时才开调试端口,而已经运行的实例无法中途补上——参数只能由启动它的入口提供。`repair-launchers` 会把它写进所有能写的启动入口(桌面、开始菜单、任务栏固定项、`zcode://` 协议与右键菜单);机器级入口需要管理员权限,会被报告而不是静默跳过。
- **有两类入口会自己把参数丢掉。** ZCode 更新会重建开始菜单快捷方式(参数随之消失),主程序每次启动也会重新注册自己的协议与右键菜单,把那两个注册表值写回原样。快捷方式是持久入口——而大多数第三方启动器(Flow Launcher、PowerToys Run 等)正是索引开始菜单快捷方式并用 ShellExecute 启动它,参数对它们同样生效。更新后发现美化消失:运行 `repair-launchers`,然后完全退出 ZCode 并从修好的快捷方式启动一次;`on-start` 模式(默认)在启动时发现端口不通也会自动修复这些入口,此时重启一次即可。
- 注入的主题活在渲染器里,每次 ZCode 重启都会丢失。`on-start`(默认)在 ZCode 启动时恢复一次;`always` 常驻 `serve` 服务,主题与设置面板都能扛过重启。前台 `serve` 会随启动它的终端(或智能体会话)一起退出——请用 `serve --detach`,或交给 `always` 管理。
- 功能色(success/warning/destructive)刻意保持不动。
- 控制 API 绑定 `127.0.0.1`,并要求一个只有注入面板才持有的令牌;本机其它进程、或浏览器里的网页都无法驱动它。

## 许可证

MIT
