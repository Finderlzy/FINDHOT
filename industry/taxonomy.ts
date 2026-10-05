// 这个行业（国际形势）的分类体系：类别、标签词表、国家与组织（主体）名录，以及防止张冠李戴的身份词典。
// 模型按这里的词表打标签，主题页（topics.json）按标签归类，筛选栏按类别分组。
// 换行业时：类别的 key 会出现在网址里（/all?category=…），上线后就不要再改；标签和名录可以随时增减。

/**
 * 网页上的类别（筛选栏、卡片角标、RSS 分类订阅）。key 是网址和接口里的身份，上线后不要改。
 * section 是日报里的分节标题（几个类别可以共用一节，按这里的顺序排）；guide 告诉结构抽取模型这一类收什么、
 * 和相邻类别的边界在哪（总的归类原则写在 prompts/structure.md 里）。
 * commentary 标出评论类（教程、观点）：日报写过的事又有评论类的后续报道，只占一行快讯（报道它的信源够多时除外）。
 * 没归上类的资料在日报里放进第一个 key 为 industry 的类别所在的节（没有就放最后一节）。
 * feedLabel 是分类 RSS 标题里的名字（不写就用 label）。公开接口、RSS 和 MCP 里要把一类并进另一类发布，写在站点设置里（site/site.ts 的 PUBLIC_CATEGORIES）。
 */
export const CATEGORIES = [
  { key: "diplomacy", label: "外交", feedLabel: "外交与大国关系", section: "大国关系与外交", guide: "国家之间的关系与往来：首脑会晤、外交表态、建交断交、协议与条约、国际组织的决议，以及会改变一国对外方向的大选、政权更替和重要人事。" },
  { key: "conflict", label: "冲突", feedLabel: "冲突与安全", section: "战争、冲突与安全", guide: "已发生的军事行动、袭击、停火与谈判进程、军事部署和演习、军控与核问题、恐怖袭击，以及战事造成的伤亡和人道危机。围绕停火的谈判也归这里，不归外交。" },
  { key: "economy", label: "经贸", feedLabel: "国际经贸与制裁", section: "国际经济与制裁", guide: "跨国的经济措施和后果：关税、贸易协定、制裁与反制裁、出口管制、能源与粮食供应、供应链转移、汇率与国际市场的重大波动。单个国家的国内经济数据只有影响到国际格局时才归这里。" },
  { key: "analysis", label: "分析", feedLabel: "分析与观点", section: "分析与观点", guide: "重点是作者的解释、判断、预测、背景解读或访谈观点。报道新发生的事实，即使带有评论口吻，也按事实所属的类别归类。", commentary: true },
] as const satisfies ReadonlyArray<{ key: string; label: string; feedLabel?: string; section: string; guide: string; commentary?: true }>;

/**
 * 这个行业最受关注的一类发布（AI 行业是新模型）：日报报头的“N 个新模型”、改分类后修订已出的报告都按它数。
 * category 是类别，tag 是标签，两者都对上才算；unit 接在数字后面。
 * 没有这样一类的行业设成 null，报头就不显示这个数。
 */
export const RELEASE: { category: string; tag: string; unit: string } | null = null;

/** 周报月报的总述可以直接写、不必在报道里找到出处的行业通用词（小写）。站名会自动算进去。 */
export const PLAIN_TERMS: readonly string[] = ["un", "nato", "eu", "g7", "g20", "imf", "wto", "opec", "gdp", "brics", "asean"];

/**
 * 内容理解一步给每篇资料判的“内容类型”（写在 prompts/content-understanding.md 里，改了类型要同步改那份提示词）。
 * 评分提示词（prompts/selection-score.md）按类型给五个维度不同的权重。
 */
export const ITEM_TYPES = ["conflict_security", "diplomatic_action", "economic_measure", "political_change", "opinion_analysis", "background_explainer"] as const;

// ── 标签词表 ────────────────────────────────────────────────────────────────────────────

/** 每篇资料的第一个标签必须是这些“分类标签”之一。 */
export const CATEGORY_TAGS = [
  "外交动态", "军事冲突", "安全/军控", "经贸/制裁", "政局/选举", "人道危机", "分析评论", "其他",
] as const;

/** 可选的主题标签：地区与议题。 */
export const TOPIC_TAGS = [
  "中美关系", "俄乌战争", "中东", "台海", "朝鲜半岛", "南海", "欧洲", "亚太", "非洲", "拉美",
  "能源", "关税", "核问题", "联合国",
] as const;

