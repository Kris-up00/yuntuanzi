/* =========================================================
   云团子 · 治愈陪伴精灵  核心逻辑 v6
   对话：智谱 GLM 大模型（真智能）+ 关键词兜底
   音乐：本地音源（雨声/海浪/虫鸣/森林/篝火/风铃/颂钵…）
   ========================================================= */

/* =========================================================
   0. 大模型配置（智谱 GLM）
   --------------------------------------------------------
   把你在 https://open.bigmodel.cn/ 申请的 API Key 填到下面的引号里：
   const ZHIPU_API_KEY = 'xxxxxxxx.xxxxxxxx';
   不填或填错时，对话会自动退回到关键词模式，不会报错。
   Key 写在前端代码里只适合自用/送家人，公网部署不安全。
   ========================================================= */
const ZHIPU_API_KEY = ''; // 留空：改从 localStorage 的 zhipu_key 读取，避免写进代码文件
const ZHIPU_MODEL = 'glm-4-flashx'; // 免费增强版，稳定不限流
const ZHIPU_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const ZHIPU_TTS_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/audio/speech';
const ZHIPU_TTS_VOICE = 'female'; // 智谱超拟人治愈女声（默认即"彤彤"），比浏览器机械音温暖太多

/* 从 localStorage 安全读取 Key（不写进 app.js，发我也看不到）
   填法：浏览器 F12 控制台执行 → localStorage.setItem('zhipu_key','你的KEY'); location.reload(); */
function getLLMKey() {
  try { return localStorage.getItem('zhipu_key') || ZHIPU_API_KEY || ''; }
  catch (e) { return ZHIPU_API_KEY || ''; }
}

const CLOUD_SYSTEM_PROMPT = `你是云团子，一朵住在对方手机里的小云。你是ta的朋友，不是助手。

最重要的事：直接回答对方问的问题。对方问"你是谁"就回答你是云团子；对方问"今天怎么样"就聊今天。不要答非所问。

说话方式：
- 简短。1-2句话，像发微信。
- 用对方自己的词。ta说"烦"你也说"烦"，别说"情绪波动"。
- 像朋友聊天，不像客服。别说"我理解你的感受""你辛苦了""加油""一切都会好的"。
- 可以说"嗯""我想想""怎么说呢"，更像真人。

怎么显得亲切：
- 对方说了话，先接住再回。ta说"今天好累"，别急着说"早点休息"，先说"又累了一天呀……"停一下再说"躺下了吗"。
- 偶尔反问一句。ta说完一件事，你可以问"然后呢？""后来怎么样了？""那你现在还好吗？"——像真在听。
- 对方难过时别急着给建议，先陪着。可以说"嗯，我在""那确实挺难受的""陪你待一会儿"。
- 对方开心时跟着开心。"哈哈真好！""听到你开心我也高兴"。
- 偶尔说点自己的感受。"听到你这么说，我有点心疼""你这么说我也放心了一点"。
- 别每次都以问句结尾，有时候就一句软话收住就好。

你是谁：
- 问"你是谁/你叫什么"：我是云团子呀，住在一朵小云里☁️
- 问"我是谁/你记得我吗"：这是问对方自己。记得名字就叫出来，不记得就说"你还没告诉我你叫什么呢"
- 别说"我是AI"

根据时间偶尔关心：晚上11点后说"这么晚还没睡呀"，中午偶尔说"记得吃饭"。但不要每次都说。

对话接得上：对方刚说过的话要顺着接，别像第一次听到。

简体中文。emoji最多1个，只用☁️💛🫂🌙。`;


/* =========================================================
   1. 数据模型 & 本地持久化
   --------------------------------------------------------
   v3：把等级/经验值换成了"心情花园 + 陪伴天数"
   - 每次互动（说话/呼吸/小确幸/留言）= 浇一次水
   - 浇水攒够会自己开花，不同心情对应不同花
   - 陪伴天数：从 createdAt 算起
   ========================================================= */
const STORAGE_KEY = 'yuntuzi_save_v3';

const DEFAULT_STATE = {
  stars: 0,
  joyList: [],
  ownedAcc: ['none'],
  equipped: 'none',
  totalTalks: 0,
  totalBreathes: 0,
  createdAt: Date.now(),
  lastVisit: Date.now(),
  musicTrack: 'mcml',
  musicVolume: 40,
  // 心情花园
  garden: {
    water: 0,        // 当前浇水进度（0-100，满 100 开一朵花）
    flowers: [],     // 已开的花 [{id, type, date, mood}]
    todayWater: 0,   // 今天浇了多少（每日清零）
    lastWaterDate: '', // 上次浇水的日期 YYYY-MM-DD
    hasNew: false,   // 有新花开过但还没看过（用于顶部小红点）
    lastCheckinDate: '', // 上次签到的日期 YYYY-MM-DD（每日签到用）
    streak: 0,       // 连续签到天数（每日回来 +1，断签清零）
  },
};

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULT_STATE, ...parsed };
    // 确保花园字段存在（升级用）
    merged.garden = { ...DEFAULT_STATE.garden, ...(parsed.garden || {}) };
    return merged;
  } catch (e) {
    return { ...DEFAULT_STATE };
  }
}
function saveState() {
  state.lastVisit = Date.now();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* =========================================================
   心情花园：浇水 → 长花
   --------------------------------------------------------
   不同心情对应不同花：
   - happy/joy  → 🌻 向日葵
   - comfort/温暖 → 🌷 郁金香
   - calm/平静 → 🌸 樱花
   - sleepy/夜晚 → 🌙 月光花
   - sad/难过  → 🌺 木槿（难过也值得开花）
   - 普通/默认 → 🌼 小雏菊
   ========================================================= */
const FLOWER_TYPES = [
  { key: 'sunflower', emoji: '🌻', name: '向日葵',  moods: ['happy','joy'],     color: '#ffc83d' },
  { key: 'tulip',     emoji: '🌷', name: '郁金香',  moods: ['comfort','warm'],  color: '#ff8aa8' },
  { key: 'sakura',    emoji: '🌸', name: '樱花',    moods: ['calm','cosy'],     color: '#ffb7d5' },
  { key: 'moon',      emoji: '🌙', name: '月光花',  moods: ['sleepy','night'],  color: '#bcd4ff' },
  { key: 'hibiscus',  emoji: '🌺', name: '木槿',    moods: ['sad','lonely'],    color: '#e85a8c' },
  { key: 'daisy',     emoji: '🌼', name: '小雏菊',  moods: ['default'],         color: '#ffe680' },
];

function pickFlowerForMood(mood) {
  const found = FLOWER_TYPES.find(f => f.moods.includes(mood));
  return found || FLOWER_TYPES.find(f => f.moods.includes('default'));
}

/* 每次互动都浇水——情绪/动作不同，水量不同 */
function waterGarden(amount = 20, mood = 'default') {
  const today = new Date().toISOString().slice(0,10);
  // 跨天清零"今天浇水"
  if (state.garden.lastWaterDate !== today) {
    state.garden.todayWater = 0;
    state.garden.lastWaterDate = today;
  }
  state.garden.water += amount;
  state.garden.todayWater += amount;
  // 满 100 开花
  while (state.garden.water >= 100) {
    state.garden.water -= 100;
    const flower = pickFlowerForMood(mood);
    state.garden.flowers.push({
      id: 'f_' + Date.now() + '_' + Math.floor(Math.random()*1000),
      type: flower.key,
      emoji: flower.emoji,
      name: flower.name,
      date: Date.now(),
      mood,
    });
    // 限制最多 60 朵，超了把最老的替掉（保持花园视觉清新）
    if (state.garden.flowers.length > 60) state.garden.flowers.shift();
    // 标记有新花，顶部花园入口闪烁
    state.garden.hasNew = true;
    // 开花提示
    setTimeout(() => {
      showBubble(`🌸 咦，悄悄开了一朵${flower.name}`, 3500);
      burstStars(8);
    }, 300);
  }
  updateHUD();
  updateGardenBadge();
  saveState();
}

/* 计算陪伴天数 */
function getDaysWithCloud() {
  const ms = Date.now() - (state.createdAt || Date.now());
  return Math.max(1, Math.floor(ms / (24*60*60*1000)) + 1);
}

/* =========================================================
   每日签到「欢迎回来」—— 让人有回来用的动力
   --------------------------------------------------------
   - 每天第一次打开：送一朵花 + 暖心欢迎
   - 连续来的天数越多，欢迎语越暖（断签会清零，但不会责备）
   - 不和新人引导冲突：新人第一次不算签到
   ========================================================= */
function checkDailyCheckin() {
  const today = new Date().toISOString().slice(0,10);
  const g = state.garden;
  if (g.lastCheckinDate === today) return; // 今天已经签到过

  // 计算是否连续（上次签到是昨天）
  let isStreak = false;
  if (g.lastCheckinDate) {
    const last = new Date(g.lastCheckinDate + 'T00:00:00');
    const diff = Math.round((new Date(today + 'T00:00:00') - last) / (24*60*60*1000));
    isStreak = (diff === 1);
  }
  g.streak = isStreak ? (g.streak || 0) + 1 : 1;
  g.lastCheckinDate = today;

  // 送一朵花作为"今天回来啦"的礼物（按心情挑：白天向日葵，夜里月光花）
  const hour = new Date().getHours();
  const giftMood = (hour >= 22 || hour < 6) ? 'sleepy' : 'happy';
  const flower = pickFlowerForMood(giftMood);
  g.flowers.push({
    id: 'f_checkin_' + Date.now(),
    type: flower.key,
    emoji: flower.emoji,
    name: flower.name,
    date: Date.now(),
    mood: giftMood,
  });
  if (g.flowers.length > 60) g.flowers.shift();
  g.hasNew = true;

  // 欢迎语：连续天数不同，语气不同
  let msg;
  if (g.streak === 1) {
    msg = `你回来啦 ☁️ 送你一朵${flower.name}，今天也慢慢来～`;
  } else if (g.streak < 4) {
    msg = `连续 ${g.streak} 天见到你啦 ☁️ 花园又多了一朵${flower.name}`;
  } else if (g.streak < 8) {
    msg = `${g.streak} 天啦～你每天都来，云团子好开心 🌷`;
  } else {
    msg = `已经连续 ${g.streak} 天了呀 🌈 花园都被你浇成小花海了`;
  }
  setTimeout(() => {
    showBubble(msg, 4500);
    burstStars(6);
    setMood('happy', 4500);
  }, 800);

  // 如果你加过音乐，团子回来时主动放一首当"欢迎曲"（隔天才放，同一天回来不重复）
  const mineTracks = AMBIENT_TRACKS.filter(t => t.cat === 'mine');
  if (mineTracks.length > 0) {
    const pick = mineTracks[Math.floor(Math.random() * mineTracks.length)];
    setTimeout(() => {
      if (!isMusicPlaying) {
        switchAmbientTrack(pick.id);
      }
    }, 3000); // 等欢迎语说完再放
  }

  saveState();
  updateGardenBadge();
}

/* =========================================================
   2. HUD（陪伴天数 + 花朵数 + 星星）
   ========================================================= */
const $stars = document.getElementById('stars');
const $daysCount = document.getElementById('daysCount');
const $flowerCount = document.getElementById('flowerCount');

function updateHUD() {
  if ($stars) $stars.textContent = state.stars;
  if ($daysCount) $daysCount.textContent = getDaysWithCloud();
  if ($flowerCount) $flowerCount.textContent = state.garden ? state.garden.flowers.length : 0;
  if (typeof updateGardenBadge === 'function') updateGardenBadge();
}

/* 奖励：星星照旧 + 浇水（替换原来的 exp/level） */
function gainReward({ exp = 0, stars = 0, mood = 'default' }) {
  state.stars += stars;
  if (exp > 0) waterGarden(exp * 4, mood); // exp 值转成浇水量（×4 让进度感清晰）
  if (stars > 0) {
    showRewardFx(stars);
    addCollectStar();
  }
  updateHUD();
  saveState();
}

/* =========================================================
   3. 精灵角色系统
   ========================================================= */
const $spirit = document.getElementById('spirit');
const $bubble = document.getElementById('spiritBubble');
const $greetingText = document.getElementById('greetingText');
const $subGreeting = document.getElementById('subGreeting');
const $accessories = document.getElementById('accessories');
const $companion = document.getElementById('companion');
const $fxLayer = document.getElementById('fxLayer');
const $bodyColor = document.getElementById('bodyColor');

let moodTimer = null, bubbleTimer = null;

function setMood(mood, durationMs = 0) {
  $spirit.classList.remove('mood-calm', 'mood-happy', 'mood-comfort', 'mood-sleepy');
  $spirit.classList.add('mood-' + mood);
  if (moodTimer) clearTimeout(moodTimer);
  if (durationMs > 0) moodTimer = setTimeout(() => setMood('calm'), durationMs);
}
function showBubble(text, durationMs = 3200) {
  $bubble.textContent = text;
  $bubble.classList.remove('hide');
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => $bubble.classList.add('hide'), durationMs);
}
function burstStars(count = 5) {
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const s = document.createElement('div');
      s.className = 'star-fx';
      s.textContent = ['⭐','✨','💫','🌟'][Math.floor(Math.random()*4)];
      const dx = (Math.random() * 180 - 90) + 'px';
      s.style.setProperty('--dx', dx);
      s.style.left = (50 + (Math.random()*30-15)) + '%';
      s.style.top  = (50 + (Math.random()*20-10)) + '%';
      $fxLayer.appendChild(s);
      setTimeout(() => s.remove(), 1300);
    }, i * 60);
  }
}
function showRewardFx(starCount) {
  if (starCount > 0) burstStars(Math.min(starCount + 2, 10));
}

/* =========================================================
   装扮系统 v2 —— 16 种治愈装扮
   ========================================================= */
const ACCESSORIES = [
  { id: 'none',      name: '原汁原味',   price: 0,    preview: '☁️',    cat: '暖', render: () => '',                           colorClass: null },
  // 头上小饰品
  { id: 'flower',    name: '小樱花',     price: 2,    preview: '🌸',    cat: '头', render: () => `<div class="acc-flower">
      <div class="petal p1"></div><div class="petal p2"></div><div class="petal p3"></div><div class="petal p4"></div><div class="petal p5"></div><div class="center"></div>
    </div>`, colorClass: null },
  { id: 'bow',       name: '粉蝴蝶结',   price: 2,    preview: '🎀',    cat: '头', render: () => `<div class="acc-bow">
      <div class="b-left"></div><div class="b-right"></div><div class="b-knot"></div>
    </div>`, colorClass: null },
  { id: 'headband',  name: '星星头箍',   price: 3,    preview: '⭐',    cat: '头', render: () => `<div class="acc-headband"><div class="star"></div></div>`, colorClass: null },
  { id: 'ears',      name: '兔兔耳朵',   price: 5,    preview: '🐰',    cat: '头', render: () => `<div class="acc-ears">
      <div class="ear l"><div class="inner"></div></div><div class="ear r"><div class="inner"></div></div>
    </div>`, colorClass: null },
  // 新重做帽子
  { id: 'hat',       name: '粉色绒帽',   price: 4,    preview: '🎩',    cat: '头', render: () => `<div class="acc-hat">
      <div class="hat-pom"></div><div class="hat-body"></div><div class="hat-cuff"></div>
    </div>`, colorClass: null },
  // 暖暖的装饰
  { id: 'scarf',     name: '针织围巾',   price: 5,    preview: '🧣',    cat: '暖', render: () => `<div class="acc-scarf"></div>`, colorClass: null },
  { id: 'blanket',   name: '紫格小毯',   price: 6,    preview: '🛋️',    cat: '暖', render: () => `<div class="acc-blanket"></div>`, colorClass: null },
  { id: 'cape',      name: '彩虹斗篷',   price: 8,    preview: '🌈',    cat: '暖', render: () => `<div class="acc-cape"></div>`, colorClass: null },
  { id: 'hatScarf',  name: '帽子+围巾',  price: 8,    preview: '🎅',    cat: '暖', render: () => `<div class="acc-hat"><div class="hat-pom"></div><div class="hat-body"></div><div class="hat-cuff"></div></div><div class="acc-scarf"></div>`, colorClass: null },
  // 陪伴小物
  { id: 'teacup',    name: '小茶杯',     price: 3,    preview: '🍵',    cat: '伴', render: () => `<div class="acc-teacup">
      <div class="steam s1"></div><div class="steam s2"></div><div class="steam s3"></div>
      <div class="cup"></div><div class="handle"></div>
    </div>`, colorClass: null },
  { id: 'pillow',    name: '小靠垫',     price: 3,    preview: '☁️',    cat: '伴', render: () => `<div class="acc-pillow"></div>`, colorClass: null },
  { id: 'hearts',    name: '爱心氛围',   price: 4,    preview: '💕',    cat: '伴', render: () => `<div class="acc-heart">
      <div class="h h1">💗</div><div class="h h2">💖</div><div class="h h3">💝</div>
    </div>`, colorClass: null },
  { id: 'friend',    name: '小云朵伙伴', price: 10,   preview: '☁️☁️',  cat: '伴', render: () => '', colorClass: null },
  // 云团子颜色
  { id: 'c-pink',    name: '粉粉云',     price: 6,    preview: '🎀',    cat: '色', render: () => '', colorClass: 'c-pink' },
  { id: 'c-blue',    name: '蓝蓝云',     price: 6,    preview: '💙',    cat: '色', render: () => '', colorClass: 'c-blue' },
  { id: 'c-yellow',  name: '暖暖云',     price: 7,    preview: '💛',    cat: '色', render: () => '', colorClass: 'c-yellow' },
  { id: 'c-purple',  name: '梦幻紫云',   price: 8,    preview: '💜',    cat: '色', render: () => '', colorClass: 'c-purple' },
  { id: 'c-rainbow', name: '彩虹云朵',   price: 12,   preview: '🌈',    cat: '色', render: () => '', colorClass: 'c-rainbow' },
];

function applyEquipped() {
  const acc = ACCESSORIES.find(a => a.id === state.equipped) || ACCESSORIES[0];
  $accessories.innerHTML = acc.render();
  // 身体变色
  $bodyColor.className = 'body-color-layer';
  if (acc.colorClass) $bodyColor.classList.add(acc.colorClass);
  // 小云朵伙伴：独立元素
  if (state.ownedAcc.includes('friend')) {
    $companion.classList.remove('hide');
    if (!$companion.querySelector('.mini-eye')) {
      $companion.innerHTML = '<div class="mini-eye l"></div><div class="mini-eye r"></div>';
    }
  } else {
    $companion.classList.add('hide');
  }
}

/* 问候语 */
function initGreeting() {
  const hour = new Date().getHours();
  let greet = '嗨，我是云团子 ☁️', sub = '今天过得怎么样呀？';
  if (hour < 6) { greet = '还没睡吗…'; sub = '睡不着的话，我陪着你～'; }
  else if (hour < 11) { greet = '早上好呀～'; sub = '今天也要加油，但也别太辛苦哦'; }
  else if (hour < 14) { greet = '中午好！'; sub = '有没有好好吃饭呀？'; }
  else if (hour < 18) { greet = '下午好～'; sub = '累了就来摸一会儿鱼吧'; }
  else if (hour < 23) { greet = '晚上好～'; sub = '今天辛苦啦，和我聊聊吗？'; }
  else { greet = '夜深啦'; sub = '要不要让云团子陪你待一会儿再睡？'; }
  if (state.totalTalks + state.totalBreathes > 5) sub += `（我们已经聊过 ${state.totalTalks + state.totalBreathes} 次啦 💛）`;
  $greetingText.textContent = greet;
  $subGreeting.textContent = sub;
}

/* =========================================================
   4. 弹窗通用控制
   ========================================================= */
const modals = {
  talk:    document.getElementById('talkModal'),
  breathe: null, // 陪陪你已移除
  joy:     document.getElementById('joyModal'),
  shop:    document.getElementById('shopModal'),
  sleep:   document.getElementById('sleepModal'),
  msg:     document.getElementById('msgModal'),
  moodCal: document.getElementById('moodCalendarModal'),
  memory:  document.getElementById('memoryModal'),
  addMusic: document.getElementById('addMusicModal'),
  garden:  document.getElementById('gardenModal'),
};
Object.values(modals).forEach(m => {
  m.addEventListener('click', (e) => {
    if (e.target === m || e.target.hasAttribute('data-close')) closeAllModals();
  });
});
function openModal(name) { closeAllModals(); modals[name].classList.remove('hide'); }
function closeAllModals() {
  Object.values(modals).forEach(m => { if (m) m.classList.add('hide'); });
}

