// Built-in lists for daily-life mode. Every quest is a sentence that is easy to judge from the story.

export const RARITIES = ['common', 'rare', 'epic', 'legendary'];

// [en, ko, reward, odd]
export const DAILY_QUESTS = [
    ['Buy someone a drink', '누군가에게 음료 사 주기', 10],
    ['Take a walk outside', '밖에서 산책하기', 10],
    ['Eat a proper meal', '제대로 된 식사 한 끼 먹기', 10],
    ['Ask someone how their day went', '누군가에게 오늘 하루가 어땠는지 묻기', 15],
    ['Tidy up a room', '방 하나 정리하기', 15],
    ['Compliment someone', '누군가를 칭찬하기', 10],
    ['Cook something yourself', '직접 요리하기', 20],
    ['Take a photo of something', '무언가를 사진으로 찍기', 10],
    ['Read a book or an article', '책이나 글 읽기', 15],
    ['Help someone with a small task', '누군가의 작은 일을 도와주기', 20],
    ['Go somewhere you have never been', '처음 가 보는 곳에 가기', 25],
    ['Exercise for a while', '잠깐이라도 운동하기', 20],
    ['Send a message to a friend', '친구에게 연락하기', 10],
    ['Buy something at a shop', '가게에서 물건 하나 사기', 10],
    ['Make someone laugh', '누군가를 웃게 만들기', 20],
    ['Thank someone out loud', '누군가에게 소리 내어 고맙다고 말하기', 10],
    ['Pet a cat', '고양이 쓰다듬기', 15, true],
    ['Sing a song out loud', '소리 내어 노래 부르기', 15, true],
    ['Wave at a stranger', '모르는 사람에게 손 흔들기', 15, true],
];

// [en name, ko name, en desc, ko desc, rarity, price, icon, kind, odd, limited]
const STANDING = [
    ['Recovery Potion', '회복약', 'Eases tiredness and small aches.', '피로와 작은 통증이 가라앉는다.', 'common', 40, 'potion'],
    ['Energy Drink', '에너지 드링크', 'Wide awake for a few hours.', '몇 시간 동안 정신이 또렷해진다.', 'common', 20, 'can'],
    ['Sturdy Umbrella', '튼튼한 우산', 'Never turns inside out, whatever the wind.', '어떤 바람에도 뒤집히지 않는다.', 'common', 30, 'umbrella'],
    ['Warm Tea', '따뜻한 차', 'A calm mind for a while.', '잠시 마음이 차분해진다.', 'common', 25, 'tea'],
    ['Lucky Coin', '행운의 동전', 'A small stroke of luck today.', '오늘 작은 행운이 한 번 찾아온다.', 'rare', 120, 'coin'],
    ['Daily Quest Reroll Ticket', '일일 퀘스트 다시 뽑기권', "Swaps today's unfinished daily quests for new ones.", '오늘 아직 못 깬 일일 퀘스트를 새로 바꾼다.', 'common', 30, 'reroll', 'reroll'],
    ['Gacha Ticket', '뽑기권', 'One draw: a skill or an item. Often something odd.', '한 번 뽑는다. 스킬이나 물건이 나온다. 엉뚱한 게 자주 나온다.', 'rare', 100, 'ticket', 'gacha'],
];

const DAILY_POOL = [
    ['Hairpin of Good Impressions', '호감 머리핀', 'First impressions go a little better while you wear it.', '하고 있는 동안 첫인상이 조금 좋아진다.', 'rare', 150, 'hairpin'],
    ['Hourglass of a Spare Moment', '여유의 모래시계', 'Once, a moment slows down enough to think.', '한 번, 생각할 틈이 생길 만큼 순간이 느려진다.', 'epic', 350, 'hourglass'],
    ['Map That Never Gets Lost', '길 잃지 않는 지도', 'Today you always find the way.', '오늘은 언제나 길을 찾는다.', 'rare', 110, 'map'],
    ['Sweet Bun of Comfort', '위로의 단팥빵', 'A bad mood melts a little.', '나쁜 기분이 조금 풀린다.', 'common', 30, 'bread'],
    ['Weather Charm', '날씨 부적', "Today's weather turns a little in your favor.", '오늘 날씨가 조금 내 편이 된다.', 'rare', 160, 'charm'],
    ['Shirt of Confidence', '자신감 셔츠', 'You stand a little taller in it.', '입으면 어깨가 조금 펴진다.', 'common', 60, 'shirt'],
    ['Lost-and-Found Bell', '분실물 방울', 'Something lost turns up soon.', '잃어버린 것이 곧 나타난다.', 'rare', 130, 'bell'],
    ['Golden Pen', '황금 만년필', 'Whatever you write today is remembered.', '오늘 쓴 글은 누군가 꼭 기억한다.', 'legendary', 900, 'pen'],
    ['Pressed Flower Bookmark', '압화 책갈피', 'A small gift that always pleases.', '선물하면 꼭 기뻐하는 작은 선물.', 'common', 45, 'flower'],
    ['Melody Box', '멜로디 상자', 'Plays the one song that fits the moment.', '지금 분위기에 딱 맞는 노래가 흘러나온다.', 'epic', 320, 'music'],
    ['Talk to Cats (one use)', '고양이와 대화하는 능력 (1회용)', 'For one conversation, cats understand you and answer.', '대화 한 번 동안 고양이가 말을 알아듣고 대답한다.', 'epic', 300, 'cat', 'item', true, true],
    ['Pocket Rain Cloud', '주머니 비구름', 'A tiny cloud that rains only on you. Why?', '나한테만 비를 뿌리는 작은 구름. 왜?', 'rare', 140, 'cloud', 'item', true],
    ['Socks That Always Match', '언제나 짝이 맞는 양말', 'Never lose a pair again.', '다시는 짝을 잃어버리지 않는다.', 'common', 20, 'socks', 'item', true],
];