/** 可选的实体标签（国家、组织）。 */
export const ENTITY_TAGS = ["美国", "中国", "俄罗斯", "乌克兰", "欧盟", "以色列", "伊朗", "北约"] as const;

/** 模型常写的近义词，统一成词表里的写法。 */
export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  外交: "外交动态", 会晤: "外交动态", 峰会: "外交动态", 国际关系: "外交动态", 大国关系: "外交动态",
  冲突: "军事冲突", 战争: "军事冲突", 战事: "军事冲突", 军事: "军事冲突", 停火: "军事冲突", 袭击: "军事冲突",
  安全: "安全/军控", 军控: "安全/军控", 国防: "安全/军控", 恐怖袭击: "安全/军控",
  制裁: "经贸/制裁", 贸易: "经贸/制裁", 经贸: "经贸/制裁", 出口管制: "经贸/制裁", 经济: "经贸/制裁",
  选举: "政局/选举", 大选: "政局/选举", 政局: "政局/选举", 政治: "政局/选举",
  人道: "人道危机", 难民: "人道危机", 人道主义: "人道危机",
  分析: "分析评论", 评论: "分析评论", 观点: "分析评论", 解读: "分析评论",
  俄乌: "俄乌战争", 乌克兰战争: "俄乌战争", 巴以: "中东", 加沙: "中东", 台湾: "台海",
  核: "核问题", 核武器: "核问题", 石油: "能源", 天然气: "能源", 联合国安理会: "联合国",
  NATO: "北约", EU: "欧盟", 美方: "美国", 俄方: "俄罗斯", 中方: "中国", 乌方: "乌克兰",
};

// ── 国家与组织 ──────────────────────────────────────────────────────────────────────────

/**
 * 主体主题（这里是国家与国际组织）：id → 显示名、卡片上显示的标签（null 表示只用 entity:<id> 归类）、别名。
 * aliases 给结构抽取模型看；otherNames 是其他称呼，把事实的主体对到国家或组织时也认它们。
 */
export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[]; otherNames?: string[] }> = {
  us: { name: "美国", displayTag: "美国", aliases: ["美国", "United States", "US", "USA", "白宫", "White House"], otherNames: ["美国国务院", "State Department", "五角大楼", "Pentagon"] },
  china: { name: "中国", displayTag: "中国", aliases: ["中国", "China", "PRC", "北京"], otherNames: ["中国外交部", "Chinese Foreign Ministry"] },
  russia: { name: "俄罗斯", displayTag: "俄罗斯", aliases: ["俄罗斯", "Russia", "克里姆林宫", "Kremlin"] },
  ukraine: { name: "乌克兰", displayTag: "乌克兰", aliases: ["乌克兰", "Ukraine", "基辅", "Kyiv"] },
  eu: { name: "欧盟", displayTag: "欧盟", aliases: ["欧盟", "European Union", "EU", "欧盟委员会", "European Commission"] },
  israel: { name: "以色列", displayTag: "以色列", aliases: ["以色列", "Israel"] },
  iran: { name: "伊朗", displayTag: "伊朗", aliases: ["伊朗", "Iran", "德黑兰", "Tehran"] },
  nato: { name: "北约", displayTag: "北约", aliases: ["北约", "NATO"] },
  un: { name: "联合国", displayTag: null, aliases: ["联合国", "United Nations", "UN", "安理会", "Security Council"] },
  japan: { name: "日本", displayTag: null, aliases: ["日本", "Japan", "东京", "Tokyo"] },
  "north-korea": { name: "朝鲜", displayTag: null, aliases: ["朝鲜", "North Korea", "DPRK", "平壤", "Pyongyang"] },
  india: { name: "印度", displayTag: null, aliases: ["印度", "India", "新德里", "New Delhi"] },
};

/**
 * 身份词典：摘要和标题里出现的公司，必须在原文里也出现过，否则退回原标题、丢掉摘要（防止模型张冠李戴）。
 * 行业没有这个问题时可以留空数组。
 */
export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [];

/** 这些域名上的文章，发布方就是对应的公司（托管平台如 GitHub、arXiv 不算）。 */
export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [];

/** 原文里的这些写法也算提到了对应公司。 */
export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [];
