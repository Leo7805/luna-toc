# LunaTOC-SC — ChatGPT 中文对话目录

LunaTOC-SC 是面向 ChatGPT 长对话的 Chrome 扩展，将用户提问整理成可搜索的目录，支持回答标题导航与常用提示词管理。

本项目基于 [Leo7805/luna-toc](https://github.com/Leo7805/luna-toc) 修改与维护，代码仓库为 [PyRookie1/luna-toc-sc](https://github.com/PyRookie1/luna-toc-sc)。

## 核心功能

- **对话目录**：提取用户提问，支持搜索、当前问题跟踪和长对话定位。
- **回答标题导航**：提取回答中的标题，支持展开、收起及章节跳转。
- **活动分支识别**：在 ChatGPT 提供节点关系时，按当前活动分支恢复目录。
- **目录操作**：支持收藏、复制提问以及将提问加入提示词库。
- **我的提示词**：支持提示词保存、管理、Markdown 导入导出及输入补全。
- **布局选择**：可切换对话与目录并列排布或浮于上层；并排模式默认固定展开，浮层模式默认自动隐藏，仍可手动调整固定状态。
- **背景配色**：提供与 ChatGPT 常见主题配色对应的预设颜色，支持深色及浅色主题。
- **触发区显示**：可选择完全透明或以所选背景色系半透明显示。
- **导航快捷操作**：支持跳转顶部、底部及切换提示词视图，工具组位置可上下调整。
- **本地优先**：无需维护者服务器，扩展不添加使用行为遥测。

## 下载安装

1. 在 [GitHub Releases](https://github.com/PyRookie1/luna-toc-sc/releases) 下载最新预览版的 `luna-toc-sc-chrome.zip`。
2. 解压 ZIP 文件；不要使用 GitHub 自动生成的 Source code 压缩包。
3. 打开 Chrome 的 `chrome://extensions/`，启用开发者模式。
4. 选择“加载已解压的扩展程序”，定位至包含 `manifest.json` 的文件夹。
5. 打开或刷新 [ChatGPT](https://chatgpt.com/)。

## 支持范围与限制

- 适用于 Chrome（Manifest V3）上的 `chatgpt.com` 和 `chat.openai.com`；不支持 Copilot。
- 目录数据及章节定位依赖 ChatGPT 的会话接口和网页结构，网页更新后可能需要适配。
- 并排布局依赖 ChatGPT 实际对话容器；窄窗口会自动回退为浮层形式。
- 回答标题仅能从已加载的内容提取，远距离导航可能需要等待历史内容挂载。
- 重复内容、含附件提问不会使用存在歧义的文本定位回退。
- 本地存储无法提供多个标签页之间的跨上下文事务。
- 自动化测试不等同于真实 ChatGPT 页面上的手动验收。

## 隐私

目录信息主要在当前浏览器页面内处理；常用提示词存储在 `chrome.storage.local`，目录标记状态保存在标签页会话存储中。项目不会向维护者服务器上传对话数据。详见 [PRIVACY.md](PRIVACY.md)。

## 致谢与许可

感谢 [Leo7805/luna-toc](https://github.com/Leo7805/luna-toc) 的开源工作。本衍生项目沿用 [MIT License](LICENSE)，与原作者官方发布渠道无隶属关系。
