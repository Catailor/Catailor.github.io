# Catailor.github.io · 月下手记

基于 Hexo 8 / Butterfly 5.5 的个人博客，首页与文章页使用项目内维护的「月下手记」布局：简洁的无衬线排版、中性灰白配一种淡紫强调色、日夜两套配色；首页保留整屏渐变插画首屏，下面只有精选和最近文章两块。

在线地址：[catailor.github.io](https://catailor.github.io/) · 订阅：[`/atom.xml`](https://catailor.github.io/atom.xml)

- 完整教程：[使用与设置说明](docs/使用与设置说明.md)（写作、首页、图片、日夜模式、发布、订阅、链接与留言）
- 写作台：[写作台使用说明](docs/写作台使用说明.md)
- 日语学习专栏：[专栏使用说明](docs/日语学习专栏.md)

## 常用命令

```sh
npm ci              # 安装依赖
npm run studio      # 打开本机写作台（推荐的写作方式）
npm run server      # 本地预览 http://localhost:4000/
npm run build       # 检查私人内容规则并生成 public/
npm test            # 单元测试
npm run test:browser  # 写作台浏览器测试（需先 npx playwright install chromium）
npm run japanese    # 新建今天的日语日记
npm run private     # 本机编写加密的私人手记
```

## 文件地图

| 想改什么 | 文件 |
| --- | --- |
| 文章标题、摘要、类型、主题、封面、精选、链接 | 文章开头的 front matter（写作台「文章设置」可改） |
| 首页介绍、留言区开关 | `source/_data/moonlit.yml` |
| 系列、专题、友链、碎碎念 | `source/_data/notebook.yml`（写作台「我的系列」可改） |
| 首页 / 导航 / 页脚 / 文章页布局 | `layout/moonlit/*.pug` |
| 配色与版式 | `source/css/moonlit.css`（配色变量、导航、首页）、`letter.css`（文章页结构）、`moonlight.css`（最后加载，统一的现代化修饰） |
| 交互 | `source/js/moonlit.js`（筛选、日夜、月相）、`letter.js`（阅读助手）、`theme-clock.js`（自动日夜） |
| 订阅、站点地图、旧地址跳转 | `scripts/feeds.js` |
| 首页数据整理 | `scripts/moonlit.js`、`scripts/notebook.js` |

## 发布

推送到 `main` 后，GitHub Actions 运行单元测试、构建并发布到 `gh-pages`。写作台的浏览器测试在单独的工作流里，只在 `tools/`、`tests/`、`lib/` 等相关文件变化或提交 PR 时运行，不拖慢日常发布。

私人文章只保存密文，请使用 `npm run private` 或写作台的「私人手记」入口，不要放进公开的 `source/_posts/`。

左下角点击「召唤琪露诺」才加载 Live2D；系统开启「减少动态效果」时，首页关闭视差和入场动画。
