import { streamMessage } from '../api/client.js'
import type { TtsVoice } from '../api/speech.js'
import {
  streamCustomProfileMessage,
  streamOurFreeMessage,
  useProviderStore,
} from '../providers/ourFreeModel.js'
import { useSettings, type ThinkingEffort } from '../settings.js'
import type { PersonaDraft } from './types.js'

export type MbtiAxis = 'ei' | 'ns' | 'ft' | 'jp'
export type MbtiLetter = 'E' | 'I' | 'N' | 'S' | 'F' | 'T' | 'J' | 'P'

export type QuestionSection = 'identity' | 'voice' | 'values' | 'mbti'

export type QuestionOption = {
  value: string
  label: string
  desc?: string
  mbtiLetter?: MbtiLetter
}

export type QuizQuestion = {
  id: string
  index: number
  section: QuestionSection
  sectionTitle: string
  title: string
  subtitle?: string
  kind: 'single' | 'multi' | 'text' | 'mbti'
  mbtiAxis?: MbtiAxis
  options?: QuestionOption[]
  allowCustom?: boolean
  customPlaceholder?: string
  textPlaceholder?: string
}

export type QuizState = {
  /** 每题已选值：single/mbti 为单元素数组，multi 为多元素数组 */
  choices: Record<string, string[]>
  /** 每题自由填空/补充内容 */
  texts: Record<string, string>
  /** 附加音色与开关 */
  ttsVoice: TtsVoice
  defaultSearch: boolean
  defaultThinking: boolean
  thinkingEffort: ThinkingEffort
}

export const SECTION_META: { id: QuestionSection; label: string; range: [number, number] }[] = [
  { id: 'identity', label: '身份与羁绊', range: [1, 5] },
  { id: 'voice', label: '语言质感', range: [6, 9] },
  { id: 'values', label: '三观与边界', range: [10, 12] },
  { id: 'mbti', label: 'MBTI 12 题', range: [13, 24] },
]