const toItem = (row, lang, prefix, n) => {
    const [en, ko, den, dko, rarity, price, icon, kind = 'item', odd = false, limited = false] = row;
    return { id: `${prefix}${n}`, name: lang === 'ko' ? ko : en, desc: lang === 'ko' ? dko : den, rarity, price, icon, kind, odd, limited, builtIn: true };
};

export function standingDefaults(lang) { return STANDING.map((r, n) => toItem(r, lang, 'std', n)); }
export function dailyPool(lang) { return DAILY_POOL.map((r, n) => toItem(r, lang, 'dp', n)); }

export function questPool(lang, oddities = true) {
    return DAILY_QUESTS.filter(q => oddities || !q[3]).map(q => ({ name: lang === 'ko' ? q[1] : q[0], reward: q[2], odd: !!q[3] }));
}

// Penalty quests (Hard / Hell): a small chore that lifts the debuff. No reward.
const PENALTY_QUESTS = [
    ['Do a chore you have been putting off', '미뤄 둔 집안일 하나 하기'],
    ['Run an errand for someone', '누군가의 심부름 하기'],
    ['Apologize to someone for something', '누군가에게 사과하기'],
    ['Clean something until it shines', '무언가를 반짝이게 닦기'],
];

export function penaltyPool(lang) { return PENALTY_QUESTS.map(q => ({ name: lang === 'ko' ? q[1] : q[0] })); }

/** "name | price | rarity | description" lines → shop items. */
export function parseCustomShop(text) {
    const out = [];
    String(text || '').split('\n').forEach((ln, n) => {
        const parts = ln.split('|').map(x => x.trim());
        if (!parts[0]) return;
        const price = Math.max(0, Math.round(Number(parts[1]) || 50));
        const r = String(parts[2] || '').toLowerCase();
        const rarity = RARITIES.find(x => x === r || x.slice(0, 1) === r.slice(0, 1) && r) || ({ 일반: 'common', 희귀: 'rare', 영웅: 'epic', 전설: 'legendary' })[parts[2]] || 'common';
        out.push({ id: `cus${n}_${parts[0].slice(0, 12)}`, name: parts[0].slice(0, 60), desc: (parts[3] || '').slice(0, 200), rarity, price, icon: 'box', kind: 'item', custom: true });
    });
    return out;
}

export const TUTORIAL_REWARD = 100;

// ---------- skills (stage 2-C) ----------
// Grades F → S, and SS above S (very rare). No numbers, no cooldowns, no mana.
export const GRADES = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS'];
export const LOW_GRADES = ['F', 'E']; // only these can have a hidden effect

