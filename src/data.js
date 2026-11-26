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
    ['Gacha Ticket', '뽑기권', 'One draw. (Opens in stage 2.)', '한 번 뽑을 수 있다. (2단계에서 열림)', 'rare', 100, 'ticket', 'gacha'],
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

export function shuffle(list, rnd = Math.random) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
}