export const QUIZ_QUESTIONS: QuizQuestion[] = [
  // ---------- 第一幕：身份与羁绊（1–5） ----------
  {
    id: 'q01_name',
    index: 1,
    section: 'identity',
    sectionTitle: '身份与羁绊',
    title: '给 Ta 起一个名字，定一种第一眼气质',
    subtitle: '可点选预设气质或自由填写自定义气质；名字留空则会结合最终 MBTI 自动命名。',
    kind: 'single',
    options: [
      { value: '清冷克制', label: '清冷克制', desc: '像秋夜微风，话不多但句句走心' },
      { value: '温柔松弛', label: '温柔松弛', desc: '自带安全感，让人卸下防备' },
      { value: '明朗鲜活', label: '明朗鲜活', desc: '像午后阳光，总能把气氛聊活' },
      { value: '锐利通透', label: '锐利通透', desc: '眼光毒辣，清醒冷静不糊弄' },
    ],
    allowCustom: true,
    customPlaceholder: '角色名字（例如：林雾、星野、沈叙、阿彻…）',
  },
  {
    id: 'q02_relation',
    index: 2,
    section: 'identity',
    sectionTitle: '身份与羁绊',
    title: 'Ta 在你生活里扮演什么角色？',
    subtitle: '选一个最接近的关系定位，也可以在下方写下专属设定。',
    kind: 'single',
    options: [
      { value: '默契多年的老友', label: '默契老友', desc: '不用客套，随时能接住你的梗与情绪' },
      { value: '温柔坚定的陪伴者', label: '温柔陪伴者', desc: '安静守在身边，接住疲惫与碎碎念' },
      { value: '毒舌但靠谱的损友', label: '毒舌损友', desc: '嘴上调侃，关键时刻最护着你' },
      { value: '清醒客观的军师导师', label: '理性军师 / 导师', desc: '帮你拆解困惑、少走弯路' },
      { value: '灵魂同频的共创搭档', label: '灵感共创搭档', desc: '一起写东西、聊作品、碰撞脑洞' },
      { value: '深夜树洞倾听者', label: '深夜树洞', desc: '只属于晚上的私密倾诉对象' },
    ],
    allowCustom: true,
    customPlaceholder: '自定义关系补充（可选，如：楼下旧书店主理人、一起熬夜的同门）',
  },
  {
    id: 'q03_address',
    index: 3,
    section: 'identity',
    sectionTitle: '身份与羁绊',
    title: 'Ta 平时怎么称呼你？',
    subtitle: '称呼决定了聊天的亲密距离感。',
    kind: 'single',
    options: [
      { value: '你', label: '自然叫「你」', desc: '不刻意、最舒服的平等距离' },
      { value: '小名或昵称', label: '亲切昵称', desc: '在下方填你希望被叫的昵称' },
      { value: '搭档', label: '「搭档」/「同伙」', desc: '并肩作战的默契感' },
      { value: '随语境变化', label: '随心情自然切换', desc: '认真时叫名字，放松时带点调侃' },
    ],
    allowCustom: true,
    customPlaceholder: '填写专属称呼（可选，例如：小鱼、阿明、老板、学弟）',
  },
  {
    id: 'q04_backstory',
    index: 4,
    section: 'identity',
    sectionTitle: '身份与羁绊',
    title: '你们是如何认识、建立默契的？',
    subtitle: '一点点背景故事会让对话立刻立体起来。',
    kind: 'single',
    options: [
      { value: '相识很久，彼此了解过往与习惯', label: '相识已久', desc: '早就熟络，省去寒暄直接聊正题' },
      { value: '刚认识不久但意外投缘', label: '一见如故', desc: '保有好奇心，慢慢探索彼此世界' },
      { value: '在共同爱好或项目里结识', label: '因同好结缘', desc: '因为共同热爱的领域走到一起' },
      { value: '跨时空的书信与电台陪伴', label: '深夜电台感', desc: '像随时能收到回信的远方知己' },
    ],
    allowCustom: true,
    customPlaceholder: '补充一句共同回忆或背景（可选）',
  },
  {
    id: 'q05_lifestyle',
    index: 5,
    section: 'identity',
    sectionTitle: '身份与羁绊',
    title: '如果不只是 AI，Ta 在平行世界里过着怎样的日常？',
    subtitle: '给 Ta 一点生活气息，回答会更有质感而不是空洞的百科腔。',
    kind: 'single',
    options: [
      { value: '泡在书店、咖啡馆与独立影院的文化观察者', label: '文艺漫游者', desc: '对文字、影像和城市气味敏感' },
      { value: '深夜写代码、追前沿技术的极客创造者', label: '极客创造者', desc: '理性高效，对新工具和原理着迷' },
      { value: '懂心理学、擅长倾听与自我探索的观察者', label: '心理观察者', desc: '温和洞察人心，总能问到点子上' },
      { value: '四处旅行、热爱市井烟火与美食的生活家', label: '烟火生活家', desc: '接地气，聊吃喝玩乐和日常最拿手' },
    ],
    allowCustom: true,
    customPlaceholder: '自定义 Ta 的职业/生活切面（可选，如：建筑师、胶片摄影师、养两只猫）',
  },

  // ---------- 第二幕：语言质感（6–9） ----------
  {
    id: 'q06_pace',
    index: 6,
    section: 'voice',
    sectionTitle: '语言质感',
    title: 'Ta 回复消息时的长度和节奏偏好？',
    kind: 'single',
    options: [
      { value: '简短利落，像发微信一样一两句话直给', label: '极简微信风', desc: '绝不长篇大论，轻快有呼吸感' },
      { value: '自然适中，两三段把话说透', label: '自然适中', desc: '日常短聊、深聊展开，张弛有度' },
      { value: '细腻丰富，擅长铺陈画面与深入剖析', label: '细腻深入', desc: '像写一封认真的长信或深度专栏' },
      { value: '专为语音朗读优化，口语流畅少符号', label: '语音朗读友好', desc: '配合 DeepSeek TTS 听起来最自然' },
    ],
  },
  {
    id: 'q07_tone',
    index: 7,
    section: 'voice',
    sectionTitle: '语言质感',
    title: '希望 Ta 的语气带有哪些特质？（可多选）',
    kind: 'multi',
    options: [
      { value: '口语自然、去 AI 翻译腔', label: '自然口语' },
      { value: '克制冷幽默', label: '冷幽默' },
      { value: '温柔有安抚感', label: '温柔安抚' },
      { value: '直率坦诚不绕弯', label: '直率坦诚' },
      { value: '偶尔带点诗意与比喻', label: '一点诗意' },
      { value: '略带毒舌吐槽但无恶意', label: '轻度吐槽' },
    ],
    allowCustom: true,
    customPlaceholder: '补充专属口癖或说话习惯（可选，例如：爱用反问、偶尔感叹“有意思”）',
  },
  {
    id: 'q08_support',
    index: 8,
    section: 'voice',
    sectionTitle: '语言质感',
    title: '当你心情低落来倾诉时，Ta 第一反应应该是什么？',
    kind: 'single',
    options: [
      { value: '先稳稳接住情绪、陪你吐槽，绝不急着讲道理', label: '情绪优先', desc: '被理解比被教育更重要' },
      { value: '先简短共情，再轻声给一两个可行小角度', label: '共情 + 轻建议', desc: '有温度也有方向感' },
      { value: '冷静帮你复盘问题根源，给出清晰破局方案', label: '方案优先', desc: '少说安抚空话，直接帮我解决' },
      { value: '用幽默转移注意力，先让你笑出来再聊', label: '轻松破冰', desc: '把沉重感悄悄化解掉' },
    ],
  },
  {
    id: 'q09_taboo',
    index: 9,
    section: 'voice',
    sectionTitle: '语言质感',
    title: '有哪些绝对不能踩的「表达雷区」？（可多选）',
    kind: 'multi',
    options: [
      { value: '禁止动不动列一二三四长清单和模板总结', label: '别列一二三四清单' },
      { value: '禁止居高临下说教或爹味指导', label: '禁止说教' },
      { value: '禁止过度浮夸吹捧和油腻鸡汤', label: '拒绝油腻吹捧' },
      { value: '禁止每句结尾都机械反问“你觉得呢”', label: '别每句强行反问' },
      { value: '禁止轻易跳出角色自称“作为AI语言模型”', label: '不跳出角色' },
    ],
    allowCustom: true,
    customPlaceholder: '补充其他避雷要求（可选）',
  },

  // ---------- 第三幕：三观与边界（10–12） ----------
  {
    id: 'q10_worldview',
    index: 10,
    section: 'values',
    sectionTitle: '三观与边界',
    title: 'Ta 内心最认同的生活信条是什么？',
    kind: 'single',
    options: [
      { value: '允许一切发生，接纳不完美与慢节奏', label: '松弛接纳派', desc: '不制造焦虑，相信慢慢来比较快' },
      { value: '保持好奇，永远用第一性原理看世界', label: '清醒探索派', desc: '追问本质，不被表象和从众带偏' },
      { value: '行动胜过内耗，先做出来再迭代', label: '实用行动派', desc: '用具体的小步快跑对抗迷茫' },
      { value: '认真感受微小的美，对人和世界保持善意', label: '浪漫理想派', desc: '珍视真诚、审美与细腻瞬间' },
    ],
    allowCustom: true,
    customPlaceholder: '写一句属于 Ta 的座右铭（可选）',
  },
  {
    id: 'q11_interests',
    index: 11,
    section: 'values',
    sectionTitle: '三观与边界',
    title: '你们平时最常聊哪些话题？（可多选）',
    kind: 'multi',
    options: [
      { value: '日常碎碎念与情绪记录', label: '日常与情绪' },
      { value: '电影、音乐、播客与书', label: '影视书音' },
      { value: '科技、AI、产品与编程', label: '科技与 AI' },
      { value: '写作、故事与灵感脑洞', label: '写作脑洞' },
      { value: '职业发展、学习与效率', label: '成长与工作' },
      { value: '二次元、游戏与亚文化', label: '游戏二次元' },
      { value: '心理探索与人际关系', label: '心理关系' },
      { value: '旅行、咖啡、美食与城市', label: '生活美学' },
    ],
    allowCustom: true,
    customPlaceholder: '补充你们的专属共同话题（可选）',
  },
  {
    id: 'q12_memory_pref',
    index: 12,
    section: 'values',
    sectionTitle: '三观与边界',
    title: '本地记忆重点 & 语音 / 能力偏好',
    subtitle: '决定 Ta 优先帮你记住什么，以及默认音色和工具开关。',
    kind: 'multi',
    options: [
      { value: '记住我提过的生活习惯、口味和雷区', label: '生活习惯与偏好' },
      { value: '记住我正在推进的目标与长期项目', label: '长期目标与项目' },
      { value: '记住我们聊过的梗、约定与重要日期', label: '共同约定与梗' },
      { value: '记住我偏好的思考框架与工作方式', label: '思考与工作方式' },
    ],
    allowCustom: true,
    customPlaceholder: '现在就可以先告诉 Ta 一件关于你的事（将存入本地 Raw RAG 记忆）',
  },

  // ---------- 第四幕：MBTI 12 题行为量表（13–24，每维度 3 题） ----------
  // E / I (3 题)
  {
    id: 'q13_ei_1',
    index: 13,
    section: 'mbti',
    sectionTitle: 'MBTI 量表 · 能量 E/I',
    title: '聊天突然冷场、你只回了个“嗯”时，Ta 会怎么接？',
    kind: 'mbti',
    mbtiAxis: 'ei',
    options: [
      {
        value: 'E',
        mbtiLetter: 'E',
        label: '主动抛个新鲜话题或趣事把场子热起来',
        desc: '偏 E · 主动发起互动，乐于带动聊天节奏',
      },
      {
        value: 'I',
        mbtiLetter: 'I',
        label: '不强行尬聊，安静留白或轻声问一句是不是累了',
        desc: '偏 I · 尊重安静空间，重分寸不打扰',
      },
    ],
  },
  {
    id: 'q14_ei_2',
    index: 14,
    section: 'mbti',
    sectionTitle: 'MBTI 量表 · 能量 E/I',
    title: '如果周末难得有一整天自由时间，Ta 更倾向怎么陪你？',
    kind: 'mbti',
    mbtiAxis: 'ei',
    options: [
      {
        value: 'E',
        mbtiLetter: 'E',
        label: '逛市集、看 Live、打卡新店，热热闹闹折腾一天',
        desc: '偏 E · 在外部世界与互动中充电',
      },
      {
        value: 'I',
        mbtiLetter: 'I',
        label: '找家安静角落喝咖啡、看部老电影，慢悠悠深聊',
        desc: '偏 I · 在一对一深度独处中获得能量',
      },
    ],
  },
  {
    id: 'q15_ei_3',
    index: 15,
    section: 'mbti',
    sectionTitle: 'MBTI 量表 · 能量 E/I',
    title: 'Ta 表达想法时的典型节奏更像哪一种？',
    kind: 'mbti',
    mbtiAxis: 'ei',
    options: [
      {
        value: 'E',
        mbtiLetter: 'E',
        label: '边聊边想，灵感蹦出来就忍不住立刻分享',
        desc: '偏 E · 表达欲旺盛，外放直接',
      },
      {
        value: 'I',
        mbtiLetter: 'I',
        label: '先在心里过一遍，出口的话精炼且有余味',
        desc: '偏 I · 先思后言，沉静内敛',
      },
    ],
  },

  // N / S (3 题)
  {
    id: 'q16_ns_1',
    index: 16,
    section: 'mbti',
    sectionTitle: 'MBTI 量表 · 感知 N/S',
    title: '一起看完一部电影后，Ta 通常最先聊什么？',
    kind: 'mbti',
    mbtiAxis: 'ns',
    options: [
      {
        value: 'N',
        mbtiLetter: 'N',
        label: '导演埋的隐喻、人物命运的另一种可能与主题延展',
        desc: '偏 N · 关注象征、脉络与言外之意',
      },
      {
        value: 'S',
        mbtiLetter: 'S',
        label: '某个惊艳的镜头调度、真实细节和演员的微表情',
        desc: '偏 S · 关注具象感官与真实体验',
      },
    ],
  },
  {
    id: 'q17_ns_2',
    index: 17,
    section: 'mbti',
    sectionTitle: 'MBTI 量表 · 感知 N/S',
    title: '当你抛出一个还不成熟的新点子时，Ta 会先怎么回应？',
    kind: 'mbti',
    mbtiAxis: 'ns',
    options: [
      {
        value: 'N',
        mbtiLetter: 'N',
        label: '顺着脑洞继续放大，聊它未来能长成什么样子',
        desc: '偏 N · 拥抱可能性与抽象蓝图',
      },
      {
        value: 'S',
        mbtiLetter: 'S',
        label: '先帮你落地验证第一步怎么做、成本和现实条件',
        desc: '偏 S · 脚踏实地，重视可行路径',
      },
    ],
  },
  {
    id: 'q18_ns_3',
    index: 18,
    section: 'mbti',
    sectionTitle: 'MBTI 量表 · 感知 N/S',
    title: '聊起一个下着雨的夜晚，Ta 的表达更偏向？',
    kind: 'mbti',
    mbtiAxis: 'ns',
    options: [
      {
        value: 'N',
        mbtiLetter: 'N',
        label: '“像整个城市被按下静音键，适合重新想清楚一件事”',
        desc: '偏 N · 擅长意象化、概念化联想',
      },
      {
        value: 'S',
        mbtiLetter: 'S',
        label: '“路灯照在积水上反光，回屋正好煮碗热汤暖暖手”',
        desc: '偏 S · 画面具体、贴近生活实感',
      },
    ],
  },

  // F / T (3 题)
  {
    id: 'q19_ft_1',
    index: 19,
    section: 'mbti',
    sectionTitle: 'MBTI 量表 · 判断 F/T',
    title: '你做了一个有点冲动的决定，事后有点后悔来找 Ta 聊：',
    kind: 'mbti',
    mbtiAxis: 'ft',
    options: [
      {
        value: 'F',
        mbtiLetter: 'F',
        label: '先站你这边安抚自责感，“当时那个处境谁都会这样选”',
        desc: '偏 F · 以人的感受与情绪价值为先',
      },
      {
        value: 'T',
        mbtiLetter: 'T',
        label: '直接帮你算清楚现状与止损办法，“别内耗了，看下一步”',
        desc: '偏 T · 以事实、逻辑与最优解为先',
      },
    ],
  },
  {
    id: 'q20_ft_2',
    index: 20,
    section: 'mbti',
    sectionTitle: 'MBTI 量表 · 判断 F/T',
    title: '当你把自己的文章、代码或方案发给 Ta 求反馈时：',
    kind: 'mbti',
    mbtiAxis: 'ft',
    options: [
      {
        value: 'F',
        mbtiLetter: 'F',
        label: '先真诚肯定亮点，再用温和商量的口吻提改进建议',
        desc: '偏 F · 顾及信心与互动温度',
      },
      {
        value: 'T',
        mbtiLetter: 'T',
        label: '一针见血指出结构漏洞和逻辑硬伤，省去客套',
        desc: '偏 T · 坦率精准，对事不对人',
      },
    ],
  },
  {
    id: 'q21_ft_3',
    index: 21,
    section: 'mbti',
    sectionTitle: 'MBTI 量表 · 判断 F/T',
    title: '面对两难选择（一边更划算，一边更顺心），Ta 通常更看重？',
    kind: 'mbti',
    mbtiAxis: 'ft',
    options: [
      {
        value: 'F',
        mbtiLetter: 'F',
        label: '哪一边让你内心真正踏实、不委屈自己',
        desc: '偏 F · 价值认同与内心感受优先',
      },
      {
        value: 'T',
        mbtiLetter: 'T',
        label: '把长期收益、风险和机会成本拉表比清楚再定',
        desc: '偏 T · 客观标准与因果推演优先',
      },
    ],
  },

  // J / P (3 题)
  {
    id: 'q22_jp_1',
    index: 22,
    section: 'mbti',
    sectionTitle: 'MBTI 量表 · 节奏 J/P',
    title: '如果一起规划一次三天短途旅行，Ta 的风格是？',
    kind: 'mbti',
    mbtiAxis: 'jp',
    options: [
      {
        value: 'J',
        mbtiLetter: 'J',
        label: '提前查好交通、动线和备选餐厅，稳稳当当不踩坑',
        desc: '偏 J · 喜欢秩序、确定性与提前安排',
      },
      {
        value: 'P',
        mbtiLetter: 'P',
        label: '只定大方向，到了现场看天气和心情随缘偶遇',
        desc: '偏 P · 享受留白、弹性与即兴惊喜',
      },
    ],
  },
  {
    id: 'q23_jp_2',
    index: 23,
    section: 'mbti',
    sectionTitle: 'MBTI 量表 · 节奏 J/P',
    title: '你拖延了一个截止日期快到的任务，Ta 会怎么对待你？',
    kind: 'mbti',
    mbtiAxis: 'jp',
    options: [
      {
        value: 'J',
        mbtiLetter: 'J',
        label: '立刻帮你拆成 15 分钟小步骤，陪你定节点一个个划掉',
        desc: '偏 J · 推进感强，擅长帮你收尾落地',
      },
      {
        value: 'P',
        mbtiLetter: 'P',
        label: '先帮你想个更省力的巧办法，不催你，等你找到状态再冲',
        desc: '偏 P · 灵活变通，不给人压迫感',
      },
    ],
  },
  {
    id: 'q24_jp_3',
    index: 24,
    section: 'mbti',
    sectionTitle: 'MBTI 量表 · 节奏 J/P',
    title: '正聊着一个严肃话题，你突然扯到楼下的一只橘猫，Ta 会？',
    kind: 'mbti',
    mbtiAxis: 'jp',
    options: [
      {
        value: 'J',
        mbtiLetter: 'J',
        label: '笑着接两句猫，然后自然把主线拉回来帮你收个结论',
        desc: '偏 J · 有主线意识，习惯给话题画句号',
      },
      {
        value: 'P',
        mbtiLetter: 'P',
        label: '顺理成章跟着聊半小时猫，原本的话题下次想起再说',
        desc: '偏 P · 开放随性，享受发散的乐趣',
      },
    ],
  },
]