// [en name, ko name, en effect, ko effect, type, en hidden, ko hidden, odd]
const SKILLS = [
    ['Cooking', '요리', 'Simple dishes always come out tasty.', '간단한 요리는 늘 맛있게 된다.', 'passive', 'Food you make lifts the mood of whoever eats it.', '내가 만든 음식을 먹은 사람은 기분이 풀린다.'],
    ['Popular with Cats', '고양이에게 인기 많음', 'Cats like you and follow you around.', '고양이가 잘 따른다.', 'passive', 'Cats warn you before something bad happens.', '고양이가 위험을 미리 알려 준다.', true],
    ['Good Hunch on Rainy Days', '비 오는 날 감이 좋음', 'On rainy days small hunches tend to be right.', '비가 오면 사소한 예감이 잘 맞는다.', 'passive', 'On rainy days you can tell when someone lies.', '비 오는 날에는 거짓말을 알아챈다.'],
    ['Déjà Vu', '데자뷔', 'Used: you recall one small clue in the next scene.', '쓰면 다음 장면에서 작은 단서 하나를 떠올린다.', 'active', 'The clue also hints where it leads.', '떠올린 단서가 어디로 이어지는지도 어렴풋이 보인다.'],
    ['Regulars Magnet', '단골 자석', 'Shop owners remember you and add a little extra.', '가게 주인들이 나를 기억하고 조금씩 더 챙겨 준다.', 'passive', 'Regulars of a place share its secrets with you.', '단골들이 그 가게의 비밀을 알려 준다.'],
    ['Perfect Nap', '완벽한 낮잠', 'Used: a short nap feels like a full night of sleep.', '쓰면 짧은 낮잠이 하룻밤 잔 것처럼 개운하다.', 'active', 'Sometimes you dream of a small part of tomorrow.', '가끔 내일의 한 장면을 꿈에서 본다.'],
    ['Lost-Thing Finder', '물건 찾기', 'Used: you find one lost thing nearby.', '쓰면 근처에서 잃어버린 물건 하나를 찾는다.', 'active', 'It also finds what someone else is looking for.', '다른 사람이 찾는 물건도 찾을 수 있다.'],
    ['Small Talk', '스몰토크', 'Talks with strangers start easily.', '처음 보는 사람과도 대화가 쉽게 시작된다.', 'passive', 'People tell you one thing they told no one else.', '사람들이 아무에게도 안 한 이야기를 하나씩 털어놓는다.'],
    ['Umbrella Luck', '우산 운', 'The rain starts only after you get indoors.', '실내에 들어간 뒤에야 비가 내리기 시작한다.', 'passive', 'You can also keep the rain off someone beside you.', '옆 사람도 비를 피하게 할 수 있다.', true],
    ['Weather Reading', '날씨 읽기', 'Used: you know the weather of the next few hours.', '쓰면 앞으로 몇 시간 날씨를 정확히 안다.', 'active', 'You also sense the mood the day will bring.', '그날 일어날 일의 분위기도 느낀다.'],
    ['Reading the Room', '분위기 파악', 'You sense the mood of a room as you walk in.', '방에 들어서면 분위기를 바로 알아챈다.', 'passive', 'You see who in the room needs help.', '방 안에서 도움이 필요한 사람이 보인다.'],
    ['Quiet Steps', '조용한 발걸음', 'Your steps make no sound when you want.', '원할 때 발소리가 나지 않는다.', 'passive', 'Others also stop noticing you for a moment.', '잠깐 동안 다른 사람 눈에도 잘 띄지 않는다.'],
    ['Pigeon Talk', '비둘기 말 알아듣기', 'You understand pigeons. They mostly complain.', '비둘기 말을 알아듣는다. 대부분 불평이다.', 'passive', 'Pigeons bring you news from around town.', '비둘기들이 동네 소식을 물어다 준다.', true],
    ['Excuse Maker', '핑계 생성기', 'Used: you come up with a believable excuse.', '쓰면 그럴듯한 핑계가 바로 떠오른다.', 'active', 'The excuse turns out to be true.', '지어낸 핑계가 사실이 된다.', true],
    ['Second Wind', '재충전', 'Used: tiredness is gone, once.', '쓰면 피로가 한 번 싹 사라진다.', 'active', 'Someone you touch gets their strength back too.', '손을 잡은 사람도 기운을 되찾는다.'],
    ['Gift Sense', '선물 감각', 'You always know what gift someone would like.', '누가 무엇을 좋아할지 선물을 고를 때 늘 맞힌다.', 'passive', 'A gift you give is remembered for a long time.', '내가 준 선물은 오래 기억된다.'],
];

export function skillPool(lang, oddities = true) {
    return SKILLS.filter(x => oddities || !x[7]).map(x => ({
        name: lang === 'ko' ? x[1] : x[0], effect: lang === 'ko' ? x[3] : x[2], type: x[4], hidden: lang === 'ko' ? x[6] : x[5],
    }));
}

// Odd things that only come out of a gacha draw: [en, ko, en desc, ko desc, rarity, icon]
const GACHA_ODD = [
    ['Half a Treasure Map', '보물 지도 반쪽', 'Where is the other half?', '나머지 반쪽은 어디에?', 'rare', 'map'],
    ['Bottle of Yesterday’s Air', '어제의 공기 한 병', 'Smells a little like yesterday.', '열면 어제 냄새가 조금 난다.', 'common', 'potion'],
    ['Umbrella for Ants', '개미용 우산', 'Very well made. Very small.', '아주 잘 만들었다. 아주 작다.', 'common', 'umbrella'],
    ['Key to Somewhere', '어딘가의 열쇠', 'Opens one door. Which one, nobody knows.', '어떤 문 하나를 연다. 어느 문인지는 모른다.', 'epic', 'key'],
    ['Star That Fell Today', '오늘 떨어진 별', 'Still warm. Makes one wish a little likelier.', '아직 따뜻하다. 소원 하나가 조금 더 잘 이루어진다.', 'legendary', 'star'],
];

export function gachaOddPool(lang) { return GACHA_ODD.map((r, n) => ({ id: `go${n}`, name: lang === 'ko' ? r[1] : r[0], desc: lang === 'ko' ? r[3] : r[2], rarity: r[4], price: 0, icon: r[5], kind: 'item', odd: true })); }

export function shuffle(list, rnd = Math.random) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
}
