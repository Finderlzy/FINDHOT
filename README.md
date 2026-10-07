<p align="center">
  <img src="site/brand/logo.svg" alt="晨昏线的标志：一个按地轴倾斜的地球，一半是白天，一半是夜晚" width="112">
</p>

<h1 align="center">晨昏线</h1>

<p align="center">
  <b>早上读报，晚上看新闻。</b><br>
  一个每天替你挑国际新闻、出日报和晚报的中文网站。免费，不用注册。
</p>

<p align="center">
  <a href="https://terminator-line.de5.net"><b>打开晨昏线</b></a> ·
  <a href="https://terminator-line.de5.net/daily">今天的日报</a> ·
  <a href="https://terminator-line.de5.net/agent">RSS 与 Agent 接入</a> ·
  <a href="#自己跑一份">自己跑一份</a>
</p>

<br>

## 为什么做晨昏线

我是在洛杉矶长大的。小学的时候，我第一次意识到，世界不只有我生活的这一小块地方，不只有洛杉矶，也不只有美国。从那以后，我就一直对外面的世界很好奇。

中学的地理课，是我最常走神的时候。看着地图，我总在想，如果有一天能亲自站到那些地方，该多好。老师常在课上给我们放新闻，那是我第一次觉得，远方的事情和我有关系。那时我甚至想过，以后要像个老人那样，每天早上读报纸，晚上看新闻。

上了大学，这个习惯却没能长出来。我每天花很多时间刷 X、刷抖音，信息看了很多，世界却没有因此变得更清楚：推荐算法只给我它猜我想看的东西，划过去就忘了。偶尔点开 B 站 UP 主燕三嘤嘤嘤的视频，是少有的例外。他会把一件事从头讲到尾，讲清楚它在世界上处在什么位置。