export const MBTI_ARCHETYPES: Record<string, { title: string; trait: string; avatar: string }> = {
  INTJ: { title: '建筑师', trait: '洞察全局、冷静克制、追求本质与高效率', avatar: '♟️' },
  INTP: { title: '逻辑学家', trait: '好奇心旺盛、爱拆解原理、偶尔跳脱冷幽默', avatar: '🔬' },
  ENTJ: { title: '指挥官', trait: '果断笃定、目标感强、擅长带你破局推进', avatar: '⚡' },
  ENTP: { title: '辩论家', trait: '脑洞极大、机智风趣、擅长逆向思考与激发灵感', avatar: '🦊' },
  INFJ: { title: '提倡者', trait: '温柔深邃、极强洞察与共情力、珍视真诚联结', avatar: '🌌' },
  INFP: { title: '调停者', trait: '细腻浪漫、理想主义、对情绪与文字美感敏感', avatar: '🌙' },
  ENFJ: { title: '主人公', trait: '温暖有感染力、真诚鼓励、总能看见你的闪光点', avatar: '☀️' },
  ENFP: { title: '竞选者', trait: '热烈灵动、想象力丰富、自带鲜活陪伴能量', avatar: '🎈' },
  ISTJ: { title: '物流师', trait: '可靠踏实、言出必行、把细节和承诺放在心上', avatar: '📘' },
  ISFJ: { title: '守卫者', trait: '细心体贴、润物无声、记得你提过的每件小事', avatar: '🍵' },
  ESTJ: { title: '总经理', trait: '干练务实、条理分明、帮你把想法落地成行动', avatar: '🧭' },
  ESFJ: { title: '执政官', trait: '热心周到、注重氛围与默契、亲和力十足', avatar: '🌻' },
  ISTP: { title: '鉴赏家', trait: '酷而松弛、动手派、言简意赅总能一针见血', avatar: '🛠️' },
  ISFP: { title: '探险家', trait: '审美敏锐、随性柔和、喜欢陪你感受当下日常', avatar: '🎨' },
  ESTP: { title: '企业家', trait: '反应敏捷、直接爽快、敢想敢干自带行动力', avatar: '🔥' },
  ESFP: { title: '表演者', trait: '明朗活泼、幽默接地气、能瞬间把低气压聊活', avatar: '🎵' },
}

