# ASC IPA Uploader

> 用 **App Store Connect 官方 API（Build Uploads）** 把 IPA 上传到 App Store Connect 的零依赖命令行工具。
> Zero-dependency CLI tool to upload IPAs to App Store Connect via the **official Build Uploads API**.

## 安装 / Install

```bash
# 方式一：直接从仓库安装（无需 npm 账号，2 秒装完）
npm i -g https://github.com/xxhshenqi/asc-ipa-uploader/archive/refs/heads/master.tar.gz

# 方式二：npx 临时运行（需要本机有 git）
npx github:xxhshenqi/asc-ipa-uploader --help
```

安装后直接使用 `asc-ipa-uploader` 命令。

## 背景 / Background

2026 年 10 月底，Apple 悄悄收紧了 `contentdelivery.itunes.apple.com` 的 **User-Agent 校验**，要求严格匹配特定完整格式。依赖旧 UA 的第三方上传工具（ios-uploader 等）集体报 `-22938` 错误 —— 原作者 simonnilsson 排查后确认只需改 UA，并在 12 小时内发布了 **v4.0.3** 修复。

这件事真正暴露的风险是：这类工具依赖 Apple **未公开**的内部接口和「魔法字符串」，Apple 可以随时静默修改、没有任何预告，你就得跟着猜一次。本项目因此改走 Apple **公开文档化**的 Build Uploads API —— 接口契约是公开的，不受 User-Agent 这类隐形约定影响，只需一个 App Store Connect API 密钥即可上传：

```
POST /v1/buildUploads            # 登记一次构建上传
POST /v1/buildUploadFiles        # 获取对象存储预签名分块上传 URL
PUT  <presigned-url>             # 分块上传 IPA
PATCH /v1/buildUploadFiles/{id}  # 标记上传完成
→ Apple 自动解析出 build（TestFlight / 提审可用）
```

> 只是偶尔传个包？**ios-uploader v4.0.3 已经修好，继续用它完全没问题**。本项目面向要长期依赖上传流程的场景（CI 自动化、团队共用）。

In late October 2026, Apple quietly tightened the **User-Agent validation** on the legacy upload endpoint, breaking third-party uploaders with error `-22938`. The fix (shipped as ios-uploader v4.0.3 within 12 hours) was simply a UA change. The lesson: tools built on undocumented internal APIs and magic strings break whenever Apple changes something silently. This tool uses the **official, documented** Build Uploads API instead — the contract is public, with no hidden conventions to guess.

## 特性 / Features

- ✅ 零依赖（Node.js ≥ 18，只用内置模块）
- ✅ ES256 JWT 签名（API 密钥认证）
- ✅ 分块上传 + 进度显示（每个 API 调用自动重试瞬时 401）
- ✅ 上传前自动检查同版本 build 是否已存在（防止重复上传白忙活）
- ✅ 可选 `--release`：上传后自动创建 App Store 版本记录并关联 build
- ✅ 支持 Windows / macOS / Linux

## 准备 / Prerequisites

1. **App Store Connect API 密钥**（Team Key）：
   打开 [App Store Connect → 用户和访问 → 集成 → App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api) → 生成密钥（角色选 **App Manager** 或更高）→ 下载 `.p8` 文件（只能下载一次），并记下 **Key ID**、**Issuer ID** 和 `.p8` 路径。

2. **App ID**：App Store Connect 中你的 App 的数字 ID（URL 里 `apps/` 后面的数字，或用本工具 `--list-apps` 查询）。

3. Node.js ≥ 18。

## 用法 / Usage

```bash
# 列出团队下所有 App（查询 App ID）
asc-ipa-uploader --key ./AuthKey_XXXXXXXXXX.p8 --key-id XXXXXXXXXX --issuer <ISSUER_ID> --list-apps

# 上传 IPA（版本号 = CFBundleShortVersionString，build 号 = CFBundleVersion）
asc-ipa-uploader --key ./AuthKey_XXXXXXXXXX.p8 --key-id XXXXXXXXXX --issuer <ISSUER_ID> \
  --app <APP_ID> --ipa ./MyApp.ipa --version 1.2.5 --build 125

# 上传并直接创建版本记录、关联 build（之后去后台填更新说明提审即可）
asc-ipa-uploader ... --release
```

参数速查：

| 参数 | 说明 |
| --- | --- |
| `--key <path>` | `.p8` 私钥文件路径 |
| `--key-id <id>` | API 密钥 ID |
| `--issuer <uuid>` | Issuer ID |
| `--app <id>` | App 的数字 ID（或 `--list-apps` 查询） |
| `--ipa <path>` | IPA 文件路径 |
| `--version <x.y.z>` | App 版本号（CFBundleShortVersionString） |
| `--build <n>` | build 号（CFBundleVersion，同号不允许重复上传） |
| `--release` | 上传成功后自动创建版本记录并关联 build |
| `--list-apps` | 列出团队所有 App 及其 ID |

也支持环境变量：`ASC_KEY_PATH` / `ASC_KEY_ID` / `ASC_ISSUER` / `ASC_APP_ID`（命令行参数优先）。

## 常见问题 / FAQ

**Q: 报 `401 NOT_AUTHORIZED` 间歇性出现？**
A: 新创建的 API 密钥在 Apple 后端同步完全前会偶发 401，本工具已内置自动重试；若持续 401，请确认密钥角色为 App Manager 及以上、Key ID / Issuer ID 正确。

**Q: 上传成功但想再传一次同版本？**
A: Apple 不允许重复的 build 号，请升 build 号（如 125 → 126）再传。本工具上传前会自动检测并提示。

**Q: 和 ios-uploader 什么关系？**
A: 无关联，但受其启发（感谢 [@simonnilsson](https://github.com/simonnilsson/ios-uploader)）。ios-uploader 走的是 Apple 未公开的内部接口，已因 UA 变更失效过一次（v4.0.3 已修复）；本项目走官方公开 API，属于不同取舍：前者轻量、免 API 密钥，后者稳定、可长期依赖。

## 安全提醒 / Security

- **永远不要**把 `.p8` 私钥、Issuer ID 提交进仓库或发给他人；
- 建议用环境变量传入密钥路径，避免出现在 shell 历史里；
- 密钥泄露请立即在 App Store Connect 后台撤销（撤销即时生效）。

## License

[MIT](./LICENSE)
