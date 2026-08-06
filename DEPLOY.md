# 云团子 · 部署到 Cloudflare Pages（PWA）

这是纯静态站点（`index.html` + `app.js` + `style.css` + `manifest.json` + `sw.js` + `icons/` + `sounds/`），无构建步骤。部署后国外用户打开链接即可用，还能「添加到主屏幕」当 App 用、离线也能打开。

智谱大模型 API 由浏览器直接请求（跨域），**不需要做 API 代理**——智谱接口已支持浏览器跨域调用。

---

## 一、准备

1. 注册 [Cloudflare 账号](https://dash.cloudflare.com/sign_up)（免费）。
2. 把本项目代码推到一个 GitHub / GitLab 仓库（公开或私库都行）。
   - 需要上传的文件：`index.html` `app.js` `style.css` `manifest.json` `sw.js`、`icons/` 整个目录、`sounds/` 整个目录、`favicon-32.png`。
   - `tools/` 是图标生成脚本，传不传都行（不影响运行）。

> 首次推送前可在本地起服务自测：
> ```bash
> python3 -m http.server 8766
> # 浏览器开 http://localhost:8766/  （注意：必须用 http/https，不能用 file://，否则 SW 不生效）
> ```

---

## 二、在 Cloudflare Pages 创建项目

1. 登录 Cloudflare Dashboard → 左侧 **Workers & Pages** → **创建** → **Pages** → **连接到 Git**。
2. 授权并选中你的仓库。
3. 填部署配置：
   - **项目名称**：`yuntuanzi`（会决定你的免费域名 `yuntuanzi.pages.dev`）
   - **生产分支**：`main`（或你的默认分支）
   - **框架预设**：`None`
   - **构建命令**：留空（无构建）
   - **构建输出目录**：`/`（根目录，表示仓库根就是站点根）
4. 点 **保存并部署**。1～2 分钟后拿到地址：`https://yuntuanzi.pages.dev`。

> 之后每次 `git push` 到 main，Cloudflare 会自动重新部署。

---

## 三、验证 PWA 是否生效

部署完成后，用 Chrome / Edge 打开 `https://yuntuanzi.pages.dev`：

1. **F12 → Application（应用）面板**：
   - `Manifest` 应显示「已识别」，能看到名称「云团子」和 4 个图标。
   - `Service Workers` 显示 `sw.js` 状态为 **activated and is running**。
2. **安装提示**：地址栏右侧出现「安装」图标，或菜单里有「安装 云团子…」。点一下就能装到桌面。
3. **离线测试**：F12 → Network 勾选 **Offline** → 刷新，页面仍能打开（核心外壳被 SW 缓存了）。
4. 可选：F12 → Lighthouse → 生成报告，PWA 类目应显示「可安装」。

---

## 四、（可选）绑定自己的域名

1. Pages 项目 → **自定义域** → **设置自定义域**。
2. 输入你的域名（如 `app.yourdomain.com`）。
3. 按提示在你的域名 DNS 处加一条 CNAME 指向 `yuntuanzi.pages.dev`（如果你域名也在 Cloudflare 托管，会自动配置）。
4. 等 SSL 证书签发完成（几分钟），即可用自定义域名访问。
   - 国外用户用自定义域名访问更稳、速度更好。

---

## 五、更新发版流程

改了代码后 `git push`，Cloudflare 自动重新部署。注意两点：

1. **改了 `app.js` / `style.css` 内容时**：把 `index.html` 里的版本号往上加（如 `app.js?v=54` → `app.js?v=55`），让浏览器拉新文件。
2. **想让用户立刻用上新版（不用等 SW 自动更新）时**：把 `sw.js` 里的 `CACHE_NAME` 从 `'yztz-static-v1'` 改成 `'yztz-static-v2'`。用户下次打开时新 SW 会清掉旧缓存、装入新文件。
   - 不改也行，SW 会在后台慢慢更新；改了只是更快让所有人拿到新版。

---

## 六、关于 API Key 与隐私

- 用户的智谱 API Key 只存在**各自手机浏览器的 localStorage**里，不写进代码、不上传到 Cloudflare、发给别人的链接里也看不到。
- 对话、记忆、小确幸等数据全在用户本地浏览器，服务器不存任何用户数据——纯静态托管，Cloudflare 只负责发文件。

---

## 文件清单速查

| 文件 | 作用 |
|------|------|
| `index.html` | 页面 + PWA meta + SW 注册 |
| `manifest.json` | PWA 清单（名称/图标/主题色） |
| `sw.js` | Service Worker，离线缓存 |
| `app.js` / `style.css` | 主逻辑与样式 |
| `icons/` | 应用图标（192/512 + maskable） |
| `favicon-32.png` | 浏览器标签图标（根目录） |
| `sounds/` | 白噪音 / 自然音音频 |
| `tools/make_icons.py` | 重新生成图标（可选，本机运行） |