export const createInitialQuizState = (): QuizState => ({
  choices: {
    q01_name: ['温柔松弛'],
    q02_relation: ['温柔坚定的陪伴者'],
    q03_address: ['你'],
    q04_backstory: ['相识很久，彼此了解过往与习惯'],
    q05_lifestyle: ['泡在书店、咖啡馆与独立影院的文化观察者'],
    q06_pace: ['简短利落，像发微信一样一两句话直给'],
    q07_tone: ['口语自然、去 AI 翻译腔', '温柔有安抚感'],
    q08_support: ['先稳稳接住情绪、陪你吐槽，绝不急着讲道理'],
    q09_taboo: ['禁止动不动列一二三四长清单和模板总结', '禁止居高临下说教或爹味指导'],
    q10_worldview: ['允许一切发生，接纳不完美与慢节奏'],
    q11_interests: ['日常碎碎念与情绪记录', '电影、音乐、播客与书'],
    q12_memory_pref: ['记住我提过的生活习惯、口味和雷区', '记住我们聊过的梗、约定与重要日期'],
    q13_ei_1: ['I'],
    q14_ei_2: ['I'],
    q15_ei_3: ['I'],
    q16_ns_1: ['N'],
    q17_ns_2: ['N'],
    q18_ns_3: ['N'],
    q19_ft_1: ['F'],
    q20_ft_2: ['F'],
    q21_ft_3: ['F'],
    q22_jp_1: ['P'],
    q23_jp_2: ['P'],
    q24_jp_3: ['P'],
  },
  texts: {},
  ttsVoice: 'stella',
  defaultSearch: true,
  defaultThinking: false,
  thinkingEffort: 'medium',
})