后来有一天，我在 X 上刷到卡兹克开源了他的 [AIHOT](https://github.com/KKKKhazix/AIHOT)：一个自己盯信源、自己挑新闻、每天出日报的网站。那一刻，小学时对世界的好奇、地理课上的走神、想每天读报的念头，一下子都回来了。AIHOT 盯的是 AI 行业，我想要一个盯着整个世界的。

所以有了这个网站。我想要的不是更多的信息，而是一个每天都能读完、读完以后对世界多懂一点的习惯。

它叫「晨昏线」。晨昏线是地理课上学过的概念，是地球上白天和黑夜的分界线。这条线每天扫过整个地球，任何时候，都有地方正在天亮，也有地方正在天黑。晨昏线每天早上 8 点出一份日报，晚上 8 点出一份晚报，一边一份，就像我中学时想过的那样。

## 每天能看到什么

| | 是什么 | 什么时候 |
|---|---|---|
| **精选** | 从全部信源里挑出值得看的国际新闻，写好中文标题、摘要和一段 AI 导读，讲清楚这件事为什么值得在意 | 随时更新 |
| **热点榜** | 不同媒体在说的同一件事归成一个事件，按多少家在同时报道排名次 | 随时更新 |
| **日报** | 前一天晚上 8 点到当天早上 8 点的消息，按栏目编好 | 每天 08:00 |
| **晚报** | 当天早上 8 点到晚上 8 点的消息，和日报不重复 | 每天 20:00 |
| **专题报** | 挑一个最近热闹的国家或地区，把这几周发生的事串成一篇长文，每章都附上引用的报道 | 每周三、六 12:00 |
| **主题** | 按国家与组织（美国、俄罗斯、欧盟、北约……）、地区与议题（中东局势、台海、关税与贸易战……）看最新动态 | 随时更新 |

时间都是北京时间。不想打开网页的话，也可以用 RSS 订阅，或者把晨昏线接进你的 AI 助手：MCP 地址是 `https://terminator-line.de5.net/api/mcp`，工具名以 `terminator_line_` 开头，具体接法在网站的 [Agent 接入](https://terminator-line.de5.net/agent) 页。

## 新闻从哪里来

目前盯着 14 个信源：

- **国际组织与智库**：UN News、International Crisis Group
- **英文媒体**：BBC News World、The Guardian World、New York Times World、NPR World、Al Jazeera、France 24、DW World、The Diplomat、Foreign Policy
- **中文媒体**：环球网（国际频道）、参考消息（国际、军事）

网站只展示中文摘要和原文链接，原文的版权归各家媒体。如果你是来源方，希望更正、下架或调整展示方式，可以在网站的 [反馈页](https://terminator-line.de5.net/feedback) 联系我。

## 它是怎么工作的

1. **收集**：定时检查每个信源，更新越勤的看得越勤，最快 15 分钟一次。
2. **筛选**：大模型先判断是不是国际新闻、有没有实际信息，营销稿和重复转发直接拦下；留下的再独立打分，过了门槛才进精选。
3. **写作**：给精选写中文标题、摘要和 AI 导读。导读的口吻向燕三学习：先讲清楚发生了什么，再讲它为什么重要。
4. **归组**：不同媒体说的同一件事归成一个事件，热点榜由此算出。
5. **出刊**：到点按时间窗口编出日报和晚报；专题报由模型从近两周有新闻的国家和地区里打分选题，没有够格的选题，这一期就空着。

读者打开网页不会触发任何模型调用，模型只在后台的定时任务里工作。

## 自己跑一份

晨昏线是在 AIHOT 开源框架上改出来的，你也可以跑一份自己的。需要 [Docker](https://docs.docker.com/get-started/get-docker/)、[Node.js 24](https://nodejs.org/en/download)，以及一个 OpenAI 兼容的模型 API Key（DeepSeek、千问、智谱都可以）：

```bash
git clone https://github.com/Finderlzy/terminator-line.git
cd terminator-line
node scripts/init-env.ts --llm-key <你的模型 API Key>
docker compose up -d --build
```

打开 <http://localhost:3000>，后台在 `/admin`，管理员密码在 `.env` 的 `ADMIN_PASSWORD` 里。一两分钟后开始有内容。

想改成别的主题，站名、文案和品牌在 [`site/`](site/)，分类、主题、信源和提示词在 [`industry/`](industry/)。步骤见 [把它改成你的主题](docs/customize.md)，部署到服务器见 [部署](docs/deploy.md)。

提醒一句：在 1 GB 内存的服务器上构建前端会很吃力，构建时先把 api、web、worker 停掉，腾出内存。

## 文档

| 文档 | 内容 |
|---|---|
| [把它改成你的主题](docs/customize.md) | 站名、分类、主题、信源、提示词、门槛、模型、品牌 |
| [信源](docs/sources.md) | 信源怎么配，抓取频率，全文与摘要 |
| [精选与校准](docs/selection.md) | 一条消息怎么变成精选、怎么编进日报、晚报和专题报 |
| [事件归组](docs/grouping.md) | 同一件事怎么归到一起 |
| [部署](docs/deploy.md) | Docker、域名和 HTTPS、更新、备份，以及每次更新要注意的事 |
| [架构](docs/architecture.md) | 进程、目录、模块、数据库迁移、对外出口、测试 |

技术栈：Node.js 24 · TypeScript · React Router · Fastify · PostgreSQL · Tailwind CSS · Docker Compose。

## 致谢

- [数字生命卡兹克](https://github.com/KKKKhazix) 的 [AIHOT](https://github.com/KKKKhazix/AIHOT)：晨昏线的引擎和框架都来自这里。谢谢他把它开源出来，让我这样的人也能做一个自己的新闻站。
- B 站 UP 主燕三嘤嘤嘤：晨昏线的选题和导读口吻都在向他学习。晨昏线与他本人没有任何关系。

## 许可

代码以 [MIT 许可](LICENSE) 发布，原框架的版权归数字生命卡兹克所有。「AIHOT」的名字和标志不在 MIT 许可范围内，第三方字体等材料的许可见 [NOTICE](NOTICE)。

「晨昏线」的名字和地球标志属于本站。你跑自己的站时，请换上自己的名字和标志。