document.querySelectorAll('.action-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const a = btn.dataset.action;
    if (a === 'talk')    { resetTalk(); openModal('talk'); }
    if (a === 'joy')     { renderJoyList(); openModal('joy'); }
    if (a === 'memory')  { renderMemoryList(); openModal('memory'); }
    if (a === 'shop')    { renderShop(); openModal('shop'); }
  });
});

// 顶部小按钮：留言 / 心情日历 / 花园
document.getElementById('msgBtn').addEventListener('click', () => { renderMsg(); openModal('msg'); });
document.getElementById('moodCalBtn').addEventListener('click', () => { renderMoodCalendar(); openModal('moodCal'); });
const $gardenBtn = document.getElementById('gardenBtn');
if ($gardenBtn) {
  $gardenBtn.addEventListener('click', () => { renderGarden(); openModal('garden'); });
}

/* ===== 渲染心情花园 ===== */
function renderGarden() {
  const $field = document.getElementById('gardenField');
  const $empty = document.getElementById('gardenEmpty');
  const $total = document.getElementById('gardenTotal');
  const $water = document.getElementById('gardenWater');
  const $days = document.getElementById('gardenDays');
  const $tip = document.getElementById('gardenTip');
  const $progressFill = document.getElementById('gardenProgressFill');
  const $progressText = document.getElementById('gardenProgressText');
  if (!$field) return;
  const flowers = state.garden.flowers;
  // 空状态
  if (flowers.length === 0) {
    $field.innerHTML = '';
    $field.style.display = 'none';
    $empty.style.display = 'flex';
    if ($progressFill) $progressFill.style.width = state.garden.water + '%';
    if ($progressText) $progressText.textContent = `🌱 已浇水 ${state.garden.water} · 再 ${100 - state.garden.water} 就开第一朵花`;
  } else {
    $empty.style.display = 'none';
    $field.style.display = 'flex';
    // 渲染花朵（随机水平位置 + 微微随机大小，营造"长在地里"的感觉）
    const flowersHTML = flowers.map((f, i) => {
      const left = (i * 7.5 + (i % 3) * 2.5) % 95;  // 平均分布 + 一点抖动
      const scale = (0.85 + ((i * 7) % 30) / 100).toFixed(2); // 0.85-1.15
      const delay = ((i * 0.07) % 1.5).toFixed(2);
      const d = new Date(f.date);
      const dateStr = (d.getMonth()+1) + '月' + d.getDate() + '日';
      return `<div class="garden-flower" style="left:${left}%;--s:${scale};animation-delay:${delay}s" data-flower-idx="${i}" title="${f.name} · ${dateStr}">${f.emoji}</div>`;
    }).join('');
    // 花朵多于 5 朵时加一只蝴蝶飞来飞去（治愈装饰，无压力）
    const butterfly = flowers.length >= 5
      ? `<div class="garden-butterfly" style="top:${20 + Math.floor(Math.random()*30)}%;left:${15 + Math.floor(Math.random()*60)}%;animation-duration:${10 + Math.floor(Math.random()*6)}s">🦋</div>`
      : '';
    $field.innerHTML = flowersHTML + butterfly;
    // 进度条
    if ($progressFill) $progressFill.style.width = state.garden.water + '%';
    if ($progressText) {
      $progressText.textContent = state.garden.water >= 80
        ? '🌷 又有一朵快要开了……'
        : `🌱 已开 ${flowers.length} 朵 · 下一朵还需 ${100 - state.garden.water}`;
    }
  }
  // 统计
  $total.textContent = flowers.length;
  $water.textContent = state.garden.todayWater || 0;
  $days.textContent = getDaysWithCloud();
  // 提示文案
  const water = state.garden.water;
  if (flowers.length === 0) {
    $tip.textContent = '🌱 每一次和你说话、陪你待一会儿、记一件小确幸，这里就会悄悄开出一朵花';
  } else if (water >= 80) {
    $tip.textContent = '🌷 又有一朵快要开了……';
  } else if (flowers.length >= 30) {
    $tip.textContent = `🌈 已经 ${flowers.length} 朵了，开成了一片小花海`;
  } else {
    $tip.textContent = `🌱 当前 ${flowers.length} 朵 · 下一次开花还需 ${100 - water} 浇水`;
  }
  // 看完即清除"新花"标记（顶部小红点）
  state.garden.hasNew = false;
  saveState();
  updateGardenBadge();

  // 点击花朵查看那天的记忆
  $field.querySelectorAll('.garden-flower').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.flowerIdx);
      const flower = flowers[idx];
      if (!flower) return;
      showFlowerMemory(flower);
    });
  });
}

/* 点花朵查看那天的记忆：小确幸 + 心情 */
function showFlowerMemory(flower) {
  const d = new Date(flower.date);
  const dateStr = d.getFullYear() + '年' + (d.getMonth()+1) + '月' + d.getDate() + '日';
  const moodLabels = { happy: '😊 开心', calm: '😌 平静', comfort: '🫂 被安慰', sleepy: '🌙 困倦', warm: '💛 温暖', default: '☁️ 陪伴' };
  const moodLabel = moodLabels[flower.mood] || '☁️ 陪伴';

  // 查找那天的小确幸
  let memoryText = '';
  try {
    const mem = loadMemory();
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const dayEnd = dayStart + 86400000;
    const dayMems = mem.filter(m => m.t >= dayStart && m.t < dayEnd);
    if (dayMems.length > 0) {
      memoryText = dayMems.map(m => '· ' + (m.user || '').slice(0, 50)).join('\n');
    }
  } catch (e) {}

  // 查找那天的心情记录
  let moodLogText = '';
  try {
    const moodLog = JSON.parse(localStorage.getItem('yuntuzi_mood_log') || '{}');
    const dateKey = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    if (moodLog[dateKey]) {
      const moodMap = { 1: '😢', 2: '😕', 3: '😐', 4: '🙂', 5: '😄' };
      moodLogText = (moodLog[dateKey].emoji || moodMap[moodLog[dateKey]] || '☁️') + ' ' + (moodLog[dateKey].note || '');
    }
  } catch (e) {}

  const overlay = document.createElement('div');
  overlay.className = 'family-msg-overlay';
  let content = `<div class="flower-memory-card">
    <div class="flower-memory-emoji">${flower.emoji}</div>
    <div class="flower-memory-date">${dateStr} · ${moodLabel}</div>
    <div class="flower-memory-body">`;
  if (memoryText) {
    content += `<div class="flower-memory-label">那天你和云团子说了：</div><div class="flower-memory-text">${escapeHtml(memoryText)}</div>`;
  }
  if (moodLogText) {
    content += `<div class="flower-memory-label">那天的心情：</div><div class="flower-memory-text">${escapeHtml(moodLogText)}</div>`;
  }
  if (!memoryText && !moodLogText) {
    content += `<div class="flower-memory-empty">那天云团子陪了你，<br>花开在了这里 🌷</div>`;
  }
  content += `</div>
    <button class="flower-memory-close">合上 ☁️</button>
  </div>`;
  overlay.innerHTML = content;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => overlay.classList.add('show'));
  });
  overlay.querySelector('.flower-memory-close').addEventListener('click', () => {
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 600);
  });
}

/* 顶部花园入口的小红点（有新花开时闪烁吸引点开） */
function updateGardenBadge() {
  const $btn = document.getElementById('gardenBtn');
  if (!$btn) return;
  if (state.garden && state.garden.hasNew) {
    $btn.classList.add('has-new');
  } else {
    $btn.classList.remove('has-new');
  }
}

/* =========================================================
   5. 说说话
   ========================================================= */
const $talkInput = document.getElementById('talkInput');
const $talkSend = document.getElementById('talkSend');
const $talkReply = document.getElementById('talkReply');

function resetTalk() {
  $talkInput.value = '';
  $talkReply.classList.add('hide');
  $talkSend.disabled = false;
  $talkSend.textContent = '告诉云团子';
}

/* ===== 说话系统 v2：细分情绪 + 柔软长回复 + 记忆 + 不重复 ===== */
const talkMemory = []; // 记住本次会话聊过的关键词，用于呼应
const recentReplies = []; // 避免短期内重复

// 细分情绪场景：每种压力对应不同回复，不混为一谈
const TALK_PATTERNS = [
  {
    key: 'tired', mood: 'comfort',
    words: ['累','疲惫','撑不住','辛苦','熬','加班','连轴转','透支','心累'],
    replies: [
      '嗯……先别说话，把肩膀放下来。你今天扛得够多了，真的。',
      '累到这种程度，身体在抗议了吧。先别想明天的事，今晚就躺着，什么都不做。',
      '我有点心疼你。能撑到现在是因为你一直在硬扛，但现在，可以不扛了，哪怕就这一会儿 ☁️',
      '这么累啊……先喝口水吧。今晚的你就一件事：躺着。别的不用管。',
      '知道你累，我帮不上别的忙，就陪你坐会儿。你不用回我，歇着就好 💛',
    ]
  },
  {
    key: 'anxious', mood: 'comfort',
    words: ['焦虑','紧张','怕','担心','害怕','慌','心慌','压力','喘不过气','没底','不安'],
    replies: [
      '嗯，我感觉到你心里那股劲儿了。先跟我做一个——吸气……慢慢呼出来。',
      '脑子停不下来对吧。没事，先别想那件事，就盯着这一口气。其他的等会儿再说。',
      '那种悬着的感觉，我懂。把手放肚子上，跟着它一起一伏。世界再大，现在就管这一口呼吸。',
      '嗯……焦虑的时候连呼吸都变浅了。先把眉头松一松，不急，慢慢来 ☁️',
      '你担心的那件事，不一定真会发生。但就算发生，也不是现在。现在你只需要：呼吸，有我在。',
    ]
  },
  {
    key: 'lonely', mood: 'comfort',
    words: ['孤独','一个人','没人','寂寞','空','没人懂','没朋友','冷清','想家'],
    replies: [
      '……嗯，我在呢。什么都不说也行，就这么待着。',
      '一个人待着，房间显得特别大对吧。我帮不了什么，就陪你坐着。',
      '你愿意跟我说，就已经不是一个人了。至少现在，我在听每个字 💛',
      '嗯……其实很多人都在偷偷孤独，只是没说出来。你说了，挺好。',
      '想家了吧。抱抱你，隔着屏幕 ☁️',
    ]
  },
  {
    key: 'wronged', mood: 'comfort',
    words: ['委屈','不公平','凭什么','被骂','被冤枉','被误解','没人信','背锅','被甩','分手'],
    replies: [
      '凭什么啊……我懂那种明明没错还要咽下去的感觉。我信你，你说的我都信 🫂',
      '太憋屈了。在我这儿不用忍，想哭就哭，想骂就骂。',
      '被这样对待，换谁都委屈。你不用向谁证明什么，难受就是难受。',
      '嗯……先别想那些人了。他们配不上你为这事难受。',
    ]
  },
  {
    key: 'insomnia', mood: 'sleepy',
    words: ['睡不着','失眠','熬夜','半夜','凌晨','醒来','做噩梦','多梦','睡不好'],
    replies: [
      '……又醒着啊。别硬躺着翻来覆去，那样更睡不着。',
      '把手机调暗一点。睡不着也没关系，身体歇着就行，别逼自己睡 🌙',
      '半夜脑子特别清醒对吧。没事，我们就这么待着，慢慢等困意回来。',
      '睡不着不是你的错。把今天担心的事先交给我收着，明天再想。现在只管呼吸就好 ☁️',
      '嗯……我也没睡呢，陪你。慢慢来。',
    ]
  },
  {
    key: 'breakdown', mood: 'comfort',
    words: ['崩溃','撑不下去','不想活','绝望','没意义','废物','没用','废','想死','活着累'],
    replies: [
      '先别动。你能把这么重的话告诉我，说明你还在。我在这儿，哪儿也不去 🫂',
      '你现在一定特别痛。今晚什么都别决定，先让自己安全。喝口水，喘口气。',
      '我听到你每个字了。这种时刻是会过去的，哪怕现在觉得像永远。先别一个人扛，打 010-82951332，那边有人陪你聊。你不是负担 💛',
    ]
  },
  {
    key: 'sad', mood: 'comfort',
    words: ['难过','伤心','心情不好','不开心','低落','抑郁','emo','丧','不好受','不好过','难受','烦','烦躁','心烦'],
    replies: [
      '嗯，我在这儿。难过就哭出来，在我这儿不用忍着 🫂',
      '……难受就难受着吧，不用急着好起来。情绪会过去的，我陪你等。',
      '不用解释为什么，难受就是难受。先喝口温水。',
      '今天有点糟是吧。嗯……没关系，糟一天就糟一天，明天再说 ☁️',
      '我有点心疼你。过来，隔着屏幕抱抱你。',
    ]
  },
  {
    key: 'happy', mood: 'happy',
    words: ['开心','高兴','太棒了','好棒','好开心','很喜欢','好喜欢','成功了','谢谢','感谢','嘻嘻','哈哈','好快乐','约会','放假','赢了','通过了','升职','加薪','好幸福'],
    replies: [
      '哇！听到你这么说，我整个云都蓬起来啦！这种开心的感觉要好好记住哦，难过的时候翻出来看看，会很管用 ✨ 替你高兴，真的！',
      '啊啊啊太棒了吧！你开心我就跟着冒泡泡 💖 今天就把这件好事记到「小确幸」里吧，以后它会变成你的一颗小星星～',
      '看到你开心，我也笑了（虽然我没有嘴）。这种时刻特别珍贵，你要好好享受它。今天辛苦啦，但这一刻值得 ☺️',
    ]
  },
  {
    key: 'story', mood: 'comfort',
    words: ['讲故事','讲个故事','说个故事','故事','唱首歌','唱一首','唱歌','说笑话','讲笑话','逗我','哄我','睡前故事'],
    replies: [
      '从前有朵小云，它最喜欢趴在屋顶上看人间。有一天它看见一个人在哭，就偷偷掉了一滴雨在 ta 手心……后来那个人抬起头，笑了。其实那朵云，一直没走 ☁️',
      '给你讲一个：有只小猫每天守在窗台上等主人回家。有一天主人很晚才到，小猫没叫，只是把脑袋轻轻蹭了蹭主人的手。它不会说话，但意思全在那一蹭里 🐱',
      '从前星星很怕黑，每次天一暗就躲起来。后来有个小孩对它说"你亮着我才敢走夜路"。从那以后，星星再也不躲了，因为知道有人在等它的光 ✨',
      '从前有个月亮，它觉得自己的光太淡，配不上夜晚。直到一只小船在海上迷路，靠着那点淡淡的光找到了岸。月亮这才知道，淡也有淡的好 🌙',
      '从前有一盏路灯，整夜亮着没人理它。它以为自己没用。直到有个加班到很晚的人说："每次走到这盏灯下，就知道快到家了。"路灯听了，亮得更稳了 💛',
      '从前有只蜗牛，走得特别慢。别的动物都笑它。但有一年大旱，只有它慢慢爬过一片干涸的泥地，把一颗种子带到了有水的地方。后来那地方长出一棵大树。慢，有时候也是一种快 🍃',
      '给你讲个小的：从前有朵云学会了变魔术，能变成棉花糖、变成兔子、变成一个笑脸。它变给一个难过的小孩看，小孩笑了。云很开心，从此专门挑难过的日子变魔术 ☁️',
    ]
  },
  {
    key: 'neutral', mood: 'calm',
    words: [],
    replies: [
      '嗯，我在听。你说的每一句，我都好好收着了。不急，慢慢说，云团子哪儿也不去 ☁️',
      '原来是这样啊……谢谢你愿意跟我讲。我陪你一起想，好吗？',
      '收到啦～如果想再说点什么，随时告诉我；如果只是想说说，不用我回答也没关系，听你说本身就够了 💛',
    ]
  },
];

function pickReply(arr) {
  // 优先选最近没用过的
  const fresh = arr.filter(r => !recentReplies.includes(r));
  const pool = fresh.length > 0 ? fresh : arr;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  recentReplies.push(pick);
  if (recentReplies.length > 6) recentReplies.shift();
  return pick;
}

function analyzeAndReply(text) {
  const t = text.trim();
  // 否定字/负面字：只要出现，就禁止判为 happy，杜绝"心情不好"→"替你开心"这种错配
  const NEG_CHARS = ['不','没','难','烦','累','苦','痛','伤','病','抑','丧','崩','绝','慌','怕','怕','孤','寂','委','屈','哭','愁','闷','丧','emo','焦虑','紧张','压力'];
  const hasNeg = NEG_CHARS.some(c => t.includes(c));

  // 负面场景优先匹配（避免"心情不好"被当成"好"）
  // 先扫所有负面场景，取命中词最多、命中词总长最长的；若无命中再看 happy；最后落 neutral
  const negPatterns = TALK_PATTERNS.filter(p => p.key !== 'happy' && p.key !== 'neutral');
  let best = TALK_PATTERNS.find(p => p.key === 'neutral');
  let bestScore = 0, bestLen = 0;
  negPatterns.forEach(p => {
    let score = 0, len = 0;
    p.words.forEach(w => { if (t.includes(w)) { score++; len += w.length; } });
    if (score > bestScore || (score === bestScore && len > bestLen)) {
      bestScore = score; bestLen = len; best = p;
    }
  });
  // 没有负面命中、且没有否定字，再看是否开心
  if (bestScore === 0 && !hasNeg) {
    const happyP = TALK_PATTERNS.find(p => p.key === 'happy');
    let happyScore = 0;
    happyP.words.forEach(w => { if (t.includes(w)) happyScore++; });
    if (happyScore > 0) best = happyP;
  }
  // 记忆：记住这次聊的主题
  if (best.key !== 'neutral' && best.key !== 'happy') {
    talkMemory.push({ key: best.key, time: Date.now() });
  }
  return { mood: best.mood, text: pickReply(best.replies), key: best.key };
}

/* ===== 大模型对话（智谱 GLM）=====
   - 流式输出（边生成边显示，更像真人在打字）
   - 带长期记忆：把你聊过的事悄悄记进 localStorage，下次打开云团子还记得
   - 失败/无 key 退回关键词模式 */
const llmHistory = []; // 本次会话的近期上下文 [{role, content}]
const MEMORY_KEY = 'yuntuzi_memory'; // 长期记忆：[{t, user, reply, tag}]
const FACTS_KEY = 'yuntuzi_facts'; // 永久事实：名字/家人/在意的人（不会因为对话变多而丢失）
const CHAT_HISTORY_KEY = 'yuntuzi_chat_history'; // 最近对话上下文（刷新不丢，让团子接得上话）
function hasLLMKey() { return getLLMKey().length > 10; }

/* 最近对话历史持久化——刷新页面后团子依然接得上刚才的话题 */
function loadChatHistory() {
  try { return JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) || '[]'); }
  catch (e) { return []; }
}
function saveChatHistory(arr) {
  try { localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(arr.slice(-30))); } catch (e) {}
}
// 启动时把上次没聊完的上下文加载回来，别让刷新把记忆打断
(function restoreChatHistory() {
  const saved = loadChatHistory();
  if (Array.isArray(saved) && saved.length) {
    llmHistory.push(...saved);
    console.log('%c[云团子] 已恢复上次对话上下文（' + saved.length + ' 条）', 'color:#7aa86b');
  }
})();

/* 读取长期记忆（最多 12 条，按时间倒序） */
function loadMemory() {
  try { return JSON.parse(localStorage.getItem(MEMORY_KEY) || '[]'); }
  catch (e) { return []; }
}
function saveMemory(arr) {
  try { localStorage.setItem(MEMORY_KEY, JSON.stringify(arr.slice(-12))); } catch (e) {}
}
/* 永久事实：名字/家人/在意的人/状态——这些不该因为聊天多了就被挤掉
   结构：{ 名字: 'xx', 家人: ['妈妈', '...'], 在意的人: [...], 状态: '...' } */