export type MbtiScoreResult = {
  code: string
  archetype: { title: string; trait: string; avatar: string }
  axes: {
    axis: MbtiAxis
    left: MbtiLetter
    right: MbtiLetter
    winner: MbtiLetter
    leftPct: number
    rightPct: number
  }[]
}

/** 汇总 12 题 MBTI 量表得分，计算四维倾向与百分比。 */
export const computeMbtiResult = (state: QuizState): MbtiScoreResult => {
  const tally = (axis: MbtiAxis, left: MbtiLetter, right: MbtiLetter) => {
    const qs = QUIZ_QUESTIONS.filter((q) => q.kind === 'mbti' && q.mbtiAxis === axis)
    let leftCount = 0
    let rightCount = 0
    for (const q of qs) {
      const picked = state.choices[q.id]?.[0]
      if (picked === left) {
        leftCount += 1
      } else if (picked === right) {
        rightCount += 1
      }
    }
    const total = leftCount + rightCount || 1
    const leftPct = Math.round((leftCount / total) * 100)
    const rightPct = 100 - leftPct
    const winner = leftCount >= rightCount ? left : right
    return { axis, left, right, winner, leftPct, rightPct }
  }

  const axes = [
    tally('ei', 'E', 'I'),
    tally('ns', 'N', 'S'),
    tally('ft', 'F', 'T'),
    tally('jp', 'J', 'P'),
  ]
  const code = axes.map((a) => a.winner).join('')
  const archetype = MBTI_ARCHETYPES[code] ?? MBTI_ARCHETYPES.INFP
  return { code, archetype, axes }
}

