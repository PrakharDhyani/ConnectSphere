/**
 * Emoji catalogue for the chat picker.
 *
 * Deliberately a hand-curated static list rather than an npm emoji package:
 * the full Unicode set is ~1,900 emoji and every library that ships it also
 * ships keyword indexes (300 KB–1 MB of JS). This is ~500 of the emoji people
 * actually send, with search keywords, in a few KB — no dependency, no bundle
 * hit, and it renders with the system font (zero image requests).
 *
 * Each entry: [glyph, "space separated search keywords"].
 */

export const EMOJI_CATEGORIES = [
  {
    id: "smileys",
    label: "Smileys & People",
    icon: "😀",
    emoji: [
      ["😀", "grin smile happy"], ["😃", "smile happy joy"], ["😄", "smile happy laugh"],
      ["😁", "grin beam happy"], ["😆", "laugh satisfied haha"], ["😅", "sweat laugh relief"],
      ["🤣", "rofl rolling laugh floor"], ["😂", "joy tears laugh cry"], ["🙂", "slight smile"],
      ["🙃", "upside down silly"], ["😉", "wink flirt"], ["😊", "blush smile shy"],
      ["😇", "innocent halo angel"], ["🥰", "love hearts adore"], ["😍", "heart eyes love"],
      ["🤩", "star struck wow amazed"], ["😘", "kiss blow"], ["😗", "kissing"],
      ["😚", "kissing closed eyes"], ["😙", "kissing smile"], ["🥲", "smile tear"],
      ["😋", "yum tasty delicious tongue"], ["😛", "tongue out"], ["😜", "wink tongue crazy"],
      ["🤪", "zany goofy crazy"], ["😝", "squint tongue"], ["🤑", "money mouth rich"],
      ["🤗", "hug hands"], ["🤭", "hand over mouth oops giggle"], ["🤫", "shush quiet secret"],
      ["🤔", "thinking hmm consider"], ["🤐", "zipper mouth silent"], ["🤨", "raised eyebrow suspicious"],
      ["😐", "neutral meh"], ["😑", "expressionless blank"], ["😶", "no mouth speechless"],
      ["😏", "smirk sly"], ["😒", "unamused annoyed"], ["🙄", "eye roll whatever"],
      ["😬", "grimace awkward yikes"], ["🤥", "lying pinocchio"], ["😌", "relieved calm"],
      ["😔", "pensive sad"], ["😪", "sleepy tired"], ["🤤", "drool"],
      ["😴", "sleeping zzz"], ["😷", "mask sick"], ["🤒", "thermometer sick fever"],
      ["🤕", "bandage hurt injured"], ["🤢", "nauseated sick gross"], ["🤮", "vomit puke"],
      ["🤧", "sneeze tissue"], ["🥵", "hot heat sweating"], ["🥶", "cold freezing"],
      ["🥴", "woozy drunk dizzy"], ["😵", "dizzy knocked out"], ["🤯", "mind blown explode"],
      ["🤠", "cowboy hat"], ["🥳", "party celebrate birthday"], ["🥸", "disguise glasses"],
      ["😎", "cool sunglasses"], ["🤓", "nerd glasses geek"], ["🧐", "monocle inspect"],
      ["😕", "confused"], ["😟", "worried"], ["🙁", "frown slight"],
      ["😮", "open mouth surprised wow"], ["😯", "hushed surprised"], ["😲", "astonished shocked"],
      ["😳", "flushed embarrassed"], ["🥺", "pleading puppy eyes beg"], ["😦", "frowning open"],
      ["😧", "anguished"], ["😨", "fearful scared"], ["😰", "anxious sweat"],
      ["😥", "sad relieved"], ["😢", "cry sad tear"], ["😭", "sob crying loud"],
      ["😱", "scream fear shock"], ["😖", "confounded"], ["😣", "persevere struggle"],
      ["😞", "disappointed sad"], ["😓", "downcast sweat"], ["😩", "weary tired"],
      ["😫", "tired exhausted"], ["🥱", "yawn bored"], ["😤", "triumph steam angry"],
      ["😡", "rage angry mad"], ["😠", "angry mad"], ["🤬", "cursing swearing"],
      ["😈", "smiling devil imp"], ["👿", "angry devil"], ["💀", "skull dead"],
      ["☠️", "skull crossbones"], ["💩", "poop pile"], ["🤡", "clown"],
      ["👻", "ghost boo"], ["👽", "alien"], ["🤖", "robot bot"],
      ["😺", "cat grin"], ["😹", "cat joy tears"], ["😻", "cat heart eyes"],
      ["🙈", "see no evil monkey"], ["🙉", "hear no evil monkey"], ["🙊", "speak no evil monkey"],
      ["👶", "baby"], ["🧒", "child"], ["👦", "boy"], ["👧", "girl"],
      ["🧑", "person adult"], ["👨", "man"], ["👩", "woman"],
      ["🧔", "beard"], ["👴", "old man"], ["👵", "old woman"],
      ["👮", "police officer cop"], ["🕵️", "detective spy"], ["👷", "construction worker"],
      ["🤴", "prince"], ["👸", "princess"], ["🦸", "superhero"], ["🦹", "supervillain"],
      ["🧙", "mage wizard"], ["🧚", "fairy"], ["🧛", "vampire"], ["🧜", "merperson"],
      ["🎅", "santa christmas"], ["🤶", "mrs claus"], ["👼", "angel baby"],
      ["🙅", "no gesture forbidden"], ["🙆", "ok gesture"], ["💁", "tipping hand sassy"],
      ["🙋", "raising hand"], ["🧏", "deaf person"], ["🙇", "bow sorry"],
      ["🤦", "facepalm"], ["🤷", "shrug dunno"], ["💃", "dancing woman"],
      ["🕺", "dancing man"], ["👯", "bunny ears partying"], ["🧘", "meditate yoga lotus"],
      ["🛌", "sleeping bed"], ["👭", "holding hands women"], ["👫", "holding hands"],
      ["👬", "holding hands men"], ["💏", "kiss couple"], ["💑", "couple heart"],
      ["👪", "family"], ["🗣️", "speaking head"], ["👤", "silhouette person"],
    ],
  },
  {
    id: "gestures",
    label: "Gestures & Body",
    icon: "👍",
    emoji: [
      ["👍", "thumbs up like yes approve"], ["👎", "thumbs down dislike no"],
      ["👌", "ok perfect"], ["🤌", "pinched fingers italian"], ["🤏", "pinch small"],
      ["✌️", "victory peace"], ["🤞", "crossed fingers luck hope"], ["🫰", "fingers crossed money"],
      ["🤟", "love you gesture"], ["🤘", "rock horns metal"], ["🤙", "call me shaka"],
      ["👈", "point left"], ["👉", "point right"], ["👆", "point up"], ["👇", "point down"],
      ["☝️", "index up"], ["✋", "raised hand stop"], ["🤚", "back of hand"],
      ["🖐️", "hand fingers splayed"], ["🖖", "vulcan spock"], ["👋", "wave hello hi bye"],
      ["🤝", "handshake deal agree"], ["🙏", "pray thanks please namaste"],
      ["👏", "clap applause bravo"], ["🙌", "raising hands praise celebrate"],
      ["👐", "open hands"], ["🤲", "palms up"], ["🫶", "heart hands love"],
      ["✍️", "writing hand"], ["💅", "nail polish"], ["🤳", "selfie"],
      ["💪", "muscle strong flex"], ["🦾", "mechanical arm"], ["🦵", "leg"],
      ["🦶", "foot"], ["👂", "ear listen"], ["👃", "nose"], ["🧠", "brain smart"],
      ["🦷", "tooth"], ["🦴", "bone"], ["👀", "eyes look watch"], ["👁️", "eye"],
      ["👅", "tongue"], ["👄", "mouth lips"], ["🫦", "biting lip"],
    ],
  },
  {
    id: "hearts",
    label: "Hearts & Love",
    icon: "❤️",
    emoji: [
      ["❤️", "red heart love"], ["🧡", "orange heart"], ["💛", "yellow heart"],
      ["💚", "green heart"], ["💙", "blue heart"], ["💜", "purple heart"],
      ["🖤", "black heart"], ["🤍", "white heart"], ["🤎", "brown heart"],
      ["💔", "broken heart sad"], ["❣️", "heart exclamation"], ["💕", "two hearts"],
      ["💞", "revolving hearts"], ["💓", "beating heart"], ["💗", "growing heart"],
      ["💖", "sparkling heart"], ["💘", "heart arrow cupid"], ["💝", "heart ribbon gift"],
      ["💟", "heart decoration"], ["♥️", "heart suit"], ["💋", "kiss mark lips"],
      ["💌", "love letter"], ["🌹", "rose flower romance"], ["💐", "bouquet flowers"],
      ["💍", "ring engagement"], ["💒", "wedding chapel"], ["🥀", "wilted flower"],
    ],
  },
  {
    id: "celebration",
    label: "Celebration",
    icon: "🎉",
    emoji: [
      ["🎉", "party popper tada celebrate"], ["🎊", "confetti ball party"],
      ["🎈", "balloon party"], ["🎂", "birthday cake"], ["🍰", "cake slice"],
      ["🧁", "cupcake"], ["🎁", "gift present"], ["🎀", "ribbon bow"],
      ["🎆", "fireworks"], ["🎇", "sparkler"], ["✨", "sparkles shiny magic"],
      ["🌟", "glowing star"], ["⭐", "star"], ["💫", "dizzy star"],
      ["🔥", "fire lit hot flame"], ["💥", "collision boom"], ["💯", "hundred perfect score"],
      ["🏆", "trophy win champion"], ["🥇", "gold medal first"], ["🥈", "silver medal second"],
      ["🥉", "bronze medal third"], ["🎖️", "military medal"], ["🏅", "sports medal"],
      ["👑", "crown king queen royal"], ["🎓", "graduation cap"], ["🪅", "pinata"],
      ["🍾", "champagne bottle pop"], ["🥂", "clink glasses cheers"], ["🍻", "beers cheers"],
      ["🎃", "jack o lantern halloween"], ["🎄", "christmas tree"], ["🧨", "firecracker"],
    ],
  },
  {
    id: "activities",
    label: "Games & Activities",
    icon: "🎮",
    emoji: [
      ["🎮", "video game controller gaming"], ["🕹️", "joystick arcade"], ["👾", "alien monster space invader"],
      ["🎯", "dart bullseye target"], ["🎲", "die dice ludo"], ["♟️", "chess pawn"],
      ["🃏", "joker card uno"], ["🀄", "mahjong"], ["🎰", "slot machine"],
      ["🎳", "bowling"], ["⚽", "soccer football"], ["🏀", "basketball"],
      ["🏈", "american football"], ["⚾", "baseball"], ["🎾", "tennis"],
      ["🏐", "volleyball"], ["🏓", "ping pong table tennis"], ["🏸", "badminton"],
      ["🥊", "boxing glove"], ["🏒", "hockey"], ["🏏", "cricket"],
      ["⛳", "golf flag"], ["🏹", "bow arrow archery"], ["🎣", "fishing"],
      ["🛹", "skateboard"], ["🛼", "roller skate"], ["⛷️", "skier"],
      ["🏂", "snowboard"], ["🏄", "surfing"], ["🏊", "swimming"],
      ["🚴", "cycling bike"], ["🏋️", "weight lifting gym"], ["🤸", "cartwheel"],
      ["🤼", "wrestling"], ["🎨", "art palette paint draw"], ["🎭", "performing arts theater"],
      ["🎬", "clapper board movie film"], ["🎤", "microphone sing karaoke"], ["🎧", "headphones music"],
      ["🎵", "music note"], ["🎶", "music notes"], ["🎸", "guitar"],
      ["🎹", "piano keyboard"], ["🥁", "drum"], ["🎺", "trumpet"],
      ["🎻", "violin"], ["🪄", "magic wand"], ["🧩", "puzzle piece"],
      ["🎪", "circus tent"], ["🖊️", "pen write"], ["✏️", "pencil"],
      ["📷", "camera photo"], ["📹", "video camera"], ["🍿", "popcorn movie"],
    ],
  },
  {
    id: "food",
    label: "Food & Drink",
    icon: "🍕",
    emoji: [
      ["🍕", "pizza"], ["🍔", "burger hamburger"], ["🍟", "fries"],
      ["🌭", "hot dog"], ["🥪", "sandwich"], ["🌮", "taco"], ["🌯", "burrito"],
      ["🥙", "wrap"], ["🧆", "falafel"], ["🥚", "egg"], ["🍳", "cooking fried egg"],
      ["🥘", "paella pan"], ["🍲", "stew pot"], ["🍜", "ramen noodles"],
      ["🍝", "spaghetti pasta"], ["🍛", "curry rice"], ["🍚", "rice"],
      ["🍣", "sushi"], ["🍱", "bento box"], ["🥟", "dumpling"],
      ["🍤", "shrimp tempura"], ["🍗", "poultry leg chicken"], ["🍖", "meat bone"],
      ["🥩", "steak meat"], ["🥓", "bacon"], ["🧀", "cheese"],
      ["🥗", "salad"], ["🥦", "broccoli"], ["🥕", "carrot"], ["🌽", "corn"],
      ["🍅", "tomato"], ["🥑", "avocado"], ["🍞", "bread"], ["🥐", "croissant"],
      ["🥖", "baguette"], ["🥨", "pretzel"], ["🧇", "waffle"], ["🥞", "pancakes"],
      ["🍩", "donut"], ["🍪", "cookie"], ["🍫", "chocolate"], ["🍬", "candy"],
      ["🍭", "lollipop"], ["🍦", "ice cream soft serve"], ["🍨", "ice cream"],
      ["🍧", "shaved ice"], ["🍎", "apple"], ["🍌", "banana"], ["🍇", "grapes"],
      ["🍓", "strawberry"], ["🍉", "watermelon"], ["🍊", "orange tangerine"],
      ["🍋", "lemon"], ["🥭", "mango"], ["🍍", "pineapple"], ["🥥", "coconut"],
      ["🍒", "cherries"], ["🍑", "peach"], ["🥝", "kiwi"],
      ["☕", "coffee hot beverage"], ["🍵", "tea"], ["🧋", "bubble tea boba"],
      ["🥤", "cup straw soda"], ["🧃", "juice box"], ["🍺", "beer"],
      ["🍷", "wine"], ["🍸", "cocktail martini"], ["🍹", "tropical drink"],
      ["🥃", "whisky"], ["🧊", "ice cube"], ["🍯", "honey"],
    ],
  },
  {
    id: "nature",
    label: "Animals & Nature",
    icon: "🐶",
    emoji: [
      ["🐶", "dog puppy"], ["🐱", "cat kitten"], ["🐭", "mouse"], ["🐹", "hamster"],
      ["🐰", "rabbit bunny"], ["🦊", "fox"], ["🐻", "bear"], ["🐼", "panda"],
      ["🐨", "koala"], ["🐯", "tiger"], ["🦁", "lion"], ["🐮", "cow"],
      ["🐷", "pig"], ["🐸", "frog"], ["🐵", "monkey"], ["🐔", "chicken"],
      ["🐧", "penguin"], ["🐦", "bird"], ["🦆", "duck"], ["🦅", "eagle"],
      ["🦉", "owl"], ["🦇", "bat"], ["🐺", "wolf"], ["🐗", "boar"],
      ["🐴", "horse"], ["🦄", "unicorn"], ["🐝", "bee"], ["🐛", "bug caterpillar"],
      ["🦋", "butterfly"], ["🐌", "snail"], ["🐞", "ladybug"], ["🐜", "ant"],
      ["🕷️", "spider"], ["🦂", "scorpion"], ["🐢", "turtle"], ["🐍", "snake"],
      ["🦎", "lizard"], ["🦖", "t-rex dinosaur"], ["🐙", "octopus"], ["🦑", "squid"],
      ["🦐", "shrimp"], ["🦀", "crab"], ["🐡", "blowfish"], ["🐠", "tropical fish"],
      ["🐬", "dolphin"], ["🐳", "whale"], ["🦈", "shark"], ["🐊", "crocodile"],
      ["🐘", "elephant"], ["🦏", "rhino"], ["🐪", "camel"], ["🦒", "giraffe"],
      ["🦘", "kangaroo"], ["🐑", "sheep"], ["🐐", "goat"], ["🦌", "deer"],
      ["🌸", "cherry blossom flower"], ["🌺", "hibiscus"], ["🌻", "sunflower"],
      ["🌷", "tulip"], ["🌼", "daisy"], ["🌿", "herb leaf"], ["🍀", "four leaf clover luck"],
      ["🍁", "maple leaf"], ["🍂", "fallen leaves autumn"], ["🌳", "tree"],
      ["🌲", "evergreen"], ["🌴", "palm tree"], ["🌵", "cactus"], ["🌾", "wheat"],
      ["🌍", "earth globe"], ["🌙", "crescent moon"], ["☀️", "sun sunny"],
      ["⛅", "partly cloudy"], ["☁️", "cloud"], ["🌧️", "rain"], ["⛈️", "thunderstorm"],
      ["❄️", "snowflake cold"], ["⛄", "snowman"], ["🌈", "rainbow"],
      ["⚡", "lightning zap"], ["🌊", "wave ocean water"], ["💧", "droplet"],
    ],
  },
  {
    id: "objects",
    label: "Objects & Symbols",
    icon: "💡",
    emoji: [
      ["💡", "light bulb idea"], ["🔦", "flashlight"], ["🕯️", "candle"],
      ["📱", "mobile phone"], ["💻", "laptop computer"], ["🖥️", "desktop computer"],
      ["⌨️", "keyboard typing"], ["🖱️", "mouse computer"], ["💾", "floppy disk save"],
      ["📀", "dvd disc"], ["📞", "telephone call"], ["☎️", "phone"],
      ["📺", "television tv"], ["📻", "radio"], ["⏰", "alarm clock"],
      ["⌚", "watch"], ["⏳", "hourglass waiting"], ["🔋", "battery"],
      ["🔌", "plug power"], ["💰", "money bag"], ["💵", "dollar cash"],
      ["💳", "credit card"], ["💎", "gem diamond"], ["⚖️", "balance scale justice"],
      ["🔧", "wrench tool fix"], ["🔨", "hammer"], ["🛠️", "tools"],
      ["🔑", "key"], ["🔒", "lock closed"], ["🔓", "unlock open"],
      ["🛡️", "shield protect"], ["🔍", "magnifying glass search"], ["📌", "pushpin"],
      ["📎", "paperclip attach"], ["✂️", "scissors cut"], ["📋", "clipboard"],
      ["📁", "folder"], ["📂", "open folder"], ["📄", "page document file"],
      ["📊", "bar chart graph"], ["📈", "chart increasing up"], ["📉", "chart decreasing down"],
      ["📅", "calendar date"], ["📖", "open book read"], ["📚", "books"],
      ["📝", "memo note write"], ["✉️", "envelope email"], ["📩", "incoming envelope"],
      ["📢", "loudspeaker announce"], ["📣", "megaphone cheer"], ["🔔", "bell notification"],
      ["🔕", "bell off mute"], ["🚀", "rocket launch fast"], ["✈️", "airplane travel"],
      ["🚗", "car"], ["🚕", "taxi"], ["🚌", "bus"], ["🚲", "bicycle"],
      ["🏠", "house home"], ["🏢", "office building"], ["🏥", "hospital"],
      ["🏫", "school"], ["⛺", "tent camping"], ["🗺️", "map"],
      ["📍", "pin location"], ["🚩", "triangular flag"], ["🏁", "checkered flag finish"],
      ["✅", "check mark done yes"], ["❌", "cross mark no wrong"], ["⭕", "circle"],
      ["❗", "exclamation"], ["❓", "question"], ["⚠️", "warning caution"],
      ["🚫", "prohibited no"], ["♻️", "recycle"], ["🆕", "new"],
      ["🆒", "cool"], ["🆗", "ok"], ["🔝", "top up"], ["🔙", "back"],
      ["➕", "plus add"], ["➖", "minus"], ["✖️", "multiply"], ["➗", "divide"],
      ["🔀", "shuffle"], ["🔁", "repeat loop"], ["▶️", "play"], ["⏸️", "pause"],
      ["⏹️", "stop"], ["⏺️", "record"], ["⏭️", "next track"], ["🔇", "mute"],
      ["🔊", "speaker loud"], ["🎙️", "studio microphone"], ["🖼️", "framed picture"],
    ],
  },
];

/** Flat [glyph, keywords] list — the search index. */
const ALL = EMOJI_CATEGORIES.flatMap((c) => c.emoji);

/** Substring search over keywords; returns glyphs only. */
export function searchEmoji(query, limit = 60) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const starts = [];
  const contains = [];
  for (const [glyph, keywords] of ALL) {
    const idx = keywords.indexOf(q);
    if (idx === 0 || keywords.includes(` ${q}`)) starts.push(glyph);
    else if (idx > -1) contains.push(glyph);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

// ── Recently used (localStorage) ───────────────────────────────────────────
const RECENT_KEY = "groot:emoji:recent";
const RECENT_MAX = 32;

export function getRecentEmoji() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((e) => typeof e === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function pushRecentEmoji(glyph) {
  try {
    const next = [glyph, ...getRecentEmoji().filter((e) => e !== glyph)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    return next;
  } catch {
    return getRecentEmoji();
  }
}