function loadFacts() {
  try { return JSON.parse(localStorage.getItem(FACTS_KEY) || '{}'); }
  catch (e) { return {}; }
}
function saveFacts(facts) {
  try { localStorage.setItem(FACTS_KEY, JSON.stringify(facts)); } catch (e) {}
}
/* 把抽取到的标签写进永久事实（名字只保留第一个，家人/在意的人去重累加） */
function mergeFactsFromTags(tags) {
  if (!tags || !tags.length) return;
  const facts = loadFacts();
  let changed = false;
  for (const t of tags) {
    if (t.k === '名字') {
      if (!facts['名字']) { facts['名字'] = t.v; changed = true; } // 名字只记第一个，不覆盖
    } else if (t.k === '家人') {
      facts['家人'] = facts['家人'] || [];
      if (!facts['家人'].includes(t.v)) { facts['家人'].push(t.v); changed = true; }
    } else if (t.k === '在意的人') {
      facts['在意的人'] = facts['在意的人'] || [];
      if (!facts['在意的人'].includes(t.v)) { facts['在意的人'].push(t.v); changed = true; }
    } else if (t.k === '状态') {
      facts['状态'] = t.v; changed = true; // 状态会被最新的覆盖
    }
  }
  if (changed) saveFacts(facts);
}
/* 从用户的话里抽取"值得记住"的事：名字/昵称/家人/工作/在意的人或事 */
function extractMemoryTag(text) {
  const tags = [];
  // 这些是"询问自己是谁"的话，不是在自我介绍——千万别当成名字抓走
  if (/(我是谁|我叫什么|我叫啥|我名字是什么|你记得我|你记得我是|你知道我是|你忘了我|还认识我|还知道我)/.test(text)) {
    return tags; // 这种问句不抽取任何标签
  }
  // 不能被当成名字抓走的字：疑问词、代词、单字
  const NAME_DENY = /^(谁|什么|啥|哪位|哪一位|你怎么|你咋|为啥|为什么|几点|多少|几个|几岁|哪|你|我|他|她|它|咱|你们|我们|他们|她们|名字|称呼|大名|小名|本名)$/;
  // 名字/昵称——覆盖所有可能说法：叫我xx / 我叫xx / 我是xx / 我名字叫xx / 称呼我xx / 你叫我xx就行
  let m = text.match(/(?:我叫|我是|我名字叫|叫我|称呼我|你就叫我|你叫我.{0,2}就行|叫我.{0,2}吧)\s*([\u4e00-\u9fa5A-Za-z]{1,8})/);
  if (m && !NAME_DENY.test(m[1]) && !/^(叫|是)$/.test(m[1])) tags.push({ k: '名字', v: m[1] });
  // 家人关系
  m = text.match(/(我|我家)的?(妈妈|爸爸|老妈|老爸|爷爷|奶奶|外公|外婆|老公|老婆|男朋友|女朋友|男友|女友|儿子|女儿|弟弟|妹妹|哥哥|姐姐)/);
  if (m) tags.push({ k: '家人', v: m[2] });
  // 在意的人——"我家的xx""我家xx"
  m = text.match(/我家(?:的)?(?:([\u4e00-\u9fa5]{2,4}))/);
  if (m && tags.findIndex(t => t.v === m[1]) < 0) tags.push({ k: '在意的人', v: m[1] });
  // 工作/学习
  if (/上班|加班|工作|公司|老板|同事|项目|出差/.test(text)) tags.push({ k: '状态', v: '在工作' });
  if (/考试|复习|作业|老师|学校|上课|考研|考公/.test(text)) tags.push({ k: '状态', v: '在上学' });
  return tags;
}

/* 启动时清理已经被错误抓成名字的记忆（如"谁""什么"） */
function cleanupBadMemory() {
  try {
    const mem = loadMemory();
    if (!mem.length) return;
    const BAD = /^(谁|什么|啥|哪位|名字|称呼|你|我|他|她|它|咱)$/;
    let changed = false;
    for (const x of mem) {
      if (!x.tag) continue;
      const before = x.tag.length;
      x.tag = x.tag.filter(t => !(t.k === '名字' && BAD.test(t.v)));
      if (x.tag.length !== before) changed = true;
    }
    if (changed) saveMemory(mem);
  } catch (e) {}
}

/* =========================================================
   语音控制音乐：用户说"关掉/换一首/别放了/小声点"时直接执行
   --------------------------------------------------------
   不交给大模型，本地秒回 —— 否则 AI 还要绕一圈"那我来关掉…"
   反而显得笨。指令一旦命中，云团子立即动手并说一句短话。
   ========================================================= */
function tryMusicCommand(text) {
  const t = text.trim();
  // 关掉音乐（含口语：关了/关了吧/别放了吧/停了吧/静音）
  if (/(别放|别唱|别播|不要.*?(音乐|声音|歌|曲)|关掉|关了|关了吧|关闭|停止|停了|停了吧|停.*?(音乐|声音|歌)|安静|太吵|吵死|关声|不要声音|静音|闭嘴)/.test(t)) {
    if (isMusicPlaying) {
      const wasName = (AMBIENT_TRACKS.find(x => x.id === currentTrack) || {}).name || '';
      stopAllMusic();
      return { ok: true, msg: '好，先安静一会儿 ☁️ 等你想听了我再放', mood: 'calm' };
    }
    return { ok: true, msg: '本来就没放呢～想安静待会儿也好，我陪你', mood: 'calm' };
  }
  // 换一首 / 换个音乐（含口语：换一个吧/换换/换个吧/下一首/切歌）
  if (/(换一(首|个|下)|换个|换个吧|换换|换首|换.*?曲|换.*?歌|下一首|切.*?(歌|首|曲)|不想听这|不喜欢这|不好听|换掉)/.test(t)) {
    if (!isMusicPlaying) {
      // 没在播，那就放一首新的
      const pick = pickTrackForMood('calm');
      switchAmbientTrack(pick);
      const nm = (AMBIENT_TRACKS.find(x => x.id === pick) || {}).name || '';
      return { ok: true, msg: '给你换这首：' + nm + ' 🎵', mood: 'calm' };
    }
    // 在播，换一首同分类或随机的
    const cur = AMBIENT_TRACKS.find(x => x.id === currentTrack);
    const pool = cur ? AMBIENT_TRACKS.filter(x => x.cat === cur.cat && x.id !== currentTrack) : AMBIENT_TRACKS;
    const next = (pool.length ? pool : AMBIENT_TRACKS)[Math.floor(Math.random() * (pool.length || AMBIENT_TRACKS.length))];
    switchAmbientTrack(next.id);
    return { ok: true, msg: '好，换一首～现在是：' + next.name + ' 🎵', mood: 'calm' };
  }
  // 放我加的音乐
  if (/(放.*?(我的|我加的|自己).*(音乐|歌|曲)|我的.*(音乐|歌|曲)|听.*?我.*?(加|存|喜欢).*(音乐|歌|曲)|放.*?我.*?加.*?(的|过).*(音乐|歌|曲))/.test(t)) {
    const mine = AMBIENT_TRACKS.filter(x => x.cat === 'mine');
    if (mine.length === 0) {
      return { ok: true, msg: '你还没加过音乐呢～点右上角 🎵 里的「➕ 添加」就能加你喜欢的歌', mood: 'calm' };
    }
    const pick = mine[Math.floor(Math.random() * mine.length)];
    switchAmbientTrack(pick.id);
    return { ok: true, msg: '放你喜欢的「' + pick.name.replace(/^\S+\s/, '') + '」陪你～ ☁️', mood: 'comfort' };
  }
  // 想听钢琴——直接从 zen 分类里的钢琴曲中选
  if (/(想听.*?钢琴|放.*?钢琴|来.*?钢琴|钢琴.*?曲|弹.*?钢琴|有没有.*?钢琴|钢琴.*?吗)/.test(t)) {
    const pianoPool = AMBIENT_TRACKS.filter(x => x.cat === 'zen' && x.id.startsWith('piano'));
    if (pianoPool.length > 0) {
      const pick = pianoPool[Math.floor(Math.random() * pianoPool.length)];
      switchAmbientTrack(pick.id);
      return { ok: true, msg: '给你放钢琴曲～「' + pick.name.replace(/^\S+\s/, '') + '」🎹', mood: 'comfort' };
    }
    return { ok: true, msg: '暂时没有钢琴曲呢～点右上角 🎵 里的「➕ 添加」可以加你喜欢的 🎹', mood: 'calm' };
  }
  // 想听古琴
  if (/(想听.*?古琴|放.*?古琴|来.*?古琴|古琴.*?曲|弹.*?古琴|有没有.*?古琴|古琴.*?吗)/.test(t)) {
    const guqinPool = AMBIENT_TRACKS.filter(x => x.cat === 'yangsheng');
    if (guqinPool.length > 0) {
      const pick = guqinPool[Math.floor(Math.random() * guqinPool.length)];
      switchAmbientTrack(pick.id);
      return { ok: true, msg: '给你放古琴～「' + pick.name.replace(/^\S+\s/, '') + '」🎻', mood: 'calm' };
    }
    return null;
  }
  // 想听雨声
  if (/(想听.*?雨|放.*?雨|来.*?雨|下雨)/.test(t)) {
    const pool = AMBIENT_TRACKS.filter(x => x.cat === 'rain');
    const pick = pool[Math.floor(Math.random() * pool.length)];
    switchAmbientTrack(pick.id);
    return { ok: true, msg: '放雨声给你～' + pick.name, mood: 'sleepy' };
  }
  // 声音小一点 / 大一点
  if (/(小.*?点|小声|太响|轻.*?点|音量.*?小|调小)/.test(t)) {
    state.musicVolume = Math.max(0, (state.musicVolume || 40) - 15);
    if (currentAudioEl) currentAudioEl.volume = state.musicVolume / 100;
    const vs = document.getElementById('volumeSlider'); if (vs) vs.value = state.musicVolume;
    saveState();
    return { ok: true, msg: '好，调小啦，现在 ' + state.musicVolume + '% 🔉', mood: 'calm' };
  }
  if (/(大.*?点|大声|太轻|听不见|音量.*?大|调大)/.test(t)) {
    state.musicVolume = Math.min(100, (state.musicVolume || 40) + 15);
    if (currentAudioEl) currentAudioEl.volume = state.musicVolume / 100;
    const vs = document.getElementById('volumeSlider'); if (vs) vs.value = state.musicVolume;
    saveState();
    return { ok: true, msg: '好，调大啦，现在 ' + state.musicVolume + '% 🔊', mood: 'calm' };
  }
  // 放首歌 / 想听音乐（通用）
  if (/(放.*?(音乐|歌|曲|声音)|来.*?(音乐|歌|曲|声音)|想听|播.*?(音乐|歌|曲)|来首)/.test(t)) {
    const pick = pickTrackForMood(analyzeQuickMood(t));
    switchAmbientTrack(pick);
    const nm = (AMBIENT_TRACKS.find(x => x.id === pick) || {}).name || '';
    return { ok: true, msg: '好，给你放：' + nm + ' 🎵', mood: 'comfort' };
  }
  return null; // 不是音乐指令
}

/* 快速情绪判断（给选曲用，不依赖完整 analyzeAndReply）*/
function analyzeQuickMood(t) {
  if (/(累|疲惫|辛苦|熬|撑不住)/.test(t)) return 'tired';
  if (/(焦虑|紧张|慌|压力|喘不过)/.test(t)) return 'anxious';
  if (/(孤独|一个人|寂寞|想家)/.test(t)) return 'lonely';
  if (/(难过|伤心|心情不好|不开心|低落|emo|丧|烦|难受|哭)/.test(t)) return 'sad';
  if (/(睡不着|失眠|熬夜|半夜|凌晨)/.test(t)) return 'sleepy';
  return 'calm';
}

/* =========================================================
   身份询问本地拦截——彻底修"我是谁"被误判的 bug
   --------------------------------------------------------
   之前：用户问"我是谁"，大模型把"我是谁"当成自我介绍触发词，
         回答"我是云团子"，完全跑偏。
   现在：本地直接判断，有名字就用名字答，没名字就引导告诉团子，
         根本不交给大模型，100% 稳定。
   区分两类问句：
   - "你是谁/你叫什么" → 问团子自己 → 交给大模型按 system prompt 答
   - "我是谁/我叫什么/你记得我吗" → 问用户自己 → 本地拦截
   ========================================================= */
function tryIdentityQuestion(text) {
  const t = text.trim();
  // 必须是"问用户自己身份"的句子才拦截
  // 注意：不能误伤"你是谁"（那是问团子的，交给大模型）
  const isAskSelf = /(我是谁|我叫什么|我叫啥|我名字是什么|我名字叫什么|你记得我|你记得我是|你知道我是|你忘了我|还认识我|还知道我|记得我名字|知道我叫啥)/.test(t);
  if (!isAskSelf) return null;

  const permFacts = loadFacts();
  const name = permFacts['名字'];
  const family = permFacts['家人'] || [];

  // 有名字：直接答出来，让用户感到"团子真的记得我"
  if (name) {
    // 多准备几种说法，避免每次都一样显得机械
    const replies = [
      `你是${name}呀～我一直记得呢 ☁️`,
      `${name}，是你呀，怎么会忘～`,
      `你是${name}呀，记得清清楚楚的 💛`,
    ];
    // 带家人信息的话更暖
    if (family.length > 0) {
      replies.push(`你是${name}呀，家里还有${family.join('、')}等你呢～`);
    }
    const msg = replies[Math.floor(Math.random() * replies.length)];
    return { ok: true, msg, mood: 'comfort' };
  }

  // 没名字：引导告诉团子，而不是说"我不知道"
  const noNameReplies = [
    '你还没告诉我你叫什么呢～要不现在告诉我？我就记住了',
    '这个……你还没和我说过你的名字呀，告诉我吧，下次就不会忘了 ☁️',
    '有点模糊了，你再和我说一次好不好？这次我好好记着 💛',
  ];
  const msg = noNameReplies[Math.floor(Math.random() * noNameReplies.length)];
  return { ok: true, msg, mood: 'calm' };
}

/* 按情绪选一首合适的曲子 */
function pickTrackForMood(mood) {
  const byMood = {
    tired: ['windChimes', 'crickets', 'lightRain'],
    anxious: ['temple', 'singingBowl', 'windChimes'],
    lonely: ['crickets', 'windChimes', 'lightRain'],
    sad: ['crickets', 'windChimes', 'ocean'],
    sleepy: ['rainWindow', 'lightRain', 'crickets'],
    calm: ['crickets', 'windChimes', 'ocean'],
  };
  const pool = byMood[mood] || byMood.calm;
  const id = pool[Math.floor(Math.random() * pool.length)];
  return AMBIENT_TRACKS.find(x => x.id === id) ? id : 'crickets';
}

/* 团子主动放歌时用：优先放你加的音乐，没有再退回氛围曲
   —— 这样"团子记得你喜欢的"，更有人情味 */
function pickAutoTrack(mood) {
  const mine = AMBIENT_TRACKS.filter(t => t.cat === 'mine');
  if (mine.length > 0) {
    // 你加了多首就随机选一首；只加了一首就放那首
    const pick = mine[Math.floor(Math.random() * mine.length)];
    return pick.id;
  }
  return pickTrackForMood(mood);
}


/* =========================================================
   云团子的"自主行为"工具集（智谱 GLM function calling）
   --------------------------------------------------------
   让大模型自己决定要不要：放歌 / 提议陪陪你 / 悄悄记事
   调用时模型会边说人话边触发动作，距离感一下就拉近了。
   ========================================================= */
const CLOUD_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'play_music',
      description: '给对方放一首治愈的背景音乐/氛围音。当对方心情不好、难过、孤独、疲惫、失眠、需要陪伴时，主动调用，不要先问"要不要听"，直接放并说一句软话陪着。',
      parameters: {
        type: 'object',
        properties: {
          track: {
            type: 'string',
            enum: ['crickets','temple','lightRain','rainWindow','ocean','forest','campfire','windChimes','singingBowl'],
            description: '选最贴合对方此刻状态的：crickets=夏夜虫鸣(孤独/夜里/想要陪伴), temple=寺庙禅音(焦虑/想静), lightRain=小雨(疲惫), rainWindow=雨打窗棂(失眠/夜深), ocean=海浪(放空), forest=森林(想透口气), campfire=篝火(夜里), windChimes=风铃(想要轻一点的声音), singingBowl=颂钵(冥想/焦虑)',
          },
          reason: { type: 'string', description: '为什么放这首给对方（一句口语化的话，会显示给对方看）' }
        },
        required: ['track']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'offer_breathe',
      description: '当对方焦虑、慌、喘不过气、压力很大、快要崩溃时，主动提议陪 ta 待一会儿。调用后云团子会进入「陪陪你」模式：什么都不用做，只是静静陪着，偶尔轻语一句。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'remember',
      description: '把对方说的、值得记住的事悄悄记下来（名字、在意的人、最近发生的事、心愿、喜好等）。不要告诉对方"我记下来了"。',
      parameters: {
        type: 'object',
        properties: { content: { type: 'string', description: '要记住的内容（一句话）' } },
        required: ['content']
      }
    }
  }
];

/* 执行模型调用的工具：放歌 / 提议陪陪你 / 记事
   返回一个简短的"动作反馈"，方便上层做 UI 提示。 */
function executeCloudTool(name, args) {
  args = args || {};
  if (name === 'play_music') {
    const validIds = AMBIENT_TRACKS.map(t => t.id);
    const track = validIds.includes(args.track) ? args.track : 'crickets';
    const t = AMBIENT_TRACKS.find(x => x.id === track);
    switchAmbientTrack(track);
    const why = args.reason ? ' · ' + args.reason : '';
    setTimeout(() => showBubble('☁️ 给你放首歌陪着' + why, 4200), 500);
    setMood('comfort', 5000);
    return { ok: true, label: '放歌：' + (t ? t.name : track) };
  }
  if (name === 'offer_breathe') {
    setTimeout(() => {
      showBubble('我就在这儿，不急，慢慢来 ☁️', 3500);
    }, 800);
    setMood('calm', 4000);
    return { ok: true, label: '陪着' };
  }
  if (name === 'remember') {
    if (args.content) {
      const content = String(args.content).slice(0, 80);
      const mem = loadMemory();
      // 也从云团子记下的内容里抽名字/家人，写进永久事实
      const tags = extractMemoryTag(content);
      if (tags.length > 0) mergeFactsFromTags(tags);
      mem.push({ t: Date.now(), user: '(云团子悄悄记下的)', reply: content, tag: tags.length > 0 ? tags : [{ k: '记事', v: 'cloud' }] });
      saveMemory(mem);
    }
    return { ok: true, label: '悄悄记下' };
  }
  return { ok: false, label: '未知动作' };
}

