# ASC IPA Uploader

> 用 **App Store Connect 官方 API（Build Uploads）** 把 IPA 上传到 App Store Connect 的零依赖命令行工具。
> Zero-dependency CLI tool to upload IPAs to App Store Connect via the **official Build Uploads API**.

## 背景 / Background

2026 年 10 月底，Apple 在网关层（daiquiri `26HOTFIX47`）封禁了 `contentdelivery.itunes.apple.com` 上基于「Apple ID + App 专用密码」的登录通道（错误码 `-22938`）。所有依赖这条通道的第三方上传工具（ios-uploader、各类转运脚本等）**集体失效**，且换用 API 密钥签出的 JWT 也无法进入旧的内部上传通道。

本项目改走 Apple 官方 App Store Connect API 的 **Build Uploads** 流程（完全公开文档化的接口），只需一个 App Store Connect API 密钥即可上传：

```
POST /v1/buildUploads            # 登记一次构建上传
POST /v1/buildUploadFiles        # 获取对象存储预签名分块上传 URL
PUT  <presigned-url>             # 分块上传 IPA
PATCH /v1/buildUploadFiles/{id}  # 标记上传完成
→ Apple 自动解析出 build（TestFlight / 提审可用）
```

In late October 2026, Apple blocked app-specific-password authentication for the legacy content delivery upload service (error `-22938`), breaking all third-party IPA uploaders that relied on it. This tool uses the **official, documented** App Store Connect Build Uploads API instead — all you need is an App Store Connect API key.

## 特性 / Features

- ✅ 零依赖（Node.js ≥ 18，只用内置模块）
- ✅ ES256 JWT 签名（API 密钥认证）
- ✅ 分块上传 + 进度显示 + 断点友好（每个 API 调用自动重试瞬时 401）
- ✅ 上传前自动检查同版本 build 是否已存在（防止重复上传白忙活）
- ✅ 可选 `--release`：上传后自动创建 App Store 版本记录并关联 build
- ✅ 支持 Windows / macOS / Linux

## 准备 / Prerequisites

1. **App Store Connect API 密钥**（Team Key）：
   打开 [App Store Connect → 用户和访问 → 集成 → App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api) → 生成密钥（角色选 **App Manager** 或更高）→ 下载 `.p8` 文件（只能下载一次），并记下：
   - **Key ID**（如 `ABCD12345E`）
   - **Issuer ID**（UUID 格式）
   - `.p8` 私钥文件路径

2. **App ID**：App Store Connect 中你的 App 的数字 ID（URL 里 `apps/` 后面的数字，或用本工具 `--list-apps` 查询）。

3. Node.js ≥ 18。

## 用法 / Usage

```bash
# 列出团队下所有 App（查询 App ID）
node asc-ipa-uploader.mjs \
  --key ./AuthKey_XXXXXXXXXX.p8 --key-id XXXXXXXXXX --issuer <ISSUER_ID> \
  --list-apps

# 上传 IPA（版本号 = CFBundleShortVersionString，build 号 = CFBundleVersion）
node asc-ipa-uploader.mjs \
  --key ./AuthKey_XXXXXXXXXX.p8 --key-id XXXXXXXXXX --issuer <ISSUER_ID> \
  --app <APP_ID> --ipa ./MyApp.ipa --version 1.2.5 --build 125

# 上传并直接创建 1.2.5 版本记录、关联 build（之后去后台填更新说明提审即可）
node asc-ipa-uploader.mjs ... --release
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
A: 无关联。ios-uploader 曾是最好用的第三方上传工具（本项目受其启发，感谢 [@simonnilsson](https://github.com/simonnilsson/ios-uploader)），但它依赖的密码登录通道被 Apple 封禁后已不可用；本项目走官方 API，不依赖任何内部通道。

## 安全提醒 / Security

- **永远不要**把 `.p8` 私钥、Issuer ID 提交进仓库或发给他人；
- 建议用环境变量传入密钥路径，避免出现在 shell 历史里；
- 密钥泄露请立即在 App Store Connect 后台撤销（撤销即时生效）。

## License

[MIT](./LICENSE)
