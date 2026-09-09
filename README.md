# Catailor.github.io

基于 Hexo 8 / Butterfly 5.5 的个人博客。首页使用本地维护的「月下手记」布局，保留二次元插画，以电脑端阅读为主。

在线地址：[Catailor 的博客](https://catailor.github.io/)。完整教程：[使用与设置说明](docs/使用与设置说明.md)，包含写作、首页设置、图片、自动日夜模式和发布步骤。

## 本地预览

```sh
npm install
npm run server
```

打开 http://localhost:4000/。`npm run build` 生成静态文件到 `public/`。

## 修改首页

- `source/_data/moonlit.yml`：首页介绍、便笺、推荐文章，以及各篇文章在首页展示的标题、摘要、封面和分组。这里的展示标题不修改文章正文或原有链接。
- `layout/moonlit/index.pug`：首页布局。
- `source/css/moonlit.css`：日夜配色、电脑端布局、悬停和入场动画。
- `source/js/moonlit.js`：分类筛选、展开更多、日夜切换和轻微视差。
- `source/js/theme-clock.js`：按访客当地时间自动切换，06:00–18:00 为白天，其余为夜间；页面停留时也会检查时间。手动切换在当前时段内有效，到下个切换点恢复自动模式。
- `scripts/moonlit.js`：注册首页布局，读取实际文章。未单独配置的新文章也会自动出现；`diary` 分类进入日常，其他文章进入学习。

首页保留所有文章的静态链接，启用 JavaScript 后分批展示。归档页继续分页。导航的「学习手记」「生活碎片」支持直接链接到 `/#study`、`/#life`。

页面插画在 `source/img/moonlit/`，由原图压缩成 WebP，原图保留。需要重新生成时，安装 Pillow 后运行 `python tools/prepare-moonlit-images.py`；正常构建不需要 Python。

左下角点击「召唤琪露诺」才加载 Live2D。关闭时释放模型资源；使用固定版本的外部库，加载需网络。此前已结束的 2026-07-26 倒计时已从页面移除。系统开启「减少动态效果」时，首页关闭视差、入场和星光动画。

## 维护与发布

定制文件位于项目内，未修改 `node_modules`。首页通过 Pug 引入 Butterfly 的公共部分，升级主题后应重新检查首页与文章页。现有 GitHub Actions 在推送 `main` 后构建并发布；本地预览和构建本身不会发布。