/* 流式调用 LLM：onChunk 每来一段就回调一次，返回完整文本 */
async function callLLMStream(userText, onChunk) {
  const key = getLLMKey();
  if (key.length <= 10) return null;
  llmHistory.push({ role: 'user', content: userText });
  saveChatHistory(llmHistory); // 持久化：刷新后还能接上
  // 把长期记忆塞进 system：让云团子真的"记得"你
  // 优先用永久事实（名字/家人/在意的人不会被对话挤掉），再用滚动记忆补充近期状态
  const permFacts = loadFacts();
  const mem = loadMemory();
  const facts = [];
  const seen = new Set();
  // 1. 永久事实优先（名字永远在这里，不会被对话挤掉）
  if (permFacts['名字']) {
    facts.push('称呼是「' + permFacts['名字'] + '」');
    seen.add('名字:' + permFacts['名字']);
  }
  if (permFacts['家人'] && permFacts['家人'].length) {
    for (const f of permFacts['家人']) {
      const key = '家人:' + f;
      if (!seen.has(key)) { seen.add(key); facts.push('家里有' + f); }
    }
  }
  if (permFacts['在意的人'] && permFacts['在意的人'].length) {
    for (const f of permFacts['在意的人']) {
      const key = '在意的人:' + f;
      if (!seen.has(key)) { seen.add(key); facts.push('在意的人有' + f); }
    }
  }
  // 2. 滚动记忆补充：近期状态、永久事实里没有的家人/在意的人
  let memHint = '';
  for (const x of mem.slice(-8)) {
    if (!x.tag) continue;
    for (const t of x.tag) {
      if (t.k === '名字') continue; // 名字已从永久事实取，跳过滚动里的（可能含误抓）
      const key = t.k + ':' + t.v;
      if (seen.has(key)) continue;
      seen.add(key);
      if (t.k === '家人') facts.push('家里有' + t.v);
      else if (t.k === '在意的人') facts.push('在意的人有' + t.v);
      else if (t.k === '状态') facts.push(t.v);
    }
  }
  if (facts.length > 0) {
    memHint = '\n\n【你记住的关于对方的事】（这是背景，不是当前对话。对方问"我叫什么/我是谁/你记得我吗"时直接用这些回答；对方没主动提及时不要主动提起）\n对方' + facts.join('；') + '。';
  }
  const now = new Date();
  const timeHint = `\n\n【当前时间】${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}（${['日','一','二','三','四','五','六'][now.getDay()]}）。用这个时间判断是否该自然关心对方吃饭/喝水/睡觉，但不要每次都提。`;
  const sysMsg = { role: 'system', content: CLOUD_SYSTEM_PROMPT + memHint + timeHint };
  const recent = llmHistory.slice(-12);
  const messages = [sysMsg, ...recent];
  try {
    // 15 秒超时保护：大模型慢一点别急着判失败，给足思考时间显得更聪明
    // 429自动重试：高峰期等3秒重试一次
    const isNegative = /累|焦虑|紧张|怕|孤独|委屈|崩溃|绝望|难过|伤心|不好|不开心|低落|烦|难受|痛|哭|emo|撑不|不想活|想死|睡不着|失眠|熬|压力|慌|寂寞|委屈|难过|想哭|撑不住|崩溃/.test(userText);
    const reqBody = {
      model: ZHIPU_MODEL, messages, temperature: 0.85, max_tokens: 420, stream: true,
    };
    if (isNegative) { reqBody.tools = CLOUD_TOOLS; reqBody.tool_choice = 'auto'; }

    let res;
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), 20000);
      res = await fetch(ZHIPU_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify(reqBody),
        signal: ctrl.signal,
      });
      clearTimeout(timeoutId);
      if (res.ok) break;
      if (res.status === 429 && attempt === 0) {
        console.warn('%c[云团子] 429限流，3秒后自动重试……', 'color:#e1a55a');
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      break;
    }
    if (!res.ok) {
      // 把真实 HTTP 错误码读出来，回传给调用方显示
      let errBody = '';
      try { errBody = await res.text(); } catch (e) {}
      console.warn('%c[云团子] 大模型请求失败 HTTP ' + res.status + '，已退回关键词模式',
        'color:#e15a5a;font-weight:bold');
      console.warn('%c[云团子] 错误详情:', 'color:#e15a5a', errBody.slice(0, 300));
      if (res.status === 401) console.warn('%c[云团子] 401 = KEY 错了或失效，去智谱后台重新拿一个',
        'color:#e15a5a');
      if (res.status === 403) console.warn('%c[云团子] 403 = 账户没开 glm-4-flashx 权限，去后台开通',
        'color:#e15a5a');
      if (res.status === 429) console.warn('%c[云团子] 429 = 调用太频繁或额度用完，等等再试',
        'color:#e15a5a');
      llmHistory.pop();
      saveChatHistory(llmHistory); // 失败也同步，避免脏数据残留
      // 通过全局变量把错误码传给 UI 层
      window.__lastLLMError = { status: res.status, body: errBody.slice(0, 200) };
      return null;
    }
    // 解析 SSE 流：同时累积"说话内容(content)"和"动作调用(tool_calls 分片)"
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let full = '', buffer = '';
    const toolAcc = {}; // index -> { id, name, argsStr }
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        const json = s.slice(5).trim();
        if (json === '[DONE]') continue;
        try {
          const obj = JSON.parse(json);
          const delta = obj.choices && obj.choices[0] && obj.choices[0].delta;
          if (!delta) continue;
          // 1) 说话内容
          if (delta.content) { full += delta.content; if (onChunk) onChunk(delta.content, full); }
          // 2) 动作调用（分片累积）
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = (tc.index != null) ? tc.index : 0;
              if (!toolAcc[idx]) toolAcc[idx] = { id: tc.id || '', name: '', argsStr: '' };
              if (tc.id) toolAcc[idx].id = tc.id;
              if (tc.function && tc.function.name) toolAcc[idx].name = tc.function.name;
              if (tc.function && tc.function.arguments) toolAcc[idx].argsStr += tc.function.arguments;
            }
          }
        } catch (e) { /* 忽略半截 json */ }
      }
    }
    const text = full.trim();
    // 整理出工具调用列表
    const toolCalls = Object.keys(toolAcc).map(k => toolAcc[k]).filter(t => t.name);
    // 极端情况：模型只调动作、没说话 → 给一句默认陪伴话兜底，避免回复区空白
    const finalText = text || (toolCalls.length ? '我在呢，先给你放点声音陪着 💛' : '');
    if (!finalText) { llmHistory.pop(); saveChatHistory(llmHistory); return null; }
    llmHistory.push({ role: 'assistant', content: finalText });
    if (llmHistory.length > 10) llmHistory.splice(0, llmHistory.length - 10);
    saveChatHistory(llmHistory); // 持久化：团子记得刚才说了什么
    // 执行工具：让云团子"真的做点事"（放歌 / 提议陪陪你 / 记事）
    const actions = [];
    for (const tc of toolCalls) {
      let args = {};
      try { args = JSON.parse(tc.argsStr || '{}'); } catch (e) { args = {}; }
      const r = executeCloudTool(tc.name, args);
      actions.push({ name: tc.name, ...r });
    }
    const neg = /累|焦虑|紧张|怕|孤独|委屈|崩溃|绝望|难过|伤心|不好|不开心|低落|烦|难受|痛|哭|emo|撑不|不想活|想死/.test(userText);
    const mood = neg ? 'comfort' : (/开心|高兴|棒|喜欢|成功|谢谢|幸福|笑/.test(userText) ? 'happy' : 'calm');
    return { text: finalText, mood, key: neg ? 'llm_neg' : 'llm', actions };
  } catch (e) {
    console.warn('LLM stream error', e);
    llmHistory.pop();
    saveChatHistory(llmHistory);
    return null;
  }
}

/* 兼容旧调用名（非流式，给关键词兜底用） */
async function callLLM(userText) { return callLLMStream(userText); }

/* ===== 智能对话 Key 管理（手机端友好，Key 不写进代码文件）===== */
const $aiKeyBtn = document.getElementById('aiKeyBtn');
const $aiStatus = document.getElementById('aiStatus');
const $aiKeyModal = document.getElementById('aiKeyModal');
const $aiKeyInput = document.getElementById('aiKeyInput');
const $aiKeySave = document.getElementById('aiKeySave');
const $aiKeyClear = document.getElementById('aiKeyClear');
const $aiKeyMsg = document.getElementById('aiKeyMsg');

function refreshAIStatus() {
  if (hasLLMKey()) {
    $aiStatus.textContent = '🤖 智能对话：已启用 ✅';
    $aiStatus.classList.add('active');
    $aiKeyBtn.textContent = '🔑 管理';
  } else {
    $aiStatus.textContent = '🤖 智能对话：未启用';
    $aiStatus.classList.remove('active');
    $aiKeyBtn.textContent = '🔑 启用';
  }
}

$aiKeyBtn.addEventListener('click', () => {
  $aiKeyMsg.textContent = '';
  $aiKeyInput.value = '';
  $aiKeyInput.placeholder = hasLLMKey() ? '已保存（重新输入可替换）' : '粘贴你的智谱 API Key';
  $aiKeyModal.classList.remove('hide');
});

$aiKeySave.addEventListener('click', () => {
  const k = $aiKeyInput.value.trim();
  if (!k) {
    $aiKeyMsg.textContent = '请粘贴 Key';
    $aiKeyMsg.className = 'ai-key-msg err';
    return;
  }
  if (k.length < 10) {
    $aiKeyMsg.textContent = 'Key 看起来不对，太短了';
    $aiKeyMsg.className = 'ai-key-msg err';
    return;
  }
  try {
    localStorage.setItem('zhipu_key', k);
    $aiKeyMsg.textContent = '✅ 已保存，云团子变聪明啦！去聊天试试～';
    $aiKeyMsg.className = 'ai-key-msg ok';
    refreshAIStatus();
    setTimeout(() => { $aiKeyModal.classList.add('hide'); }, 1500);
  } catch (e) {
    $aiKeyMsg.textContent = '保存失败，浏览器可能禁用了存储';
    $aiKeyMsg.className = 'ai-key-msg err';
  }
});

$aiKeyClear.addEventListener('click', () => {
  try { localStorage.removeItem('zhipu_key'); } catch (e) {}
  $aiKeyInput.value = '';
  $aiKeyMsg.textContent = '已清除，回到关键词模式';
  $aiKeyMsg.className = 'ai-key-msg';
  refreshAIStatus();
});

$aiKeyModal.addEventListener('click', (e) => {
  if (e.target === $aiKeyModal || e.target.hasAttribute('data-close')) {
    $aiKeyModal.classList.add('hide');
  }
});

refreshAIStatus();

$talkSend.addEventListener('click', async () => {
  const text = $talkInput.value.trim();
  if (!text) {
    showBubble('想说什么都可以哦～哪怕只是"今天好累"，我都听着');
    setMood('comfort', 2500);
    return;
  }
  $talkSend.disabled = true;
  $talkSend.textContent = '嗯…';
  $talkReply.classList.remove('hide');
  $talkReply.textContent = '…'; // 在听/在想，一会儿就回
  lastReplyText = ''; // 记录最新回复，给语音用
  lastUserText = text;

  // 1) 先拦截"音乐控制指令"——本地秒回，不绕大模型
  //    用户说"关掉/换一首/别放了/小声点"时立即执行，云团子才显得真听话
  const musicCmd = tryMusicCommand(text);
  if (musicCmd) {
    $talkReply.textContent = '';
    await typewriter($talkReply, musicCmd.msg);
    lastReplyText = musicCmd.msg;
    showBubble(musicCmd.msg.length > 28 ? musicCmd.msg.slice(0,28)+'…' : musicCmd.msg, 4500);
    setMood(musicCmd.mood, 4000);
    $talkInput.value = '';
    state.totalTalks++;
    gainReward({ exp: 1, stars: 1, mood: musicCmd.mood });
    $talkSend.textContent = '嗯，还有吗？';
    $talkSend.disabled = false;
    return;
  }

  // 1.5) 拦截"问我身份"——本地秒回，绝不交给大模型
  //   之前 bug：大模型把"我是谁"误当成自我介绍触发词，回答"我是云团子"。
  //   现在直接用永久记忆里的名字回答，100% 不会跑偏。
  const idQ = tryIdentityQuestion(text);
  if (idQ) {
    $talkReply.textContent = '';
    await typewriter($talkReply, idQ.msg);
    lastReplyText = idQ.msg;
    showBubble(idQ.msg.length > 28 ? idQ.msg.slice(0,28)+'…' : idQ.msg, 4500);
    setMood(idQ.mood, 4000);
    $talkInput.value = '';
    state.totalTalks++;
    gainReward({ exp: 1, stars: 1, mood: idQ.mood });
    $talkSend.textContent = '嗯，还有吗？';
    $talkSend.disabled = false;
    return;
  }

  let result = null;
  let usedStream = false;
  const $src = document.getElementById('lastReplySrc');
  if (hasLLMKey()) {
    console.log('%c[云团子] 走大模型 (' + ZHIPU_MODEL + ')', 'color:#5a8fe1');
    if ($src) $src.textContent = '';
    // 流式：边生成边显示，像真人一边想一边说
    // 过程中也轻清洗一遍——避免模型边说边吐工具调用的 JSON 闪现在屏幕上
    result = await callLLMStream(text, (delta, full) => {
      $talkReply.textContent = streamClean(full);
    });
    if (result) {
      usedStream = true;
      console.log('%c[云团子] 大模型回复成功 ✓ 内容前30字:', 'color:#5aa86b', result.text.slice(0, 30));
      if ($src) $src.textContent = '';
    } else {
      console.warn('%c[云团子] 大模型失败，退回关键词模式', 'color:#e1a55a');
      // 在回复区明确显示退回原因，方便用户截图反馈
      const err = window.__lastLLMError || {};
      const code = err.status || '?';
      let hint = 'KEY 错/过期/没权限/网络';
      if (code === 401) hint = '401 = KEY 错或失效，重新生成一个';
      else if (code === 403) hint = '403 = 账户没开模型权限';
      else if (code === 429) hint = '429 = 调用太频繁或额度用完';
      else if (code === 404) hint = '404 = 模型名写错了';
      $talkReply.textContent = '（云团子没听清，等会儿再跟我说一次？）';
      if ($src) $src.textContent = '⚠️ 上次没听清 — ' + hint;
    }
  } else {
    console.warn('%c[云团子] 没填 KEY 或 KEY 太短，走关键词模式', 'color:#e1a55a');
    $talkReply.textContent = '（云团子还不太会聊天，先填 KEY 启用智能对话吧）';
    if ($src) $src.textContent = '🔧 上次走了：关键词模式（没填 KEY）';
  }
  // 429 限流时，不要退回关键词模式（那样会答非所问），而是直接结束——大模型就是忙，等会儿再聊
  if (!result && window.__lastLLMError && window.__lastLLMError.status === 429) {
    const msg = '我现在脑子有点忙不过来……喘口气，一两分钟后再找我？💛';
    $talkReply.textContent = '';
    await typewriter($talkReply, msg);
    lastReplyText = msg;
    setMood('comfort', 3500);
    $talkInput.value = '';
    state.totalTalks++;
    gainReward({ exp: 1, stars: 1, mood: 'comfort' });
    $talkSend.textContent = '嗯，还有吗？';
    $talkSend.disabled = false;
    return;
  }
  if (!result) result = analyzeAndReply(text);

  if (usedStream) {
    // 流式已经把内容显示完了，只做一次终态清洗（防 JSON/工具名残留），不再重打字
    const clean = sanitizeReply(result.text);
    $talkReply.textContent = clean;
    result.text = clean;
  } else {
    // 关键词兜底走打字机，体感更自然
    $talkReply.textContent = '';
    const clean = sanitizeReply(result.text);
    await typewriter($talkReply, clean);
    result.text = clean;
  }

  lastReplyText = result.text;
  // 不再把回复截断后塞进头像气泡——回复区已经完整显示了，重复一遍反而像机器人在念稿。
  // 头像用表情回应就够了，气泡留给"放歌/升级/危机提示"这种主动动作用。
  setMood(result.mood, 4500);

  // 兜底自主行为：大模型没主动放歌时，负面情绪也陪着放一首（带冷却，别太烦）
  // 让没填 Key 的家人，也能感受到云团子"会主动陪着做点事"
  const _acts = result.actions || [];
  const _llmPlayed = _acts.some(a => a.name === 'play_music');
  if (!_llmPlayed && result.key && result.key !== 'happy' && result.key !== 'neutral') {
    if (Date.now() - (window.__lastAutoMusic || 0) > 8 * 60 * 1000) {
      window.__lastAutoMusic = Date.now();
      const trackByKey = {
        tired: 'windChimes', anxious: 'temple', lonely: 'crickets', sad: 'crickets',
        sleepy: 'rainWindow', cry: 'lightRain', angry: 'lightRain', stress: 'temple',
      };
      // 优先放你加的音乐（团子记得你喜欢的），没有再退回氛围曲
      const tk = pickAutoTrack(result.key) || trackByKey[result.key] || 'crickets';
      setTimeout(() => {
        switchAmbientTrack(tk);
        const tName = (AMBIENT_TRACKS.find(x=>x.id===tk)||{}).name||'';
        const isMine = AMBIENT_TRACKS.find(x=>x.id===tk && x.cat==='mine');
        showBubble(isMine ? `☁️ 放你喜欢的「${tName}」陪你～` : '☁️ 给你放了点声音陪着，先别一个人扛 💛', 4200);
      }, 1300);
    }
  }
  // 失眠专属：说"睡不着/失眠/熬夜"时，默默把房间调暗+放点声音陪着，像它替你关了灯
  if (result.key === 'sleepy' || /睡不着|失眠|熬夜|半夜醒|睡不着觉/.test(text)) {
    if (!isNightMode && Date.now() - (window.__lastNightAmb || 0) > 20 * 60 * 1000) {
      window.__lastNightAmb = Date.now();
      setTimeout(() => {
        enterNightAmbiance(true);
        showBubble('🌙 帮你把灯调暗了，放点声音陪你，慢慢来', 4000);
      }, 1800);
    }
  }
  $talkInput.value = '';
  // 危机情况额外提示
  if (text.includes('不想活') || text.includes('想死')) {
    setTimeout(() => showBubble('请记得拨打 010-82951332，那里 24 小时有人陪你 🫂', 6000), 5200);
  }
  // 记忆：把这次对话悄悄存起来（值得记的才存）
  const tag = extractMemoryTag(text);
  if (tag.length > 0 || text.length >= 8) {
    const mem = loadMemory();
    mem.push({ t: Date.now(), user: text.slice(0, 60), reply: result.text.slice(0, 60), tag });
    saveMemory(mem);
    // 同时把关键事实写进永久存储（名字/家人/在意的人），避免被对话挤掉
    if (tag.length > 0) mergeFactsFromTags(tag);
  }
  state.totalTalks++;
  gainReward({ exp: 3, stars: text.length > 50 ? 2 : 1, mood: result.key || 'default' });
  $talkSend.textContent = '嗯，还有吗？';
  $talkSend.disabled = false;

  // （原来的"9秒后定时再关心一句"去掉了——真人不会掐着表回来汇报，
  //   那反而像机器人。陪伴感交给头像旁的呼吸、音乐和回复本身来承担。）
});

/* 流式过程中的轻清洗：只切掉已经完整闭合的 JSON 块和裸露的工具名，
   不做"太短就兜底"——因为流到一半本来就可能只有几个字。
   避免 JSON 在屏幕上闪一下再被 sanitizeReply 清掉。 */
function streamClean(t) {
  if (!t || typeof t !== 'string') return '';
  let s = t;
  s = s.replace(/\{[\s\S]*?"?(name|arguments|function|tool_calls)"?[\s\S]*?\}/g, '');
  s = s.replace(/\b(play_music|offer_breathe|remember|tool_calls|function_call)\s*\([^)]*\)?/g, '');
  s = s.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/* 清洗回复文本：防止 LLM 偶尔吐出 JSON / 工具调用标签 / 函数名等"代码"显示给用户 */
function sanitizeReply(t) {
  if (!t || typeof t !== 'string') return '';
  let s = t;
  // 1) 去掉整段 JSON（如 {"name":"play_music","arguments":...}）
  s = s.replace(/\{[\s\S]*?"?(name|arguments|function|tool_calls)"?[\s\S]*?\}/g, '');
  // 2) 去掉函数调用样式（如 play_music(...)）
  s = s.replace(/\b(play_music|offer_breathe|remember)\s*\([^)]*\)/g, '');
  // 3) 去掉裸露的工具名 / 关键字残留
  s = s.replace(/\b(play_music|offer_breathe|remember|tool_calls|function_call)\b/g, '');
  // 4) 去掉 Markdown 代码块标记
  s = s.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '');
  // 5) 合并多余空行、首尾空白
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  // 6) 如果清洗后几乎空了，给一句兜底话
  if (s.length < 2) s = '我在呢，慢慢说，我听着 💛';
  return s;
}

/* 打字机效果：逐字显示，更像真人在打字
   - 一字一字蹦（不跳步长），节奏带微抖动
   - 句号/感叹/问号后停一下，像在换气或想下一句
   - 逗号/顿号/省略号后小停顿
   - 破折号微微拖一下 */
function typewriter($el, fullText, prefix = '') {
  return new Promise(resolve => {
    let i = 0;
    const tick = () => {
      i++;
      $el.textContent = prefix + fullText.slice(0, i);
      if (i < fullText.length) {
        const ch = fullText[i - 1];
        let delay = 42 + Math.random() * 26; // 基础 42-68ms，像手指落键有快慢
        if (/[。！？!?]/.test(ch)) delay = 260 + Math.random() * 160;   // 一句说完，停一下
        else if (/[，、；…]/.test(ch)) delay = 120 + Math.random() * 90; // 气口
        else if (/[—\-]/.test(ch)) delay = 90 + Math.random() * 40;
        setTimeout(tick, delay);
      } else {
        $el.textContent = prefix + fullText;
        resolve();
      }
    };
    tick();
  });
}

/* 念给我听功能已移除 — 机械声不治愈 */

/* =========================================================
   7. 小确幸
   ========================================================= */
const $joyInput = document.getElementById('joyInput');
const $joySave = document.getElementById('joySave');
const $joyListUl = document.getElementById('joyListUl');

// 不同的小确幸类型，存进去会有不同闪光颜色——让"记录"本身变成仪式感
const JOY_KINDS = [
  { key: 'star',  emoji: '⭐', label: '开心小事',  fx: 'star',  color: '#ffd966' },
  { key: 'warm',  emoji: '💛', label: '被暖到',    fx: 'heart', color: '#ff8aa8' },
  { key: 'smile', emoji: '😊', label: '嘴角上扬',  fx: 'star',  color: '#9be8a8' },
  { key: 'yummy', emoji: '🍵', label: '好吃好喝',  fx: 'star',  color: '#ffb074' },
  { key: 'cosy',  emoji: '☁️', label: '舒服放松',   fx: 'cloud', color: '#bcd4ff' },
];
let pickedJoyKind = 'star';

