/**
 * Word segmentation for transcribed tokens.
 *
 * Fast singing makes Whisper merge words into one token ("sixfootsix", "twofortyfive").
 * Rendered as-is, the syllables jam together with no spaces. This splits a merged token
 * back into real words — but only when every part is a known word, so genuine words
 * ("something", "without", "birthday") are never broken.
 */

/** Common English words, used only to recognize the parts of a merged token. */
const COMMON_WORDS = new Set([
  // articles, pronouns, possessives
  'a', 'an', 'the', 'i', 'me', 'my', 'mine', 'you', 'your', 'yours', 'he', 'him', 'his',
  'she', 'her', 'hers', 'it', 'its', 'we', 'us', 'our', 'ours', 'they', 'them', 'their',
  'theirs', 'this', 'that', 'these', 'those', 'who', 'whom', 'whose', 'which', 'what',
  'myself', 'yourself', 'himself', 'herself', 'itself', 'ourselves', 'themselves',
  // prepositions, conjunctions, particles
  'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'up', 'down', 'out', 'off',
  'over', 'under', 'again', 'into', 'onto', 'about', 'above', 'below', 'between', 'through',
  'during', 'before', 'after', 'and', 'but', 'or', 'nor', 'so', 'yet', 'as', 'if', 'then',
  'than', 'when', 'while', 'where', 'because', 'until', 'though', 'although', 'whether',
  // auxiliary + common verbs
  'be', 'am', 'is', 'are', 'was', 'were', 'been', 'being', 'have', 'has', 'had', 'having',
  'do', 'does', 'did', 'doing', 'done', 'will', 'would', 'shall', 'should', 'can', 'could',
  'may', 'might', 'must', 'ought', 'need', 'dare',
  'say', 'said', 'go', 'goes', 'went', 'gone', 'get', 'gets', 'got', 'gotten', 'make',
  'made', 'know', 'knew', 'known', 'see', 'saw', 'seen', 'come', 'came', 'take', 'took',
  'taken', 'think', 'thought', 'look', 'looked', 'want', 'wanted', 'give', 'gave', 'given',
  'use', 'used', 'find', 'found', 'tell', 'told', 'ask', 'asked', 'work', 'worked', 'seem',
  'seemed', 'feel', 'felt', 'try', 'tried', 'leave', 'left', 'call', 'called', 'turn',
  'turned', 'start', 'started', 'begin', 'began', 'begun', 'help', 'helped', 'show',
  'showed', 'shown', 'hear', 'heard', 'play', 'played', 'run', 'ran', 'move', 'moved',
  'live', 'lived', 'believe', 'believed', 'hold', 'held', 'bring', 'brought', 'happen',
  'happened', 'write', 'wrote', 'written', 'sit', 'sat', 'stand', 'stood', 'lose', 'lost',
  'pay', 'paid', 'meet', 'met', 'include', 'included', 'continue', 'continued', 'set',
  'learn', 'learned', 'learnt', 'change', 'changed', 'lead', 'led', 'understand',
  'understood', 'watch', 'watched', 'follow', 'followed', 'stop', 'stopped', 'create',
  'created', 'speak', 'spoke', 'spoken', 'read', 'spend', 'spent', 'grow', 'grew', 'grown',
  'open', 'opened', 'walk', 'walked', 'win', 'won', 'teach', 'taught', 'offer', 'offered',
  'remember', 'remembered', 'love', 'loved', 'consider', 'considered', 'appear', 'appeared',
  'buy', 'bought', 'serve', 'served', 'die', 'died', 'send', 'sent', 'build', 'built',
  'stay', 'stayed', 'fall', 'fell', 'fallen', 'cut', 'cutting', 'reach', 'reached', 'kill',
  'killed', 'remain', 'remained', 'suggest', 'suggested', 'raise', 'raised', 'pass',
  'passed', 'sell', 'sold', 'decide', 'decided', 'return', 'returned', 'break', 'broke',
  'broken', 'arrive', 'arrived', 'sing', 'sang', 'sung', 'dance', 'danced', 'cry', 'cried',
  'laugh', 'laughed', 'shine', 'shone', 'burn', 'burned', 'burnt', 'dream', 'dreamed',
  'dreamt', 'wish', 'wished', 'kiss', 'kissed', 'pray', 'prayed', 'fly', 'flew', 'flown',
  'ride', 'rode', 'ridden', 'drive', 'drove', 'driven', 'weigh', 'weighed',
  // adverbs, adjectives
  'not', 'no', 'yes', 'very', 'too', 'also', 'just', 'only', 'even', 'still', 'already',
  'never', 'ever', 'always', 'often', 'sometimes', 'usually', 'well', 'back', 'now',
  'here', 'there', 'away', 'around', 'along', 'together', 'alone', 'once', 'twice',
  'today', 'tonight', 'tomorrow', 'yesterday', 'soon', 'late', 'early', 'far', 'near',
  'close', 'high', 'low', 'long', 'short', 'big', 'small', 'little', 'large', 'great',
  'good', 'better', 'best', 'bad', 'worse', 'worst', 'new', 'old', 'young', 'happy',
  'sad', 'sweet', 'true', 'false', 'real', 'whole', 'half', 'last', 'first', 'next',
  'other', 'another', 'same', 'different', 'own', 'such', 'many', 'much', 'more', 'most',
  'few', 'less', 'least', 'all', 'both', 'each', 'every', 'either', 'neither', 'any',
  'some', 'several', 'enough', 'able', 'free', 'sure', 'right', 'wrong', 'clear', 'dark',
  'light', 'bright', 'warm', 'cold', 'hot', 'soft', 'loud', 'quiet', 'fast', 'slow',
  'strong', 'weak', 'rich', 'poor', 'full', 'empty', 'heavy', 'tall', 'wide', 'deep',
  'sweet', 'bitter', 'wild', 'calm', 'proud', 'humble', 'brave', 'lonely', 'blue', 'red',
  'green', 'golden', 'silver', 'black', 'white',
  // nouns
  'man', 'woman', 'men', 'women', 'boy', 'girl', 'child', 'children', 'baby', 'son',
  'daughter', 'mother', 'father', 'mom', 'dad', 'mama', 'daddy', 'brother', 'sister',
  'friend', 'friends', 'lover', 'lovers', 'stranger', 'strangers', 'angel', 'angels',
  'devil', 'king', 'queen', 'cowboy', 'hero', 'heroes',
  'day', 'days', 'night', 'nights', 'morning', 'evening', 'afternoon', 'midnight', 'dawn',
  'dusk', 'sun', 'moon', 'stars', 'sky', 'rain', 'snow', 'wind', 'storm', 'cloud', 'clouds',
  'fire', 'water', 'river', 'ocean', 'sea', 'lake', 'mountain', 'mountains', 'hill',
  'valley', 'desert', 'forest', 'tree', 'trees', 'flower', 'flowers', 'rose', 'roses',
  'bird', 'birds', 'horse', 'horses', 'dog', 'cat',
  'life', 'death', 'world', 'earth', 'home', 'house', 'room', 'door', 'window', 'wall',
  'floor', 'street', 'road', 'highway', 'town', 'city', 'lights', 'bar', 'church',
  'school', 'car', 'truck', 'train', 'plane', 'boat', 'ship', 'wheel', 'wheels',
  'heart', 'hearts', 'soul', 'souls', 'mind', 'dream', 'dreams', 'memory', 'memories',
  'song', 'songs', 'music', 'dance', 'party', 'game', 'story', 'stories', 'word',
  'words', 'name', 'names', 'lie', 'lies', 'truth', 'faith', 'hope', 'fear', 'tears',
  'smile', 'kiss', 'touch', 'hand', 'hands', 'foot', 'feet', 'eye', 'eyes', 'face',
  'hair', 'skin', 'lips', 'arms', 'shoulder', 'shoulders', 'knee', 'knees',
  'time', 'times', 'moment', 'moments', 'hour', 'hours', 'minute', 'minutes', 'second',
  'seconds', 'week', 'weeks', 'month', 'months', 'year', 'years', 'summer', 'winter',
  'spring', 'fall', 'autumn',
  'money', 'gold', 'silver', 'diamond', 'diamonds', 'ring', 'whiskey', 'wine', 'beer',
  'mama', 'daddy',
  // numbers
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy',
  'eighty', 'ninety', 'hundred', 'thousand', 'million', 'first', 'second', 'third',
  // common compounds (so they are NOT split)
  'something', 'anything', 'nothing', 'everything', 'someone', 'anyone', 'noone',
  'everyone', 'somebody', 'anybody', 'nobody', 'everybody', 'sometimes', 'always',
  'cannot', 'cant', 'wont', 'dont', 'didnt', 'doesnt', 'isnt', 'arent', 'wasnt',
  'werent', 'havent', 'hasnt', 'hadnt', 'wouldnt', 'couldnt', 'shouldnt', 'mustnt',
  'without', 'within', 'upon', 'about', 'above', 'below', 'across', 'behind', 'beside',
  'beyond', 'toward', 'towards', 'inside', 'outside', 'birthday', 'daylight', 'midnight',
  'sunshine', 'moonlight', 'rainbow', 'thunder', 'lightning', 'goodbye', 'hello', 'hey',
  'yeah', 'yep', 'nope', 'okay', 'amen', 'hallelujah',
  // contractions' roots
  'im', 'ive', 'id', 'ill', 'youre', 'youve', 'youd', 'youll', 'hes', 'hell', 'shes',
  'itll', 'were', 'weve', 'wed', 'theyll', 'thatll', 'theres', 'lets', 'aint', 'gonna',
  'wanna', 'gotta', 'gotta', 'kinda', 'sorta', 'lemme', 'gimme', 'dunno',
]);

/**
 * Split a merged transcription token into real words ("sixfootsix" → ["six","foot","six"]).
 * Returns null when the token is already a word, too short, has punctuation, or cannot be
 * split into all-known words. Conservative: an unsplittable token is left exactly as heard.
 */
export function segmentMergedWord(word: string): string[] | null {
  const lower = word.toLowerCase();
  if (lower.length < 6) return null;
  if (COMMON_WORDS.has(lower)) return null;
  if (/[^a-z']/.test(lower)) return null;
  const n = lower.length;
  // dp[i] = end-indices of a segmentation of lower[i:], preferring fewer, longer words.
  const dp: (number[] | null)[] = new Array(n + 1).fill(null);
  dp[n] = [];
  for (let i = n - 1; i >= 0; i--) {
    for (let j = Math.min(n, i + 12); j >= i + 2; j--) {
      if (!COMMON_WORDS.has(lower.slice(i, j))) continue;
      const rest = dp[j];
      if (rest !== null) { dp[i] = [j, ...rest]; break; }
    }
  }
  const ends = dp[0];
  if (!ends || ends.length < 2) return null;
  const parts: string[] = [];
  let prev = 0;
  for (const end of ends) { parts.push(word.slice(prev, end)); prev = end; }
  return parts;
}