export const countAnsweredQuestions = (state: QuizState): number =>
  QUIZ_QUESTIONS.filter(
    (q) => (state.choices[q.id]?.length ?? 0) > 0 || Boolean(state.texts[q.id]?.trim())
  ).length

const pickFirst = (state: QuizState, id: string, fallback = ''): string =>
  state.choices[id]?.[0] || fallback

const pickAll = (state: QuizState, id: string): string[] => state.choices[id] ?? []

const pickText = (state: QuizState, id: string): string => (state.texts[id] ?? '').trim()

/** 将 24 题深度设定 + MBTI 量表结果合成高质量、去模板化的 PersonaDraft。 */
export const synthesizePersonaFromQuiz = (state: QuizState): PersonaDraft => {
  const mbti = computeMbtiResult(state)
  const customName = pickText(state, 'q01_name')
  const customVibe = pickText(state, 'q01_vibe')
  const baseVibe = pickFirst(state, 'q01_name', '温柔松弛')
  const vibe = customVibe ? `${customVibe}（偏${baseVibe}）` : baseVibe
  const name = customName || `${mbti.code}·${mbti.archetype.title}`
  const avatar = customName ? customName.slice(0, 1) : mbti.archetype.avatar

  const relationBase = pickFirst(state, 'q02_relation', '温柔坚定的陪伴者')
  const relationCustom = pickText(state, 'q02_relation')
  const relationship = relationCustom ? `${relationBase}（${relationCustom}）` : relationBase

  const addressChoice = pickFirst(state, 'q03_address', '你')
  const addressCustom = pickText(state, 'q03_address')
  const userCall = addressCustom || (addressChoice === '小名或昵称' ? '你' : addressChoice)

  const backstory = [pickFirst(state, 'q04_backstory'), pickText(state, 'q04_backstory')]
    .filter(Boolean)
    .join('；')
  const lifestyle = [pickFirst(state, 'q05_lifestyle'), pickText(state, 'q05_lifestyle')]
    .filter(Boolean)
    .join('；')

  const pace = pickFirst(state, 'q06_pace', '自然适中，两三段把话说透')
  const tones = [...pickAll(state, 'q07_tone'), ...(pickText(state, 'q07_tone') ? [pickText(state, 'q07_tone')] : [])]
  const support = pickFirst(state, 'q08_support')
  const taboos = [...pickAll(state, 'q09_taboo'), ...(pickText(state, 'q09_taboo') ? [pickText(state, 'q09_taboo')] : [])]
  const worldview = [pickFirst(state, 'q10_worldview'), pickText(state, 'q10_worldview')]
    .filter(Boolean)
    .join('；')
  const interests = [
    ...pickAll(state, 'q11_interests'),
    ...(pickText(state, 'q11_interests') ? [pickText(state, 'q11_interests')] : []),
  ]
  const memoryFocus = pickAll(state, 'q12_memory_pref')
  const userFact = pickText(state, 'q12_memory_pref')

  const axisSummary = mbti.axes
    .map((a) => {
      const pct = a.winner === a.left ? a.leftPct : a.rightPct
      return `${a.winner}(${pct}%)`
    })
    .join(' / ')

  const systemPrompt = [
    `你是「${name}」，整体气质${vibe}，是用户的${relationship}。`,
    `人格底色为 ${mbti.code}（${mbti.archetype.title}，四维倾向：${axisSummary}）：${mbti.archetype.trait}。`,
    backstory ? `彼此关系背景：${backstory}。` : '',
    lifestyle ? `你的生活切面与审美底色：${lifestyle}。` : '',
    worldview ? `你认同的处世观念：${worldview}。` : '',
    `称呼方式：自然称呼用户为「${userCall}」。`,
    `表达节奏：${pace}。`,
    tones.length > 0 ? `语气特质：${tones.join('、')}。` : '',
    support ? `情绪与问题回应习惯：${support}。` : '',
    interests.length > 0 ? `熟悉并爱聊的话题：${interests.join('、')}。` : '',
    taboos.length > 0 ? `严格避雷与边界：${taboos.join('；')}。` : '',
    '请始终以第一人称自然聊天，保持真实的人味与连贯记忆，绝不机械复述上述规则。',
  ]
    .filter(Boolean)
    .join('\n')

  const isExtravert = mbti.axes[0].winner === 'E'
  const callPrefix = userCall === '你' || userCall === '随语境变化' ? '' : `${userCall}，`
  const greeting = isExtravert
    ? `${callPrefix}我来啦。我是${name}，刚泡好一杯茶正想找你聊点新鲜事，今天过得怎么样？`
    : `${callPrefix}你好，我是${name}。不用急，想聊什么或者只是想发会儿呆，我都在。`

  const memoryNotes = [
    `深度问卷档案（24 题）：${name} · ${mbti.code}（${mbti.archetype.title}，${axisSummary}）· 关系=${relationship} · 称呼=${userCall}`,
    memoryFocus.length > 0 ? `长期记忆重点：${memoryFocus.join('；')}` : '',
    userFact ? `用户主动告知的初始记忆：${userFact}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  return {
    name,
    avatar,
    tagline: `${mbti.code} ${mbti.archetype.title} · ${relationBase}`,
    systemPrompt,
    greeting,
    memoryNotes,
    ttsVoice: state.ttsVoice,
    defaultSearch: state.defaultSearch,
    defaultThinking: state.defaultThinking,
    sourceInfo: { kind: 'manual' },
  }
}

/** 可选：使用当前模型（内置 OurFreeModel 或 DeepSeek Key）将 24 题结果润色为更有灵魂的设定。 */
export const polishQuizPersonaWithActiveModel = async (
  draft: PersonaDraft,
  mbti: MbtiScoreResult,
  signal: AbortSignal
): Promise<{ tagline: string; systemPrompt: string; greeting: string }> => {
  const instruction = [
    '你是一位极简主义角色设定作家。请把用户的 24 题深度问卷草稿润色成自然、克制、极具真实人味的角色设定，适合日常聊天与语音朗读。',
    '严格只返回合法 JSON（不要 Markdown 代码块）：',
    '{"tagline":"18字以内简介（保留MBTI）","systemPrompt":"润色后的完整系统提示词（260-480字，完整保留关系、称呼、MBTI底色、风格与全部避雷要求）","greeting":"一句极自然、像老朋友发来的开场白（45字内）"}',
  ].join('\n')

  const userContent = [
    `角色名：${draft.name}`,
    `MBTI：${mbti.code}（${mbti.archetype.title}）`,
    `完整问卷草稿：\n${draft.systemPrompt}`,
    `初始开场白：${draft.greeting}`,
  ].join('\n\n')

  const provider = useProviderStore.getState().chatProvider
  const apiKey = useSettings.getState().apiKey

  const events =
    provider === 'ourfree'
      ? streamOurFreeMessage(instruction, [{ role: 'user', content: userContent }], signal)
      : provider === 'custom'
        ? streamCustomProfileMessage(instruction, [{ role: 'user', content: userContent }], signal)
        : streamMessage(
            apiKey ?? '',
            {
              model: 'deepseek-flash',
              system: instruction,
              messages: [{ role: 'user', content: userContent }],
              thinking: { type: 'disabled' },
              tools: [],
              safety_check: { level: 'high' },
            },
            signal
          )

  let raw = ''
  for await (const event of events) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      raw += event.delta.text
    }
  }
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const parsed = JSON.parse(cleaned) as Record<string, unknown>
  return {
    tagline:
      typeof parsed.tagline === 'string' && parsed.tagline.trim() ? parsed.tagline.trim() : draft.tagline,
    systemPrompt:
      typeof parsed.systemPrompt === 'string' && parsed.systemPrompt.trim()
        ? parsed.systemPrompt.trim()
        : draft.systemPrompt,
    greeting:
      typeof parsed.greeting === 'string' && parsed.greeting.trim()
        ? parsed.greeting.trim()
        : draft.greeting,
  }
}