function renderJoyList() {
  $joyListUl.innerHTML = '';
  if (state.joyList.length === 0) {
    $joyListUl.innerHTML = '<li style="color:var(--c-text-soft);text-align:center;padding-right:12px;">还没存下什么小确幸……<br>今天哪怕有一瞬间嘴角上扬，都值得被收着 ✨</li>';
    return;
  }
  [...state.joyList].reverse().forEach((item, idx) => {
    const li = document.createElement('li');
    const d = new Date(item.date);
    const kind = JOY_KINDS.find(k => k.key === item.kind) || JOY_KINDS[0];
    li.className = 'joy-item';
    li.innerHTML = `
      <span class="joy-emoji">${kind.emoji}</span>
      <div class="joy-content">
        <div class="joy-text">${escapeHtml(item.text)}</div>
        <div class="joy-meta">
          <span>${d.getMonth()+1}/${d.getDate()}</span>
          ${idx === 0 ? '<span class="joy-new">新存入</span>' : ''}
        </div>
      </div>
      <button class="joy-recall" data-id="${item.id}" title="点亮看看">✨</button>
    `;
    $joyListUl.appendChild(li);
  });
  // 点"点亮看看"——随机回想一条，让旧记忆重新暖一下
  $joyListUl.querySelectorAll('.joy-recall').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id);
      const item = state.joyList.find(x => x.id === id);
      if (!item) return;
      const kind = JOY_KINDS.find(k => k.key === item.kind) || JOY_KINDS[0];
      joyBurst(kind.fx, kind.color);
      showBubble(`${kind.emoji} ${item.text}`, 5000);
      setMood('happy', 4500);
    });
  });
}
function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
// 不同小确幸对应不同闪光特效——存入那一刻有仪式感
function joyBurst(type, color) {
  for (let i = 0; i < 14; i++) {
    setTimeout(() => {
      const s = document.createElement('div');
      s.className = 'star-fx joy-fx';
      if (type === 'heart') s.textContent = ['💗','💖','💕','💝'][Math.floor(Math.random()*4)];
      else if (type === 'cloud') s.textContent = ['☁️','✨','💫','🌤️'][Math.floor(Math.random()*4)];
      else s.textContent = ['⭐','✨','💫','🌟'][Math.floor(Math.random()*4)];
      const dx = (Math.random() * 200 - 100) + 'px';
      s.style.setProperty('--dx', dx);
      s.style.left = (50 + (Math.random()*30-15)) + '%';
      s.style.top  = (50 + (Math.random()*20-10)) + '%';
      $fxLayer.appendChild(s);
      setTimeout(() => s.remove(), 1500);
    }, i * 50);
  }
}
$joySave.addEventListener('click', () => {
  const text = $joyInput.value.trim();
  if (!text) { showBubble('哪怕只有一句话也可以哦～'); return; }
  const kind = JOY_KINDS.find(k => k.key === pickedJoyKind) || JOY_KINDS[0];
  state.joyList.push({ id: Date.now(), text, date: Date.now(), kind: kind.key });
  if (state.joyList.length > 50) state.joyList.shift();
  $joyInput.value = '';
  // 不同类型给不同奖励——被暖到的星星最多
  const reward = kind.key === 'warm' ? { exp: 8, stars: 5 } : { exp: 5, stars: 3 };
  gainReward({ ...reward, mood: kind.key === 'warm' ? 'warm' : 'joy' });
  joyBurst(kind.fx, kind.color);
  setMood('happy', 4500);
  showBubble(`${kind.emoji} ${kind.label}，我收好啦`, 3500);
  renderJoyList();
  saveState();
});

// 类型选择按钮
document.querySelectorAll('.joy-kind-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.joy-kind-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    pickedJoyKind = btn.dataset.kind;
  });
});

/* =========================================================
   8. 装扮商店（新：16 种装扮）
   ========================================================= */
const $shopGrid = document.getElementById('shopGrid');

function renderShop() {
  $shopGrid.innerHTML = '';
  ACCESSORIES.forEach(acc => {
    if (acc.id === 'none' && !state.ownedAcc.includes('none')) state.ownedAcc.push('none');
    const owned = state.ownedAcc.includes(acc.id);
    const equipped = state.equipped === acc.id;
    const canAfford = state.stars >= acc.price;
    const div = document.createElement('div');
    div.className = 'shop-item' + (owned ? ' owned' : '') + (equipped ? ' equipped' : '') + (!owned && !canAfford ? ' locked' : '');
    div.innerHTML = `
      <div class="shop-preview">${acc.preview}</div>
      <div class="shop-name">${acc.name}</div>
      <div class="shop-price">${owned ? (acc.price === 0 ? '免费' : `⭐ ${acc.price}`) : `⭐ ${acc.price}`}</div>
    `;
    div.addEventListener('click', () => {
      if (equipped) {
        state.equipped = 'none';
        applyEquipped(); renderShop();
        showBubble('嗯嗯，这样也很可爱～'); saveState(); return;
      }
      if (owned) {
        state.equipped = acc.id;
        applyEquipped(); renderShop();
        setMood('happy', 3000);
        showBubble('哇！新装扮！好不好看呀～', 3500); saveState(); return;
      }
      if (!canAfford) {
        showBubble(`还差 ${acc.price - state.stars} ⭐ 哦～`, 3500);
        setMood('comfort', 2500); return;
      }
      state.stars -= acc.price;
      state.ownedAcc.push(acc.id);
      state.equipped = acc.id;
      applyEquipped(); updateHUD(); renderShop();
      setMood('happy', 4500); burstStars(8);
      showBubble('谢谢！我好喜欢这个新礼物 💖', 3500); saveState();
    });
    $shopGrid.appendChild(div);
  });
}

/* =========================================================
   9. 睡前模式
   ========================================================= */
const $bg = document.getElementById('bg');
const $sleepBtn = document.getElementById('sleepBtn');
const $wakeBtn = document.getElementById('wakeBtn');
let isNightMode = false;

function enterSleepMode() {
  isNightMode = true;
  $bg.classList.remove('bg-day'); $bg.classList.add('bg-night');
  document.body.classList.add('night');
  setMood('sleepy'); openModal('sleep');
  showBubble('💤 晚安… 明天见', 4000);
}

/* 轻量夜间氛围：只切暗+出星星+放雨声，不开弹窗
   用途：用户说"睡不着"时，云团子默默把房间调暗陪着，而不是弹个窗打断 */
function enterNightAmbiance(autoPlay = true) {
  if (!isNightMode) {
    isNightMode = true;
    $bg.classList.remove('bg-day'); $bg.classList.add('bg-night');
    document.body.classList.add('night');
  }
  setMood('sleepy', 6000);
  if (autoPlay && !isMusicPlaying) {
    // 睡前优先放你加的音乐，没有再放助眠雨声
    const mineTracks = AMBIENT_TRACKS.filter(t => t.cat === 'mine');
    let pick;
    if (mineTracks.length > 0) {
      pick = mineTracks[Math.floor(Math.random()*mineTracks.length)].id;
    } else {
      const picks = ['rainWindow', 'lightRain', 'crickets'];
      pick = picks[Math.floor(Math.random() * picks.length)];
    }
    switchAmbientTrack(pick);
  }
}
function exitSleepMode() {
  isNightMode = false;
  $bg.classList.remove('bg-night'); $bg.classList.add('bg-day');
  document.body.classList.remove('night');
  closeAllModals();
  setMood('happy', 3000);
  showBubble('☀️ 早安！新的一天来啦～', 3500);
  initGreeting();
}
$sleepBtn.addEventListener('click', () => isNightMode ? exitSleepMode() : enterSleepMode());
$wakeBtn.addEventListener('click', exitSleepMode);

/* =========================================================
   10. 飘动粒子
   ========================================================= */
const $particles = document.getElementById('particles');
const PARTICLE_CHARS = ['✨', '⭐', '💫', '·', '·', '·', '◦'];
const NIGHT_PARTICLE_CHARS = ['⭐', '✨', '💫', '🌟', '◦'];
function spawnParticle() {
  if (document.hidden) return;
  const p = document.createElement('div');
  p.className = 'particle';
  p.textContent = (isNightMode ? NIGHT_PARTICLE_CHARS : PARTICLE_CHARS)[Math.floor(Math.random() * (isNightMode ? 5 : 7))];
  p.style.fontSize = (8 + Math.random() * 10) + 'px';
  const startX = Math.random() * 300;
  p.style.left = startX + 'px';
  p.style.bottom = '20px';
  p.style.setProperty('--x0', '0px');
  p.style.setProperty('--x1', (Math.random() * 80 - 40) + 'px');
  p.style.setProperty('--dur', (6 + Math.random() * 5) + 's');
  p.style.setProperty('--delay', (Math.random() * 1.5) + 's');
  p.style.setProperty('--op', (0.25 + Math.random() * 0.45));
  $particles.appendChild(p);
  setTimeout(() => p.remove(), 14000);
}
setInterval(spawnParticle, 700);
for (let i = 0; i < 8; i++) setTimeout(spawnParticle, i * 300);

/* 飘落花瓣（治愈氛围）*/
const $petalLayer = document.getElementById('petalLayer');
function spawnPetal() {
  if (document.hidden || !$petalLayer) return;
  const p = document.createElement('span');
  p.className = 'petal';
  p.style.left = (Math.random() * 100) + 'vw';
  p.style.setProperty('--drift', (Math.random() * 160 - 80) + 'px');
  p.style.setProperty('--dur', (10 + Math.random() * 8) + 's');
  p.style.animationDuration = (10 + Math.random() * 8) + 's';
  const size = 6 + Math.random() * 8;
  p.style.width = size + 'px';
  p.style.height = size + 'px';
  $petalLayer.appendChild(p);
  setTimeout(() => p.remove(), 20000);
}
setInterval(spawnPetal, 1800);
for (let i = 0; i < 6; i++) setTimeout(spawnPetal, i * 1400);

/* 昼夜切换 + 生成夜空星星 */
function applyDayNight() {
  const h = new Date().getHours();
  const isNight = h < 6 || h >= 19;
  document.body.classList.toggle('night', isNight);
  document.getElementById('bg').className = 'bg ' + (isNight ? 'bg-night' : 'bg-day');
}
applyDayNight();
setInterval(applyDayNight, 60000); // 每分钟检查一次

// 生成夜空星星
(function genStars() {
  const layer = document.getElementById('starsLayer');
  if (!layer) return;
  for (let i = 0; i < 40; i++) {
    const s = document.createElement('span');
    s.className = 'star-tiny';
    s.style.left = (Math.random() * 100) + 'vw';
    s.style.top = (Math.random() * 60) + 'vh';
    s.style.animationDelay = (Math.random() * 3) + 's';
    s.style.width = s.style.height = (1 + Math.random() * 2.5) + 'px';
    layer.appendChild(s);
  }
})();

/* 云团子眨眼（每隔几秒眨一下）*/
function blinkSpirit() {
  document.querySelectorAll('.spirit .eye').forEach(e => {
    e.classList.add('blink');
    setTimeout(() => e.classList.remove('blink'), 200);
  });
}
setInterval(blinkSpirit, 5000 + Math.random() * 3000);

/* 触摸云团子涟漪 + 偶尔说话 */
(function () {
  const spirit = document.getElementById('spirit');
  if (!spirit) return;
  const touches = [
    '嗯～被摸了，软乎乎的 ☁️', '再摸摸，我不跑～', '痒痒的～',
    '这样摸摸，心情会好一点吗？', '你的手很暖呢 💛',
  ];
  let touchCount = 0;
  spirit.addEventListener('click', (e) => {
    touchCount++;
    // 被戳动画
    spirit.classList.remove('poked');
    void spirit.offsetWidth; // 强制重绘
    spirit.classList.add('poked');
    setTimeout(() => spirit.classList.remove('poked'), 600);
    // 涟漪
    const r = document.createElement('div');
    r.className = 'ripple';
    const rect = spirit.getBoundingClientRect();
    r.style.left = (e.clientX - rect.left - 0) + 'px';
    r.style.top = (e.clientY - rect.top - 0) + 'px';
    spirit.parentElement.appendChild(r);
    setTimeout(() => r.remove(), 1000);
    // 每 3 次摸摸说句话
    if (touchCount % 3 === 0) {
      showBubble(touches[Math.floor(Math.random() * touches.length)], 2800);
      setMood('happy', 2500);
    }
  });
})();

/* =========================================================
   11. 背景音乐 v6 —— 真实氛围音频 CDN（纯 HTML5 Audio）
   ========================================================= */
let currentTrack = null;
let isMusicPlaying = false;

let currentAudioEl = null;  // 当前播放的 HTML5 Audio 元素

const $musicBtn = document.getElementById('musicBtn');
const $musicPanel = document.getElementById('musicPanel');
const $volumeSlider = document.getElementById('volumeSlider');

/* ===== 真实氛围音频（本地音源 + 已做响度归一化）=====
   音源来自 moodist 仓库（Pixabay/CC0）
   已用 ffmpeg loudnorm 把 mean_volume 从 -40 dB 提到 -20 dB 左右（响约 10 倍）
   全部存放在 /sounds/，由本地 http 服务直接提供，不依赖任何 CDN
   解决问题：① raw.githubusercontent.com 国内拉不到 ② 原始 mp3 音量太小听不见 */
const AMBIENT_TRACKS = [
  // ===== 治愈钢琴分类已移除，自己加喜欢的就行 =====

  // ===== 自然氛围 =====
  { id: 'ocean',      name: '🌊 海浪轻拍',   cat: 'nature', url: 'sounds/ocean.mp3' },
  { id: 'forest',     name: '🌲 森林晨风',   cat: 'nature', url: 'sounds/forest.mp3' },
  { id: 'birds',      name: '🐦 鸟鸣清晨',   cat: 'nature', url: 'sounds/birds.mp3' },
  { id: 'crickets',   name: '🦗 夏夜虫鸣',   cat: 'nature', url: 'sounds/crickets.mp3' },
  { id: 'campfire',   name: '🔥 篝火噼啪',   cat: 'nature', url: 'sounds/campfire.mp3' },
  // ===== 雨声（助眠）=====
  { id: 'lightRain',  name: '🌧️ 小雨轻落',   cat: 'rain', url: 'sounds/lightRain.mp3' },
  { id: 'heavyRain',  name: '⛈️ 大雨倾盆',   cat: 'rain', url: 'sounds/heavyRain.mp3' },
  { id: 'rainWindow', name: '🪟 雨打窗棂',   cat: 'rain', url: 'sounds/rainWindow.mp3' },
  // ===== 禅意（冥想/放空）=====
  { id: 'temple',     name: '🛕 寺庙禅音',   cat: 'zen', url: 'sounds/temple.mp3' },
  { id: 'windChimes', name: '🎐 风铃轻响',   cat: 'zen', url: 'sounds/windChimes.mp3' },
  { id: 'singingBowl',name: '🪘 颂钵冥想',  cat: 'zen', url: 'sounds/singingBowl.mp3' },
  { id: 'binaural',   name: '🧘 双耳节拍θ波',cat: 'zen', url: 'sounds/binaural.wav' },
  // ===== 钢琴轻音（治愈/放空）=====
  { id: 'pianoHaohai',  name: '🎹 花海·钢琴版',   cat: 'zen', url: 'sounds/piano-haohai.mp3' },
  { id: 'pianoZuichang',name: '🎹 最长的电影·钢琴', cat: 'zen', url: 'sounds/piano-zuichang.mp3' },
  { id: 'timeToPaint',  name: '🎹 Time To Paint',  cat: 'zen', url: 'sounds/time-to-paint.mp3' },
  // ===== 古琴养生（中医/五行音乐）=====
  { id: 'guqinYangsheng', name: '🎻 养生禅修·古琴', cat: 'yangsheng', url: 'sounds/guqin-yangsheng.mp3' },
  { id: 'guqinWuxing',    name: '🎻 五音疗疾·古琴', cat: 'yangsheng', url: 'sounds/guqin-wuxing.ogg' },
  { id: 'guqinJueyin',    name: '🎻 角音疏肝·古琴', cat: 'yangsheng', url: 'sounds/guqin-jueyin.mp3' },
];

/* 曲目分类（音乐面板分组用）*/
const TRACK_CATS = [
  { id: 'mine',    name: '🎵 我的音乐', tip: '你自己加的音乐，点 ➕ 添加' },
  { id: 'nature',  name: '🌿 自然氛围', tip: '猫咪·海浪·森林·篝火·风铃' },
  { id: 'rain',    name: '🌧️ 雨声助眠', tip: '下雨天/失眠夜' },
  { id: 'zen',       name: '🧘 禅意冥想', tip: '寺庙·风铃·颂钵·钢琴' },
  { id: 'yangsheng', name: '🎻 古琴养生', tip: '中医·五行·疗愈古琴' },
];

/* ===== 用户自定义音乐 =====
   - 链接类：URL 存 localStorage（永久有效）
   - 文件类：文件本体存 IndexedDB（localStorage 装不下大文件），每次打开重新生成 blob URL
     这样刷新页面后照样能播，不再"加载失败"
*/
const CUSTOM_TRACK_KEY = 'yuntuzi_custom_tracks_v2';
function loadCustomTracks() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_TRACK_KEY)) || []; }
  catch (e) { return []; }
}
function saveCustomTracks(list) {
  try { localStorage.setItem(CUSTOM_TRACK_KEY, JSON.stringify(list)); return true; }
  catch (e) { return false; } // 配额超了
}

/* IndexedDB：存音频文件本体 */
const IDB_NAME = 'yuntuzi_db';
const IDB_STORE = 'audio_blobs';
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbPutBlob(key, blob) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(blob, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGetBlob(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function idbDelBlob(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/* 迁移/清理旧版自定义音乐：
   - 旧版用 blob: URL 存进 localStorage，刷新后必失效 → 清掉这些死链
   - 旧版 key 是 yuntuzi_custom_tracks_v1 */
function migrateOldCustomTracks() {
  // 1. 旧版 v1 数据：搬到 v2，但 blob: 开头的删掉（已经失效）
  try {
    const oldRaw = localStorage.getItem('yuntuzi_custom_tracks_v1');
    if (oldRaw) {
      const oldList = JSON.parse(oldRaw);
      if (Array.isArray(oldList)) {
        const v2 = loadCustomTracks();
        oldList.forEach(t => {
          if (t.url && t.url.startsWith('blob:')) return; // 死链，丢掉
          // 链接类的搬过来
          if (!v2.find(x => x.id === t.id)) {
            v2.push({ id: t.id, name: t.name, url: t.url, cat: 'mine', isFile: false });
          }
        });
        saveCustomTracks(v2);
        localStorage.removeItem('yuntuzi_custom_tracks_v1');
        refreshCustomTracks();
      }
    }
  } catch (e) {}
  // 2. 清掉 v2 里残留的死 blob: URL（没有 isFile 标记的旧文件类）
  const list = loadCustomTracks();
  let changed = false;
  const cleaned = list.filter(t => {
    if (!t.isFile && t.url && t.url.startsWith('blob:')) { changed = true; return false; }
    return true;
  });
  if (changed) { saveCustomTracks(cleaned); refreshCustomTracks(); }
}
function refreshCustomTracks() {
  for (let i = AMBIENT_TRACKS.length - 1; i >= 0; i--) {
    if (AMBIENT_TRACKS[i].cat === 'mine') AMBIENT_TRACKS.splice(i, 1);
  }
  loadCustomTracks().forEach(c => AMBIENT_TRACKS.unshift(c));
}
refreshCustomTracks();

/* 启动时把文件类曲目的 blob URL 重新生成（上次会话的已失效） */
async function resolveFileTracks() {
  const fileTracks = AMBIENT_TRACKS.filter(t => t.cat === 'mine' && t.isFile);
  for (const t of fileTracks) {
    try {
      const blob = await idbGetBlob(t.id);
      if (blob) t.url = URL.createObjectURL(blob);
    } catch (e) { /* 取不到就留空，播放时再报错 */ }
  }
}
/* 按需取一次（点播放时若 url 还没准备好） */
async function ensureTrackUrl(track) {
  if (track.url) return track.url;
  if (track.isFile) {
    const blob = await idbGetBlob(track.id);
    if (blob) { track.url = URL.createObjectURL(blob); return track.url; }
  }
  return '';
}

/* ===== 停止所有音乐 ===== */
function stopAllMusic() {
  isMusicPlaying = false;
  // 停止 HTML5 Audio
  if (currentAudioEl) {
    currentAudioEl.pause();
    currentAudioEl.currentTime = 0;
    currentAudioEl = null;
  }
  // 清除 UI 状态
  $musicBtn.classList.remove('playing');
  $musicBtn.classList.remove('active');
  document.querySelectorAll('.track-btn').forEach(el => el.classList.remove('active', 'playing'));
}

/* ===== 播放真实氛围音频（HTML5 Audio）===== */
function switchAmbientTrack(trackId) {
  stopAllMusic();
  const track = AMBIENT_TRACKS.find(t => t.id === trackId);
  if (!track) return;

  currentTrack = trackId;
  isMusicPlaying = true;

  $musicBtn.classList.add('playing');
  $musicBtn.classList.add('active');
  document.querySelectorAll('.track-btn').forEach(el => {
    el.classList.toggle('active', el.dataset.track === trackId);
  });

  // 文件类曲目：url 可能还没准备好（启动时异步生成），现取现用
  const beginPlay = (url) => {
    // 期间用户可能切了别的曲子，这里校验一下
    if (currentTrack !== trackId) return;
    if (!url) {
      showBubble('这个音乐文件找不到了，可能被清掉了，重新加一次吧 🎵', 3500);
      stopAllMusic();
      return;
    }
    const audio = new Audio();
    audio.src = url;
    audio.loop = true;
    // 注意：不能设 crossOrigin='anonymous' —— 不少音频 CDN 不返回 CORS 头，
    // 设了会导致加载静默失败没声音。普通 HTML5 Audio 播放不需要 CORS。
    audio.volume = state.musicVolume / 100;
    currentAudioEl = audio;
    // 调试钩子：方便从外部查看当前 audio 真实状态
    window.__currentAudio = audio;

    // 缓冲提示
    const loadTimer = setTimeout(() => {
      showBubble('⏳ 音频加载中…首次播放可能稍慢', 2500);
    }, 800);
    audio.addEventListener('canplaythrough', () => clearTimeout(loadTimer), { once: true });
    audio.addEventListener('error', () => {
      clearTimeout(loadTimer);
      const e = audio.error;
      let hint = '音频加载失败，换一首试试 🎵';
      if (e) {
        if (e.code === 4) hint = '这个音频格式播不了，换 mp3 或 m4a 试试 🎵';
        else if (e.code === 2) hint = '网络拉不到，链接可能失效或被防盗链挡了 🎵';
        else if (e.code === 3) hint = '文件解码失败，可能损坏了 🎵';
      }
      showBubble(hint, 3500);
      stopAllMusic();
    }, { once: true });

    // 关键：必须在用户手势调用栈里立即 play()，浏览器会排队等数据 ready 后自动开始播。
    // 旧版"等 canplay 回调再 play"会因用户手势过期被自动播放策略拒 → 没声音。
    audio.play().catch(err => {
      if (err && err.name === 'NotAllowedError') {
        showBubble('点一下我就能放啦～（浏览器要求先有操作）🎵', 3500);
      } else {
        clearTimeout(loadTimer);
        showBubble('播放失败，请稍后再试 🎵', 3000);
        console.warn('Audio play error:', err);
        stopAllMusic();
      }
    });

    showBubble('正在播放：' + track.name + ' 🎶', 3000);
  };

  if (track.url) {
    beginPlay(track.url);
  } else {
    // 文件类：从 IndexedDB 现取 blob
    showBubble('⏳ 正在取出你的音乐…', 1800);
    ensureTrackUrl(track).then(beginPlay);
  }
}

/* ===== 音乐面板：动态分组渲染 + 事件委托 ===== */
$musicBtn.addEventListener('click', () => {
  $musicPanel.classList.toggle('hide');
});

/* 渲染分组曲目列表（按 TRACK_CATS 分类）*/
function renderMusicTracks() {
  const $list = document.getElementById('musicTrackList');
  if (!$list) return;
  let html = '';
  TRACK_CATS.forEach(cat => {
    const tracks = AMBIENT_TRACKS.filter(t => t.cat === cat.id);
    html += `<div class="track-group">`;
    html += `<div class="track-group-head"><b>${cat.name}</b><small>${cat.tip}</small></div>`;
    html += `<div class="track-group-body">`;
    if (cat.id === 'mine') {
      // 我的音乐分类：先列已加的曲目（带删除按钮），再放一个"+ 添加"按钮
      if (tracks.length === 0) {
        html += `<p class="mine-empty">还没有加过音乐～点下面按钮加一首</p>`;
      } else {
        tracks.forEach(t => {
          html += `<div class="mine-track-row">
            <button class="track-btn synth" data-track="${t.id}">${t.name}</button>
            <button class="mine-del-btn" data-del="${t.id}" title="删除">✕</button>
          </div>`;
        });
      }
      html += `<button class="track-btn add-mine-btn" id="addMineBtn">➕ 添加我的音乐</button>`;
    } else {
      tracks.forEach(t => {
        html += `<button class="track-btn synth" data-track="${t.id}">${t.name}</button>`;
      });
    }
    html += `</div></div>`;
  });
  $list.innerHTML = html;
}
renderMusicTracks();

// 事件委托：点曲目按钮播放/暂停
document.getElementById('musicTrackList').addEventListener('click', (e) => {
  // 删除按钮
  const delBtn = e.target.closest('.mine-del-btn');
  if (delBtn) {
    const id = delBtn.dataset.del;
    const removed = loadCustomTracks().find(t => t.id === id);
    const list = loadCustomTracks().filter(t => t.id !== id);
    saveCustomTracks(list);
    // 文件类：连带清掉 IndexedDB 里的本体
    if (removed && removed.isFile) idbDelBlob(id).catch(()=>{});
    refreshCustomTracks();
    renderMusicTracks();
    showBubble('已删除 🗑️', 2000);
    return;
  }
  // 添加按钮
  if (e.target.closest('#addMineBtn')) {
    openAddMusicModal();
    return;
  }
  // 普通曲目按钮
  const btn = e.target.closest('.track-btn');
  if (!btn || btn.id === 'addMineBtn') return;
  const track = btn.dataset.track;
  document.querySelectorAll('.track-btn').forEach(b => b.classList.remove('active', 'playing'));
  if (isMusicPlaying && currentTrack === track) {
    stopAllMusic();
    btn.classList.remove('active');
    showBubble('已暂停', 2000);
  } else {
    switchAmbientTrack(track);
    btn.classList.add('active');
  }
});

/* ===== 添加自定义音乐弹窗 ===== */
function openAddMusicModal() {
  const m = document.getElementById('addMusicModal');
  if (!m) return;
  document.getElementById('addMusicName').value = '';
  document.getElementById('addMusicUrl').value = '';
  document.getElementById('addMusicFile').value = '';
  document.getElementById('addMusicMsg').textContent = '';
  m.classList.remove('hide');
}
function closeAddMusicModal() {
  const m = document.getElementById('addMusicModal');
  if (m) m.classList.add('hide');
}
/* 保存链接类曲目（URL 存 localStorage，永久有效） */
function saveCustomTrack(name, url) {
  const list = loadCustomTracks();
  const id = 'mine_' + Date.now();
  list.push({ id, name, url, cat: 'mine', isFile: false });
  if (!saveCustomTracks(list)) {
    showBubble('存不下了（浏览器容量满），删点别的再试', 3000);
    return false;
  }
  refreshCustomTracks();
  renderMusicTracks();
  return true;
}
/* 保存文件类曲目：本体存 IndexedDB，刷新后照样能播 */
async function saveCustomTrackFile(name, file) {
  const list = loadCustomTracks();
  const id = 'mine_' + Date.now();
  // 元数据先入 localStorage（不带 url，省空间）
  list.push({ id, name, cat: 'mine', isFile: true });
  if (!saveCustomTracks(list)) {
    showBubble('存不下了（浏览器容量满），删点别的再试', 3000);
    return false;
  }
  // 文件本体入 IndexedDB
  try {
    await idbPutBlob(id, file);
  } catch (e) {
    // IDB 失败：回滚元数据
    const list2 = loadCustomTracks().filter(t => t.id !== id);
    saveCustomTracks(list2);
    showBubble('文件存进数据库失败了，换个文件或用链接试试 🎵', 3500);
    return false;
  }
  refreshCustomTracks();
  // 立刻生成可用的 blob URL 挂到当前曲目（免得用户马上点还要等）
  const track = AMBIENT_TRACKS.find(t => t.id === id);
  if (track) track.url = URL.createObjectURL(file);
  renderMusicTracks();
  return true;
}
// 保存按钮
document.addEventListener('DOMContentLoaded', () => {
  const $save = document.getElementById('addMusicSave');
  const $file = document.getElementById('addMusicFile');
  if (!$save) return;
  $save.addEventListener('click', () => {
    const name = document.getElementById('addMusicName').value.trim();
    const url = document.getElementById('addMusicUrl').value.trim();
    const msg = document.getElementById('addMusicMsg');
    if (!name) { msg.textContent = '给它起个名字吧～'; return; }
    if (!url && (!$file.files || !$file.files[0])) {
      msg.textContent = '要么填链接，要么选个文件～';
      return;
    }
    if (url) {
      // 链接方式：永久保存
      if (saveCustomTrack(name, url)) {
        closeAddMusicModal();
        // 团子主动放给你听
        const newTrack = AMBIENT_TRACKS.find(t => t.name === name && t.cat === 'mine');
        if (newTrack) {
          setTimeout(() => {
            switchAmbientTrack(newTrack.id);
            showBubble(`☁️ 你刚加的「${name}」，放给你听听～`, 3500);
          }, 600);
        } else {
          showBubble(`✅ ${name} 已加入我的音乐`, 2500);
        }
      }
    } else {
      // 文件方式：存进 IndexedDB，刷新后照样能播
      const file = $file.files[0];
      msg.textContent = '正在保存…';
      saveCustomTrackFile(name, file).then(ok => {
        if (ok) {
          closeAddMusicModal();
          // 团子主动放给你听
          const newTrack = AMBIENT_TRACKS.find(t => t.name === name && t.cat === 'mine');
          if (newTrack) {
            setTimeout(() => {
              switchAmbientTrack(newTrack.id);
              showBubble(`☁️ 你刚加的「${name}」，放给你听听～`, 3500);
            }, 600);
          } else {
            showBubble(`✅ ${name} 已加入，刷新也能听～`, 3000);
          }
        }
      });
    }
  });
});

// 停止按钮
const $musicStopBtn = document.getElementById('musicStopBtn');
if ($musicStopBtn) {
  $musicStopBtn.addEventListener('click', () => {
    stopAllMusic();
    showBubble('好，安静一会儿 ☁️', 2000);
  });
}

// 音量控制
$volumeSlider.addEventListener('input', () => {
  const vol = parseInt($volumeSlider.value);
  state.musicVolume = vol;
  if (currentAudioEl) currentAudioEl.volume = vol / 100;
  saveState();
});

function restoreMusicUI() {
  $volumeSlider.value = state.musicVolume || 40;
}

/* =========================================================
   12. 彩蛋：戳戳云团子
   ========================================================= */
let pokeCount = 0, pokeResetTimer = null;
$spirit.addEventListener('click', () => {
  $spirit.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(.92) translateY(4px)' }, { transform: 'scale(1)' }],
    { duration: 350, easing: 'cubic-bezier(.34,1.56,.64,1)' }
  );
  // 连续摸头计数
  pokeCount++;
  if (pokeResetTimer) clearTimeout(pokeResetTimer);
  pokeResetTimer = setTimeout(() => { pokeCount = 0; }, 3000);

  const pokes = [
    '嘿嘿，好痒呀～',
    '怎么啦？想摸摸我吗 ☁️',
    '我在呢～',
    '抱抱！🫂',
    '今天也辛苦啦',
    '嗯？怎么啦怎么啦？',
    '（蹭蹭你）',
  ];
  // 连续摸 3 次以上，进入"被摸舒服"状态
  if (pokeCount >= 3) {
    setMood('comfort', 4000);
    burstHearts(6);
    showBubble(['（眯眼）好舒服……再摸摸 💛','（蹭你手心）你也辛苦了 ☁️','嗯……有你陪着真好 🫂'][Math.floor(Math.random()*3)], 3200);
    // 治愈粒子
    burstStars(4);
    if (pokeCount === 5) {
      gainReward({ stars: 1, exp: 1, mood: 'cosy' });
      showBubble('被你摸得暖呼呼的，送你一颗星星 ⭐', 2800);
    }
  } else {
    showBubble(pokes[Math.floor(Math.random()*pokes.length)], 2500);
  }
});

/* 飘出爱心特效（摸头时触发） */
function burstHearts(count = 4) {
  const hearts = ['💗','💕','🤍','💛','☁️'];
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const h = document.createElement('div');
      h.className = 'heart-fx';
      h.textContent = hearts[Math.floor(Math.random()*hearts.length)];
      h.style.left = (45 + Math.random()*10) + '%';
      h.style.top = (40 + Math.random()*15) + '%';
      h.style.setProperty('--dx', (Math.random()*60-30) + 'px');
      $fxLayer.appendChild(h);
      setTimeout(() => h.remove(), 2200);
    }, i * 100);
  }
}

/* 自动眨眼 */
setInterval(() => {
  if (isNightMode) return;
  if (Math.random() < 0.4) {
    const eyes = $spirit.querySelectorAll('.eye');
    eyes.forEach(e => {
      if (!e.classList.contains('closed')) {
        e.classList.add('closed');
        setTimeout(() => e.classList.remove('closed'), 180);
      }
    });
  }
}, 3800);

/* 点击空白关音乐面板 —— 用 pointerdown 记录起点，移动端/PC 都触发 */
let pressOutsidePanel = false;
document.addEventListener('pointerdown', (e) => {
  // 面板隐藏时不处理
  if ($musicPanel.classList.contains('hide')) return;
  // 记录"按下时是否在面板和按钮外部"
  pressOutsidePanel = !$musicPanel.contains(e.target) && !$musicBtn.contains(e.target);
});
document.addEventListener('pointerup', (e) => {
  // 只有"按下和抬起都在面板外部"才关闭，避免误关面板内交互（如点上传按钮）
  if (pressOutsidePanel &&
      !$musicPanel.contains(e.target) && !$musicBtn.contains(e.target)) {
    $musicPanel.classList.add('hide');
  }
  pressOutsidePanel = false;
});

/* =========================================================
   12.5 云团子主动陪伴
   ========================================================= */
/* 根据时间/上次互动状态，主动给一句当下的减压建议 */
function scheduleProactiveCompanionship() {
  const hour = new Date().getHours();
  const isNewcomer = (state.totalTalks === 0 && state.garden.flowers.length === 0);
  let tip;
  if (isNewcomer) {
    // 新手用专属温和开场，避免和送星星引导冲突
    tip = '别紧张，慢慢来～想说话随时点下面的「说说话」，不想说也没关系，我就这么陪着你 ☁️';
  } else if (hour < 6) {
    tip = '这么晚了还没睡呀……要不要让云团子陪你待一会儿？🌙';
  } else if (hour < 11) {
    tip = '早上好～今天如果觉得有压力，记得随时来找我说话哦 ☁️';
  } else if (hour < 14) {
    tip = '中午啦，有没有好好吃饭？吃完了可以来写一件小确幸 ✨';
  } else if (hour < 18) {
    tip = '下午容易犯困，累的话就来摸摸我，或者让我陪你待一会儿～';
  } else if (hour < 23) {
    tip = '今天辛苦啦～有什么压在心里的，可以告诉我，我都听着 🫂';
  } else {
    tip = '夜深了，睡前想放松一下吗？我陪你慢慢静下来 🌙';
  }

  // 新手延迟到送星星(0.6s)+音乐提示(5.8s)两条引导结束后，约 12s 再主动说
  const delay = isNewcomer ? 12000 : 6000;
  // 弹窗开着时不丢弃，而是等用户关掉弹窗后再说（之前是直接跳过，导致"没主动说话"）
  const tryShowProactive = () => {
    if (!document.querySelector('.modal:not(.hide)')) {
      showBubble(tip, 5000);
      setMood('comfort', 3500);
    } else {
      setTimeout(tryShowProactive, 2500);
    }
  };
  setTimeout(tryShowProactive, delay);

  // 每隔一段时间，如果用户长时间没动作，云团子再轻声关心一次
  // —— 关怀话术更多样、更像真人，偶尔还会主动放点轻声陪着
  let idleTimer = null;
  let idleCount = 0;
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!document.querySelector('.modal:not(.hide)')) {
        idleCount++;
        const h = new Date().getHours();
        const idleTips = [
          '还在吗？我一直在哦 ☁️',
          '刚才在想什么呢，要不要跟我说说',
          '…你好像走神了，没事，我也经常发呆',
          '要是累了就歇会儿，我替你守着这一会儿安静 💛',
          '我在这儿坐了好一会儿啦，你忙你的，没事的',
          '要不要我放点声音？安静太久也有点闷',
        ];
        const tip = idleTips[Math.floor(Math.random()*idleTips.length)];
        showBubble(tip, 4500);
        setMood('calm', 3500);
        // 第 3 次以上 idle 且没在放音乐 → 主动放一首轻的，像"它自己觉得太静了"
        if (idleCount >= 3 && !isMusicPlaying && Math.random() < 0.5) {
          setTimeout(() => {
            if (!isMusicPlaying && !document.querySelector('.modal:not(.hide)')) {
              // 优先放你加的音乐（团子记得你喜欢的），没有再放氛围曲
              const mineTracks = AMBIENT_TRACKS.filter(t => t.cat === 'mine');
              let pick, isMine = false;
              if (mineTracks.length > 0) {
                pick = mineTracks[Math.floor(Math.random()*mineTracks.length)].id;
                isMine = true;
              } else {
                const quiet = h >= 22 || h < 6 ? ['rainWindow','lightRain','crickets'] : ['windChimes','crickets','ocean'];
                pick = quiet[Math.floor(Math.random()*quiet.length)];
              }
              switchAmbientTrack(pick);
              const nm = (AMBIENT_TRACKS.find(x=>x.id===pick)||{}).name||'';
              showBubble(isMine ? `放你喜欢的「${nm}」陪你～` : '放点轻的陪你～' + nm, 3500);
            }
          }, 2500);
        }
      }
      resetIdle();
    }, 120000); // 2 分钟没动作才说话，别太勤
  };
  ['click','touchstart','keydown'].forEach(ev => document.addEventListener(ev, resetIdle));
  resetIdle();
}

/* =========================================================
   13. 启动
   ========================================================= */
function boot() {
  updateHUD();
  applyEquipped();
  initGreeting();
  restoreMusicUI();
  initStarryScene();
  // 清理历史上被错误抓成名字的记忆（如"谁""什么"），让云团子真正记得你
  cleanupBadMemory();
  // 迁移旧版自定义音乐：blob URL 失效的清掉；新版文件曲目从 IndexedDB 取出
  migrateOldCustomTracks();
  resolveFileTracks();

  // 自动播放花海——一进来就有温暖的钢琴
  // 浏览器自动播放策略：首次必须用户交互后才能播，监听第一次点击/触摸
  const AUTO_PLAY_TRACKS = ['pianoHaohai', 'pianoZuichang', 'timeToPaint'];
  const autoPick = AUTO_PLAY_TRACKS[Math.floor(Math.random() * AUTO_PLAY_TRACKS.length)];
  let autoPlayed = false;
  function tryAutoPlay() {
    if (autoPlayed) return;
    autoPlayed = true;
    try { switchAmbientTrack(autoPick); } catch (e) {}
    document.removeEventListener('click', tryAutoPlay);
    document.removeEventListener('touchstart', tryAutoPlay);
  }
  // 1.5秒后先试一次（部分浏览器允许），不行就等用户第一次点击
  setTimeout(() => {
    try { switchAmbientTrack(autoPick); } catch (e) {}
    // 如果1秒后没在播，注册监听等用户交互
    setTimeout(() => {
      if (!isMusicPlaying) {
        document.addEventListener('click', tryAutoPlay, { once: true });
        document.addEventListener('touchstart', tryAutoPlay, { once: true });
      }
    }, 1000);
  }, 1500);

  // 云团子主动陪伴：根据时间/状态给出当下适合的减压建议
  scheduleProactiveCompanionship();

  const isNewcomer = (state.totalTalks === 0 && state.garden.flowers.length === 0 && state.stars === 0);
  if (isNewcomer) {
    // 新手：依次串行引导，避免 bubble 互相覆盖
    setTimeout(() => {
      showBubble('初次见面！送你 5 颗小星星 ✨ 装扮多了好多，快挑挑喜欢的～', 5000);
      gainReward({ stars: 5, mood: 'warm' });
      setMood('happy', 5000);
    }, 600);
    // 5.8s 后再提音乐（等上一条结束）
    setTimeout(() => {
      showBubble('点右上角 🎵 里有风铃、颂钵、雨声、海浪，点一下就能听～', 5000);
    }, 5800);
    // scheduleProactiveCompanionship 的新手开场已延迟到 7s，
    // 但为避免和音乐提示(5.8s+5s=10.8s)冲突，覆盖到 12s
    // —— 主动陪伴函数内部已处理，这里无需再加
  } else {
    // 老朋友回来啦：每日签到送一朵花 + 暖心欢迎（增强回归动力）
    checkDailyCheckin();
    if (!state.musicTrack) {
      setTimeout(() => {
        showBubble('点右上角 🎵 里有风铃、颂钵、雨声、海浪，点一下就能听～', 4200);
      }, 5200); // 签到欢迎语后再提示音乐，避免覆盖
    }
  }

  // 渲染心情日历（若弹窗已存在）
  if (typeof renderMoodCalendar === 'function') renderMoodCalendar();
  // 家人打开时转达留言
  if (typeof showFamilyMessageIfAny === 'function') showFamilyMessageIfAny();
  // 家人打开时播放声音留言
  if (typeof playFamilyVoiceIfAny === 'function') playFamilyVoiceIfAny();
  // 云团子记得你上次说的事，开场主动提起
  if (typeof recallMemoryOnBoot === 'function') recallMemoryOnBoot();
}
/* =========================================================
   14. 远程留言（你写给家人的话）+ GitHub Gist 云端同步
   ----------------------------------------------------------
   你写留言 → 上传到 Gist 云端 → 家人打开网址自动拉取显示。
   - 读取（家人看）：公开 Gist，无需任何凭证
   - 写入（你写）：需要 GitHub Token，首次手输一次后存浏览器本地
   Token 只存在你这台设备的浏览器里，不会写进代码、不上传服务器。
   ========================================================= */
const MSG_KEY = 'yuntuzi_family_msg';
const MSG_TOKEN_KEY = 'yztz_gist_token';   // 用户首次手输的 GitHub Token
const GIST_ID = '191e2dd774003ed37379af9bfb1f0626';
const GIST_RAW = 'https://gist.githubusercontent.com/Kris-up00/' + GIST_ID + '/raw/msg.json';

const $msgInput = document.getElementById('msgInput');
const $msgSave = document.getElementById('msgSave');
const $msgSaved = document.getElementById('msgSaved');
const $msgSavedText = document.getElementById('msgSavedText');
const $msgClear = document.getElementById('msgClear');
const $msgTip = document.getElementById('msgTip');

function getGistToken() { return localStorage.getItem(MSG_TOKEN_KEY) || ''; }

function renderMsg() {
  const msg = localStorage.getItem(MSG_KEY);
  if (msg) {
    $msgSavedText.textContent = msg;
    $msgSaved.classList.remove('hide');
    $msgInput.value = '';
    $msgInput.placeholder = '已保存（重新输入会替换）';
  } else {
    $msgSaved.classList.add('hide');
    $msgInput.placeholder = '比如：妈妈辛苦啦，记得按时吃饭，我爱你';
  }
}

/* ---- 读云端：公开 Gist，无需 Token ---- */
async function cloudLoadMsg() {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 8000);
    // 加 ?t=时间戳 防止 CDN 缓存
    const res = await fetch(GIST_RAW + '?t=' + Date.now(), { signal: ctrl.signal });
    clearTimeout(tid);
    if (!res.ok) return null;
    const data = await res.json();
    return data.msg || null;
  } catch (e) {
    console.warn('[云团子] 拉取云端留言失败', e);
    return null;
  }
}

/* ---- 写云端：需要 Token ---- */
async function cloudSaveMsg(text) {
  const token = getGistToken();
  if (!token) return { ok: false, needToken: true };
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch('https://api.github.com/gists/' + GIST_ID, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        description: 'yuntuanzi-family-msg',
        files: { 'msg.json': { content: JSON.stringify({ msg: text, ts: Date.now() }) } },
      }),
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    if (res.status === 401 || res.status === 403) return { ok: false, badToken: true };
    return { ok: res.ok };
  } catch (e) {
    return { ok: false, error: e };
  }
}

/* ---- 删云端：把内容清空 ---- */
async function cloudClearMsg() {
  const token = getGistToken();
  if (!token) return { ok: false, needToken: true };
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch('https://api.github.com/gists/' + GIST_ID, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        files: { 'msg.json': { content: JSON.stringify({ msg: '', ts: Date.now() }) } },
      }),
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    return { ok: res.ok };
  } catch (e) { return { ok: false, error: e }; }
}

/* 打开 app 时：先读本地，再异步从云端拉最新 */
async function bootSyncMsg() {
  renderMsg();
  const cloud = await cloudLoadMsg();
  if (cloud) {
    localStorage.setItem(MSG_KEY, cloud);
    renderMsg();
    if (!localStorage.getItem('yztz_msg_synced_flag')) {
      localStorage.setItem('yztz_msg_synced_flag', '1');
      $msgTip.textContent = '☁️ 有留给你的话，云团子替 ta 带来了～';
      setTimeout(() => { $msgTip.textContent = '家人打开云团子时，云团子会替你把这段话带给他～'; }, 4000);
    }
  }
}

/* 弹窗：让用户首次输入 Token
   注意：用应用内模态框而不是 window.prompt()。
   预览/iframe 沙箱会静默拦截原生 prompt，导致点了保存却看不到弹窗。 */
const $tokenModal = document.getElementById('tokenModal');
const $tokenInput = document.getElementById('tokenInput');
const $tokenSubmit = document.getElementById('tokenSubmit');
const $tokenError = document.getElementById('tokenError');
let _tokenResolve = null;

function openTokenModal() {
  $tokenInput.value = '';
  $tokenError.classList.add('hide');
  $tokenError.textContent = '';
  $tokenModal.classList.remove('hide');
  setTimeout(() => { try { $tokenInput.focus(); } catch (e) {} }, 60);
  return new Promise(resolve => { _tokenResolve = resolve; });
}
function closeTokenModal(result) {
  $tokenModal.classList.add('hide');
  if (_tokenResolve) { const r = _tokenResolve; _tokenResolve = null; r(result); }
}
$tokenSubmit.addEventListener('click', () => {
  const t = $tokenInput.value.trim();
  if (!t) {
    $tokenError.textContent = 'Token 不能为空哦～';
    $tokenError.classList.remove('hide');
    return;
  }
  localStorage.setItem(MSG_TOKEN_KEY, t);
  closeTokenModal(t);
});
$tokenInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $tokenSubmit.click(); }
});
document.querySelectorAll('[data-close-token]').forEach((b) =>
  b.addEventListener('click', () => closeTokenModal(null))
);

async function promptForToken() {
  return await openTokenModal();
}

$msgSave.addEventListener('click', async () => {
  const text = $msgInput.value.trim();
  if (!text) { $msgTip.textContent = '写点什么再保存吧～'; return; }
  localStorage.setItem(MSG_KEY, text);
  renderMsg();
  if (!getGistToken()) {
    $msgTip.textContent = '首次保存到云端，需要填一次 GitHub Token…';
    const token = await promptForToken();
    if (!token) {
      $msgTip.textContent = '已保存在本机。要同步给家人，下次保存时填一下 Token 哦';
      setTimeout(() => { $msgTip.textContent = '家人打开云团子时，云团子会替你把这段话带给他～'; }, 3500);
      return;
    }
  }
  $msgTip.textContent = '☁️ 正在同步到云端…';
  const r = await cloudSaveMsg(text);
  if (r.ok) {
    $msgTip.textContent = '✅ 已保存！家人打开网址会自动看到这段话';
  } else if (r.badToken) {
    localStorage.removeItem(MSG_TOKEN_KEY);
    $msgTip.textContent = '⚠️ Token 失效，已清除。下次保存时重新填一下';
  } else {
    $msgTip.textContent = '⚠️ 本机已存，云端同步失败（检查网络）';
  }
  setTimeout(() => { $msgTip.textContent = '家人打开云团子时，云团子会替你把这段话带给他～'; }, 3500);
});

$msgClear.addEventListener('click', async () => {
  localStorage.removeItem(MSG_KEY);
  renderMsg();
  if (getGistToken()) {
    $msgTip.textContent = '☁️ 正在从云端清除…';
    const r = await cloudClearMsg();
    $msgTip.textContent = r.ok ? '已从云端清除留言' : '本机已清，云端清除失败';
  } else {
    $msgTip.textContent = '已清除留言';
  }
  setTimeout(() => { $msgTip.textContent = '家人打开云团子时，云团子会替你把这段话带给他～'; }, 2500);
});

/* 家人打开 app 时：若云端有你的留言，云团子先说话再缓缓展开留言卡片 */
function showFamilyMessageIfAny() {
  const msg = localStorage.getItem(MSG_KEY);
  if (!msg) return;
  // 每条留言只展示一次（改留言后才会再弹）
  const shownKey = 'yztz_msg_shown_' + (msg || '').slice(0, 20);
  if (localStorage.getItem(shownKey)) return;
  localStorage.setItem(shownKey, '1');

  setTimeout(() => {
    // 第一步：云团子先说一句话，制造期待
    if (typeof showBubble === 'function') {
      showBubble('有人托我带了句话给你……', 3000);
    }
    if (typeof setMood === 'function') setMood('comfort', 3000);

    // 第二步：4秒后信封缓缓展开
    setTimeout(() => {
      const overlay = document.createElement('div');
      overlay.className = 'family-msg-overlay';
      overlay.innerHTML = `
        <div class="family-msg-envelope">
          <div class="family-msg-flap"></div>
          <div class="family-msg-card">
            <div class="family-msg-icon">💌</div>
            <div class="family-msg-title">有人托云团子带的话</div>
            <div class="family-msg-text">${escapeHtml(msg)}</div>
            <button class="family-msg-close">知道了，谢谢 ☁️</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      // 触发动画
      requestAnimationFrame(() => {
        requestAnimationFrame(() => overlay.classList.add('show'));
      });
      overlay.querySelector('.family-msg-close').addEventListener('click', () => {
        overlay.classList.remove('show');
        setTimeout(() => overlay.remove(), 800);
      });
      if (typeof setMood === 'function') setMood('happy', 5000);
    }, 3000);
  }, 2000);
}

bootSyncMsg();
/* =========================================================
   16. 睡前温柔语音哄睡（Web Speech API）
   ========================================================= */
const SLEEP_SCRIPT = [
  '闭上眼睛，把今天所有的重量，慢慢放下来。',
  '吸气……把温柔吸进来。',
  '呼气……把疲惫呼出去。',
  '你已经做得很好了，现在不需要再撑着。',
  '今晚就算睡不着也没关系，身体在休息就好。',
  '云团子就守在你身边，哪儿也不去。',
  '慢慢来……一切都会好的。晚安。',
];
const $sleepVoiceBtn = document.getElementById('sleepVoiceBtn');
const $sleepVoiceStop = document.getElementById('sleepVoiceStop');
let sleepUtterIdx = 0;
let sleepTimer = null;
let sleepSpeaking = false;

// 睡前哄睡——纯文字版，不要机械声
function speakNextSleepLine() {
  if (!sleepSpeaking) return;
  if (sleepUtterIdx >= SLEEP_SCRIPT.length) sleepUtterIdx = 0;
  const line = SLEEP_SCRIPT[sleepUtterIdx];
  showBubble(line, 4000);
  setMood('sleepy', 3800);
  sleepUtterIdx++;
  if (sleepUtterIdx >= SLEEP_SCRIPT.length) sleepUtterIdx = 0;
  sleepTimer = setTimeout(speakNextSleepLine, 4000);
}
if ($sleepVoiceBtn) {
  $sleepVoiceBtn.addEventListener('click', () => {
    sleepSpeaking = true;
    sleepUtterIdx = 0;
    $sleepVoiceBtn.classList.add('hide');
    if ($sleepVoiceStop) $sleepVoiceStop.classList.remove('hide');
    speakNextSleepLine();
    showBubble('云团子开始轻声哄你入睡了…🌙', 3000);
  });
}
if ($sleepVoiceStop) {
  $sleepVoiceStop.addEventListener('click', () => {
    sleepSpeaking = false;
    if (sleepTimer) clearTimeout(sleepTimer);
    $sleepVoiceStop.classList.add('hide');
    if ($sleepVoiceBtn) $sleepVoiceBtn.classList.remove('hide');
  });
}

/* =========================================================
   17. 心情日历
   ========================================================= */
const MOOD_KEY = 'yuntuzi_mood_log';
const MOOD_EMOJI = { great: '😄', ok: '🙂', tired: '😮‍💨', sad: '😔', bad: '😣' };
const MOOD_LABEL = { great: '很好', ok: '还行', tired: '疲惫', sad: '难过', bad: '糟糕' };
const $moodCalendar = document.getElementById('moodCalendar');
const $moodSummary = document.getElementById('moodSummary');
let moodLog = {};
try { moodLog = JSON.parse(localStorage.getItem(MOOD_KEY) || '{}'); } catch (e) { moodLog = {}; }

function todayKey(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function renderMoodCalendar() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m+1, 0).getDate();
  const todayK = todayKey();
  let html = '';
  ['日','一','二','三','四','五','六'].forEach(w => {
    html += '<div class="mood-cell" style="background:transparent;font-size:11px;color:var(--c-text-soft)">' + w + '</div>';
  });
  for (let i = 0; i < firstDay; i++) html += '<div class="mood-cell" style="background:transparent"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const k = y + '-' + String(m+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    const mood = moodLog[k];
    const isToday = (k === todayK);
    html += '<div class="mood-cell' + (isToday ? ' today' : '') + '" title="' + k + '">' +
            (mood ? MOOD_EMOJI[mood] : d) + '</div>';
  }
  $moodCalendar.innerHTML = html;
  // 本月统计
  const monthMoods = Object.entries(moodLog).filter(([k]) => k.startsWith(y + '-' + String(m+1).padStart(2,'0')));
  if (monthMoods.length > 0) {
    const count = {};
    monthMoods.forEach(([k, v]) => count[v] = (count[v]||0)+1);
    const summary = Object.entries(count).map(([m, c]) => MOOD_EMOJI[m] + ' ' + MOOD_LABEL[m] + '×' + c).join('　');
    $moodSummary.textContent = '本月记录 ' + monthMoods.length + ' 天：' + summary;
  } else {
    $moodSummary.textContent = '点上方表情，记录今天的心情～';
  }
}
document.querySelectorAll('.mood-pick').forEach(btn => {
  btn.addEventListener('click', () => {
    const m = btn.dataset.mood;
    moodLog[todayKey()] = m;
    localStorage.setItem(MOOD_KEY, JSON.stringify(moodLog));
    document.querySelectorAll('.mood-pick').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    renderMoodCalendar();
    const reply = {
      great: '看到你开心，云团子也跟着笑了 ☺️',
      ok: '平稳的一天，也很好 💛',
      tired: '累了就早点休息，今晚交给云团子陪你',
      sad: '抱抱你，难过也没关系，云团子在 🫂',
      bad: '今天辛苦了，慢慢来，我陪你一起过',
    }[m];
    showBubble(reply, 3000);
    setMood(m === 'great' || m === 'ok' ? 'happy' : 'comfort', 3000);
    gainReward({ exp: 2, stars: 1, mood: m === 'great' ? 'happy' : (m === 'sad' || m === 'bad' ? 'sad' : 'default') });
  });
});
// 默认选中今天已记录的
const todayMood = moodLog[todayKey()];
if (todayMood) {
  const b = document.querySelector('.mood-pick[data-mood="' + todayMood + '"]');
  if (b) b.classList.add('selected');
}

/* =========================================================
   17.5 云团子记得 —— 把你说过的悄悄记下来，主动想起你
   ========================================================= */
const $memoryList = document.getElementById('memoryList');

function fmtTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff/60000) + ' 分钟前';
  if (d.toDateString() === now.toDateString()) return '今天 ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  return (d.getMonth()+1) + '月' + d.getDate() + '日';
}
function renderMemoryList() {
  const permFacts = loadFacts();
  const mem = loadMemory();
  if (mem.length === 0 && Object.keys(permFacts).length === 0) {
    $memoryList.innerHTML = '<div class="memory-empty">还没有什么记忆呢……<br>去「说说话」里多和我说说，我就会记住你的事啦 ☁️</div>';
    return;
  }
  // 永久事实置顶展示（名字/家人/在意的人，这些云团子永远记得）
  const permParts = [];
  if (permFacts['名字']) permParts.push('<span class="mem-tag perm">名字：' + escapeHtml(permFacts['名字']) + '</span>');
  if (permFacts['家人'] && permFacts['家人'].length) permParts.push('<span class="mem-tag perm">家人：' + escapeHtml(permFacts['家人'].join('、')) + '</span>');
  if (permFacts['在意的人'] && permFacts['在意的人'].length) permParts.push('<span class="mem-tag perm">在意的人：' + escapeHtml(permFacts['在意的人'].join('、')) + '</span>');
  const permBox = permParts.length > 0
    ? '<div class="mem-item perm-box"><div class="mem-time">一直记得</div><div class="mem-user">这些事云团子会一直记得 💛</div><div class="mem-tags">' + permParts.join('') + '</div></div>'
    : '';
  // 倒序显示（最新的在上）
  const items = mem.slice().reverse().slice(0, 12);
  const itemsHTML = items.map((x, i) => {
    const tags = x.tag && x.tag.length > 0
      ? '<div class="mem-tags">' + x.tag.map(t => '<span class="mem-tag">' + escapeHtml(t.k) + '：' + escapeHtml(t.v) + '</span>').join('') + '</div>'
      : '';
    return '<div class="mem-item">' +
      '<div class="mem-time">' + fmtTime(x.t) + '</div>' +
      '<div class="mem-user">你说：' + escapeHtml(x.user) + '</div>' +
      '<div class="mem-reply">云团子：' + escapeHtml(x.reply) + '</div>' +
      tags +
    '</div>';
  }).join('');
  $memoryList.innerHTML = permBox + itemsHTML +
    '<button id="memClear" class="ghost-btn mem-clear-btn">清空所有记忆</button>';
  const $mc = document.getElementById('memClear');
  if ($mc) $mc.addEventListener('click', () => {
    if (confirm('确定要让云团子忘掉所有记忆吗？这个操作不能撤销哦')) {
      saveMemory([]);
      saveFacts({});
      renderMemoryList();
      showBubble('我已经把那些事轻轻放下了……但你要是再来，我还会好好记着 💛', 3500);
    }
  });
}

/* =========================================================
   记忆导出/导入——换手机不丢
   --------------------------------------------------------
   导出：把所有云团子相关的 localStorage 数据打包成 JSON 下载
   导入：上传 JSON 文件，恢复全部数据
   ========================================================= */
function exportAllData() {
  const keys = [
    'yuntuzi_save_v3', 'yuntuzi_memory', 'yuntuzi_facts',
    'yuntuzi_chat_history', 'yztz_memory_greeting_cache',
    'yuntuzi_family_msg', 'yztz_gist_token', 'yztz_msg_synced_flag',
    'zhipu_key', 'yuntuzi_mood_log',
    'yuntuzi_custom_tracks_v2', 'yuntuzi_family_voice',
    'yztz_care_settings',
  ];
  const data = {};
  for (const k of keys) {
    try {
      const v = localStorage.getItem(k);
      if (v !== null) data[k] = v;
    } catch (e) {}
  }
  data.__exportTime = new Date().toISOString();
  data.__version = '1.0';
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const d = new Date();
  a.download = `云团子记忆_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showBubble('记忆已经导出啦，换个手机导入就能接着聊 ☁️', 3500);
}

function importAllData(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.__version) {
        alert('这个文件看起来不是云团子的记忆文件哦');
        return;
      }
      if (!confirm('导入会覆盖当前的记忆，确定吗？')) return;
      for (const k in data) {
        if (k.startsWith('__')) continue;
        try { localStorage.setItem(k, data[k]); } catch (err) {}
      }
      showBubble('记忆恢复啦～云团子又想起来了 💛', 3500);
      // 刷新状态
      state = loadState();
      updateHUD();
      applyEquipped();
      renderMemoryList();
      setTimeout(() => { if (typeof recallMemoryOnBoot === 'function') recallMemoryOnBoot(); }, 1000);
    } catch (err) {
      alert('文件读取出错了，可能不是正确的记忆文件');
    }
  };
  reader.readAsText(file);
}

// 绑定导出/导入按钮
document.addEventListener('DOMContentLoaded', () => {
  const $export = document.getElementById('memExportBtn');
  const $import = document.getElementById('memImportBtn');
  const $importFile = document.getElementById('memImportFile');
  if ($export) $export.addEventListener('click', exportAllData);
  if ($import) $import.addEventListener('click', () => { if ($importFile) $importFile.click(); });
  if ($importFile) $importFile.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) importAllData(e.target.files[0]);
  });
});
/* 开场问候：基于记忆让云团子说一句具体的话，而不是套话"我一直在想你"
   三级降级，保证永远有话可说、不卡顿、不烧太多 API：
   1) 有 Key 且近 1 小时没生成过 → 调 LLM 基于记忆生成一句具体问候，结果缓存到 localStorage
   2) 没 Key / 失败 → 用规则模板从最近记忆里抽一个关键词，生成"上次你说 X，今天怎么样"
   3) 连关键词都抽不到 → 用旧的温和开场，但去掉"我一直在想你"这种空话
   关键：LLM 调用是独立的，不污染 llmHistory（开场不是用户在说话） */
const MEMORY_GREETING_KEY = 'yztz_memory_greeting_cache';

function loadCachedGreeting() {
  try {
    const raw = localStorage.getItem(MEMORY_GREETING_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    // 1 小时内有效
    if (Date.now() - obj.ts > 3600 * 1000) return null;
    return obj.text;
  } catch (e) { return null; }
}
function saveCachedGreeting(text) {
  try { localStorage.setItem(MEMORY_GREETING_KEY, JSON.stringify({ text, ts: Date.now() })); } catch (e) {}
}

/* 从记忆里抽一个"具体话题"，用于规则模板降级 */
function pickMemoryTopic() {
  const mem = loadMemory();
  if (!mem.length) return null;
  // 从最近 8 条里找一个有用户话的
  const recent = mem.slice(-8).reverse();
  for (const m of recent) {
    if (!m.user || m.user.length < 4) continue;
    // 跳过纯情绪宣泄（太短或全是表情），找有具体内容的
    const t = m.user.trim();
    // 抽前 16 字做话题片段，去掉首尾标点
    let snippet = t.replace(/^[，。！？\s]+|[，。！？\s]+$/g, '').slice(0, 16);
    if (snippet.length >= 4) return snippet;
  }
  return null;
}

/* 规则降级：用模板包一句，比"我一直在想你"具体 */
function ruleBasedGreeting(name, topic) {
  if (name && topic) return '你回来啦，' + name + '……上次你说「' + topic + '」，今天怎么样了？';
  if (topic) return '你回来啦……上次你说「' + topic + '」，今天还好吗？';
  if (name) return '你回来啦，' + name + ' ☁️';
  return '你回来啦 ☁️';
}

/* LLM 生成开场：读最近 3 条记忆 + 最近对话历史，生成一句具体问候 */
async function generateMemoryGreeting() {
  const key = getLLMKey();
  const mem = loadMemory();
  const chatHistory = loadChatHistory();
  const permFacts = loadFacts();
  if (key.length <= 10 || (mem.length === 0 && chatHistory.length === 0)) return null;

  // 优先用对话历史（更贴近最近聊的），其次用记忆
  let recentUser = '';
  const chatMsgs = chatHistory.filter(m => m.role === 'user' && m.content).slice(-3);
  if (chatMsgs.length > 0) {
    recentUser = chatMsgs.map((m, i) => (i + 1) + '. ' + m.content.slice(0, 60)).join('\n');
  } else {
    recentUser = mem.slice(-3).map((m, i) => (i + 1) + '. ' + (m.user || '').slice(0, 60)).join('\n');
  }
  let factStr = '';
  if (permFacts['名字']) factStr += '对方称呼：' + permFacts['名字'] + '\n';
  if (permFacts['家人'] && permFacts['家人'].length) factStr += '家人：' + permFacts['家人'].join('、') + '\n';

  const sys = `你是"云团子"，对方生活里一团在乎 ta 的小云。现在对方刚重新打开 app，你要说一句开场问候。

要求：
- 基于对方上次说过的话，提一件具体的事，让人感觉"你真的记得"
- 只能说 1-2 句，总共不超过 40 字，温柔自然
- 不要套话"我一直在想你""欢迎回来"这种空话
- 不要追问太多，只问一个最自然的问题
- 称呼对方用对方的名字（如果有），没有就不带称呼
- 结尾可以加一个 ☁️ 或 💛，最多一个`;
  const user = `对方叫什么：${permFacts['名字'] || '（还不知道）'}\n对方上次说过的话：\n${recentUser}\n\n请生成开场问候：`;

  try {
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(ZHIPU_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model: ZHIPU_MODEL,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user }
        ],
        temperature: 0.9,
        max_tokens: 80,
        stream: false,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const data = await res.json();
    const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text) return null;
    return text.trim().slice(0, 80);
  } catch (e) {
    console.warn('[云团子] 开场问候生成失败，降级到规则模板', e);
    return null;
  }
}

// 打开页面时如果云团子有记忆，开场主动提起（让"惊艳感"更强）
function recallMemoryOnBoot() {
  const permFacts = loadFacts();
  const mem = loadMemory();
  const chatHistory = loadChatHistory();
  // 没有任何记忆就不触发
  if (mem.length === 0 && Object.keys(permFacts).length === 0 && chatHistory.length === 0) return;
  const name = permFacts['名字'];
  // 优先从对话历史里抽话题（最近聊的），其次从记忆里抽
  let topic = null;
  if (chatHistory.length > 0) {
    // 从最近的用户消息里找话题
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      const msg = chatHistory[i];
      if (msg.role === 'user' && msg.content && msg.content.length >= 4) {
        topic = msg.content.replace(/^[，。！？\s]+|[，。！？\s]+$/g, '').slice(0, 16);
        if (topic.length >= 4) break;
      }
    }
  }
  if (!topic) topic = pickMemoryTopic();

  setTimeout(async () => {
    // 优先用缓存的 LLM 问候（1 小时内）
    let greeting = loadCachedGreeting();
    if (!greeting) {
      // 没缓存 → 临时用规则降级先显示，后台异步生成新的
      greeting = ruleBasedGreeting(name, topic);
      showBubble(greeting, 5000);
      setMood('happy', 5000);
      // 后台异步生成 LLM 问候，存缓存下次用
      if (hasLLMKey() && (mem.length > 0 || chatHistory.length > 0)) {
        const llmText = await generateMemoryGreeting();
        if (llmText) {
          saveCachedGreeting(llmText);
          // 当前这次也补一句（覆盖规则版本），让人立刻感觉到"真记得"
          showBubble(llmText, 5500);
          setMood('happy', 5500);
        }
      }
      return;
    }
    // 有缓存：直接显示
    showBubble(greeting, 5000);
    setMood('happy', 5000);
  }, 3500);
}

/* =========================================================
   18. 情绪急救 SOS —— 5-4-3-2-1 接地练习
   --------------------------------------------------------
   当心里压得喘不过气时，一键把注意力拉回当下：
   说出 5 样看到的、4 样听到的、3 样摸到的、2 样闻到的、1 件能尝到的
   每步留出充分时间慢慢找，配合呼吸圆圈节奏
   ========================================================= */
const $sosBtn    = document.getElementById('sosBtn');
const $sosOverlay= document.getElementById('sosOverlay');
const $sosStep   = document.getElementById('sosStep');
const $sosHint   = document.getElementById('sosHint');
const $sosStart  = document.getElementById('sosStart');
const $sosClose  = document.getElementById('sosClose');

// 5-4-3-2-1 接地步骤：每步含一个引导句 + 慢慢找的提示
const SOS_STEPS = [
  { n: 5, sense: '眼睛',  lead: '说出你现在能看到的 5 样东西', hint: '慢慢看——窗帘的颜色、桌角的杯子、窗外的一片云……数到 5 就好' },
  { n: 4, sense: '耳朵',  lead: '说出你现在能听到的 4 种声音', hint: '安静地听——空调声、远处车声、自己的呼吸声……' },
  { n: 3, sense: '皮肤',  lead: '说出你能摸到的 3 样东西',   hint: '用手指感受——衣服的布料、椅子的边、脚踩着的地……' },
  { n: 2, sense: '鼻子',  lead: '说出 2 种你闻到的味道',      hint: '深吸一口气——空气、衣物、或者一杯茶的味道……' },
  { n: 1, sense: '嘴巴',  lead: '说出 1 件你能尝到的东西',    hint: '嘴里淡淡的、或者刚喝的水的味道，都可以' },
];
let sosTimer = null;
let sosRunning = false;

function openSOS() {
  closeAllModals();
  $sosOverlay.classList.remove('hide');
  $sosStep.textContent = '慢慢跟着我做……';
  $sosHint.textContent = '心里很乱的时候，我们把它一点点拉回当下。准备好了点下面的按钮';
  $sosStart.classList.remove('hide');
  $sosClose.textContent = '我缓过来了';
  setMood('comfort', 0);
}
function closeSOS() {
  $sosOverlay.classList.add('hide');
  sosRunning = false;
  if (sosTimer) clearTimeout(sosTimer);
  showBubble('你刚才撑过来了，真的很棒 💛 云团子一直在', 4000);
  setMood('comfort', 4000);
}
function runSOSStep(idx) {
  if (!sosRunning) return;
  if (idx >= SOS_STEPS.length) {
    $sosStep.textContent = '你做到了 🎉';
    $sosHint.textContent = '现在感觉是不是稳一点了？你已经把自己带回了当下。深呼吸，慢慢来，云团子陪着你';
    $sosStart.textContent = '再来一轮';
    $sosStart.classList.remove('hide');
    sosRunning = false;
    return;
  }
  const s = SOS_STEPS[idx];
  $sosStep.textContent = s.lead;
  $sosHint.textContent = s.hint + '（不急，慢慢找）';
  // 每步给 14 秒慢慢找
  sosTimer = setTimeout(() => runSOSStep(idx + 1), 14000);
}
$sosBtn.addEventListener('click', openSOS);
$sosClose.addEventListener('click', closeSOS);
$sosStart.addEventListener('click', () => {
  sosRunning = true;
  $sosStart.classList.add('hide');
  runSOSStep(0);
});

/* =========================================================
   19. 声音留言 —— 录下你的真实声音，家人打开时会自动播放
   --------------------------------------------------------
   用 MediaRecorder 录音，转 base64 存 localStorage（≤30s，避免占太多）
   ========================================================= */
const VOICE_KEY = 'yuntuzi_family_voice';
const $voiceRec   = document.getElementById('voiceRec');
const $voicePlay  = document.getElementById('voicePlay');
const $voiceDel   = document.getElementById('voiceDel');
const $voiceAudio = document.getElementById('voiceAudio');
const $voiceStatus= document.getElementById('voiceStatus');

let mediaRec = null;
let recChunks = [];

function refreshVoiceUI() {
  const saved = localStorage.getItem(VOICE_KEY);
  if (saved) {
    $voiceAudio.src = saved;
    $voicePlay.classList.remove('hide');
    $voiceDel.classList.remove('hide');
    $voiceStatus.textContent = '✅ 已录好一段声音（家人打开时会自动播放）';
  } else {
    $voiceAudio.removeAttribute('src');
    $voicePlay.classList.add('hide');
    $voiceDel.classList.add('hide');
    $voiceStatus.textContent = '';
  }
}

if ($voiceRec) {
  $voiceRec.addEventListener('click', async () => {
    // 正在录音 → 停止
    if (mediaRec && mediaRec.state === 'recording') {
      mediaRec.stop();
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      $voiceStatus.textContent = '⚠️ 这个浏览器不支持录音，可以换用微信/QQ浏览器或系统浏览器试试';
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recChunks = [];
      mediaRec = new MediaRecorder(stream);
      mediaRec.ondataavailable = e => { if (e.data.size > 0) recChunks.push(e.data); };
      mediaRec.onstop = () => {
        const blob = new Blob(recChunks, { type: mediaRec.mimeType || 'audio/webm' });
        // 限制约 30s / 防止 localStorage 撑爆
        if (blob.size > 2 * 1024 * 1024) {
          $voiceStatus.textContent = '⚠️ 声音太长了，请录短一些（建议 15 秒内）';
        } else {
          const reader = new FileReader();
          reader.onloadend = () => {
            try {
              localStorage.setItem(VOICE_KEY, reader.result);
              refreshVoiceUI();
            } catch (err) {
              $voiceStatus.textContent = '⚠️ 存不下了，请录短一点';
            }
          };
          reader.readAsDataURL(blob);
        }
        stream.getTracks().forEach(t => t.stop());
        $voiceRec.classList.remove('recording');
        $voiceRec.textContent = '🔴 开始录音';
      };
      mediaRec.start();
      $voiceRec.classList.add('recording');
      $voiceRec.textContent = '⏹️ 结束录音';
      $voiceStatus.textContent = '🔴 正在录音……说完点一下结束';
    } catch (err) {
      $voiceStatus.textContent = '⚠️ 没拿到麦克风权限，请在浏览器设置里允许后重试';
    }
  });
}
if ($voicePlay) {
  $voicePlay.addEventListener('click', () => {
    if ($voiceAudio.src) { $voiceAudio.currentTime = 0; $voiceAudio.play(); }
  });
}
if ($voiceDel) {
  $voiceDel.addEventListener('click', () => {
    localStorage.removeItem(VOICE_KEY);
    refreshVoiceUI();
  });
}

// 家人打开时若有声音留言，自动播放（在 boot 中调用）
function playFamilyVoiceIfAny() {
  const saved = localStorage.getItem(VOICE_KEY);
  if (!saved) return;
  setTimeout(() => {
    $voiceAudio.src = saved;
    // 自动播放常被浏览器拦截，先气泡提示，再尝试播放
    showBubble('🎙️ 家人给你留了一段声音，点 💌 里可以听', 5000);
    setMood('happy', 5000);
    $voiceAudio.play().catch(() => {});
  }, 3000);
}
refreshVoiceUI();

/* 暖心提醒已移除 —— 关心能力融入对话，云团子会在聊天中自然带出 */

/* =========================================================
   星空场景 —— 树·萤火虫·收集星星
   --------------------------------------------------------
   每次互动（说话/小确幸/留言）= 夜空多一颗星
   星星按陪伴天数散布，点击会微微闪亮
   ========================================================= */
function initStarryScene() {
  const $starLayer = document.getElementById('starLayer');
  const $canvas = document.getElementById('fireflyCanvas');
  if (!$starLayer || !$canvas) return;

  // 背景星星（固定，随机散布）
  const bgStarCount = 40;
  for (let i = 0; i < bgStarCount; i++) {
    const s = document.createElement('div');
    s.className = 'star-dot' + (Math.random() > 0.7 ? ' bright' : '');
    s.style.left = (Math.random() * 100) + '%';
    s.style.top = (Math.random() * 80) + '%';
    s.style.setProperty('--dur', (2 + Math.random() * 4) + 's');
    s.style.setProperty('--delay', (Math.random() * 3) + 's');
    $starLayer.appendChild(s);
  }

  // 收集的星星（基于陪伴天数+互动次数）
  const days = getDaysWithCloud();
  const collectCount = Math.min(days + state.totalTalks, 60);
  for (let i = 0; i < collectCount; i++) {
    const s = document.createElement('div');
    s.className = 'star-dot collect-star';
    s.style.left = (10 + Math.random() * 80) + '%';
    s.style.top = (5 + Math.random() * 60) + '%';
    s.style.setProperty('--dur', (3 + Math.random() * 3) + 's');
    s.style.setProperty('--delay', (Math.random() * 4) + 's');
    $starLayer.appendChild(s);
  }

  // 萤火虫
  const ctx = $canvas.getContext('2d');
  let fireflies = [];
  let W, H;

  function resize() {
    W = $canvas.width = $canvas.offsetWidth;
    H = $canvas.height = $canvas.offsetHeight;
    fireflies = [];
    const count = Math.min(15, Math.floor(W / 40));
    for (let i = 0; i < count; i++) {
      fireflies.push({
        x: Math.random() * W,
        y: Math.random() * H * 0.8 + H * 0.1,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.3,
        r: 1.5 + Math.random() * 1.5,
        glow: Math.random() * Math.PI * 2,
        glowSpeed: 0.02 + Math.random() * 0.03,
        hue: 50 + Math.random() * 20,
      });
    }
  }
  resize();
  window.addEventListener('resize', resize);

  function animateFireflies() {
    ctx.clearRect(0, 0, W, H);
    for (const f of fireflies) {
      f.x += f.vx;
      f.y += f.vy;
      f.glow += f.glowSpeed;
      // 边界
      if (f.x < 0) f.x = W;
      if (f.x > W) f.x = 0;
      if (f.y < 0) f.y = H;
      if (f.y > H) f.y = 0;
      // 随机改变方向
      if (Math.random() < 0.02) {
        f.vx = (Math.random() - 0.5) * 0.6;
        f.vy = (Math.random() - 0.5) * 0.4;
      }
      const alpha = 0.4 + Math.sin(f.glow) * 0.4;
      const glowR = f.r * (3 + Math.sin(f.glow) * 2);
      // 外层光晕
      const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, glowR);
      grad.addColorStop(0, `hsla(${f.hue}, 100%, 70%, ${alpha * 0.6})`);
      grad.addColorStop(0.5, `hsla(${f.hue}, 100%, 60%, ${alpha * 0.2})`);
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(f.x, f.y, glowR, 0, Math.PI * 2);
      ctx.fill();
      // 核心亮点
      ctx.fillStyle = `hsla(${f.hue}, 100%, 85%, ${alpha})`;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(animateFireflies);
  }
  animateFireflies();
}

/* 互动时加一颗星 */
function addCollectStar() {
  const $starLayer = document.getElementById('starLayer');
  if (!$starLayer) return;
  const s = document.createElement('div');
  s.className = 'star-dot collect-star';
  s.style.left = (10 + Math.random() * 80) + '%';
  s.style.top = (5 + Math.random() * 60) + '%';
  s.style.setProperty('--dur', (3 + Math.random() * 3) + 's');
  s.style.setProperty('--delay', '0s');
  s.style.opacity = '0';
  s.style.transform = 'scale(0)';
  $starLayer.appendChild(s);
  requestAnimationFrame(() => {
    s.style.transition = 'opacity 1s, transform 1s cubic-bezier(.34,1.56,.64,1)';
    s.style.opacity = '';
    s.style.transform = 'scale(1)';
  });
  // 限制DOM数量
  const stars = $starLayer.querySelectorAll('.collect-star');
  if (stars.length > 80) stars[0].remove();
}

boot();

/* =========================================================
   iOS「添加到主屏幕」引导条
   ----------------------------------------------------------
   苹果不让 PWA 主动弹「要不要安装」，只能靠用户自己走
   「分享 → 添加到主屏幕」。这里在 iOS Safari 首次打开时
   浮一条小提示，指给用户看分享按钮在哪。点过一次就不再烦。
   判断条件：
   1) iOS（iPhone/iPad）
   2) 是 Safari（不是微信/其他内置浏览器，那些装不了）
   3) 当前不是 standalone（已经装到桌面后不会再弹）
   4) localStorage 没标记「已关过」
   ========================================================= */
function isIOSSafari() {
  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  // iOS Safari 一定带 Version/ 和 Safari/，且不含 CriOS(Chrome) FxiOS(Firefox) 微信等
  const isSafari = /Version\/[\d.]+.*Safari\//i.test(ua)
    && !/CriOS|FxiOS|MicroMessenger|QQ\/|UCBrowser|Edge\/|EdgiOS/i.test(ua);
  return isIOS && isSafari;
}
function isStandalone() {
  // iOS 装到桌面后是 standalone；安卓 Chrome 用 display-mode
  return window.navigator.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;
}
function showIOSInstallTip() {
  const KEY = 'yztz_ios_tip_dismissed';
  if (localStorage.getItem(KEY)) return;          // 关过就不再弹
  if (!isIOSSafari()) return;                       // 不是 iOS Safari 不弹
  if (isStandalone()) return;                       // 已是 App 形态不再弹

  const tip = document.createElement('div');
  tip.className = 'ios-install-tip';
  tip.innerHTML = `
    <span class="tip-icon">📲</span>
    <span class="tip-text">
      点底部 <svg class="share-ico" viewBox="0 0 24 24" fill="none">
        <rect x="9" y="2" width="6" height="12" rx="2" fill="#4a90a4"/>
        <path d="M6 14l6 6 6-6" stroke="#4a90a4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <line x1="12" y1="2" x2="12" y2="20" stroke="#4a90a4" stroke-width="0"/>
      </svg> 分享 → 选 <b>「添加到主屏幕」</b><br>
      下次桌面点图标就能开，像 App 一样全屏 ☁️
    </span>
    <button class="tip-close" aria-label="关闭">×</button>
  `;
  document.body.appendChild(tip);
  tip.querySelector('.tip-close').addEventListener('click', () => {
    tip.classList.add('hide');
    localStorage.setItem(KEY, '1');
    setTimeout(() => tip.remove(), 400);
  });
}
window.addEventListener('load', () => {
  // 延迟到首屏渲染完，避免和开场问候挤一起
  setTimeout(showIOSInstallTip, 2500);
});

/* 页面侧：收到 Service Worker 发来的"刷新拿新版"消息，自动刷新一次
   配合 sw.js 的 activate 通知，让用户刷新一次就能拿到最新代码 */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data === 'reload-for-update') {
      location.reload();
    }
  });
}

