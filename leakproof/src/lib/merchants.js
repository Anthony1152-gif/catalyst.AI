// Known merchants: how to recognise them in an email, what category they
// belong to (used to spot overlapping services), and where to cancel.
// The URLs are account/manage pages; merchants move them occasionally, so the
// drafted email is always offered alongside as a fallback.
export const MERCHANTS = [
  { name: 'Netflix', match: /netflix/i, category: 'streaming', manageUrl: 'https://www.netflix.com/cancelplan' },
  { name: 'Hulu', match: /\bhulu\b/i, category: 'streaming', manageUrl: 'https://secure.hulu.com/account' },
  { name: 'Disney+', match: /disney\s*\+|disney plus|disneyplus/i, category: 'streaming', manageUrl: 'https://www.disneyplus.com/account' },
  { name: 'Max', match: /\bhbo\b|\bmax\.com\b|\bhbo max\b/i, category: 'streaming', manageUrl: 'https://auth.max.com/subscription' },
  { name: 'Paramount+', match: /paramount\s*\+|paramount plus/i, category: 'streaming', manageUrl: 'https://www.paramountplus.com/account/' },
  { name: 'Peacock', match: /peacock/i, category: 'streaming', manageUrl: 'https://www.peacocktv.com/account' },
  { name: 'Apple TV+', match: /apple tv\s*\+/i, category: 'streaming', manageUrl: 'https://support.apple.com/en-us/118428' },
  { name: 'YouTube Premium', match: /youtube premium|youtube music/i, category: 'music', manageUrl: 'https://www.youtube.com/paid_memberships' },
  { name: 'Spotify', match: /spotify/i, category: 'music', manageUrl: 'https://www.spotify.com/account/subscription/' },
  { name: 'Apple Music', match: /apple music/i, category: 'music', manageUrl: 'https://support.apple.com/en-us/118428' },
  { name: 'Audible', match: /audible/i, category: 'books', manageUrl: 'https://www.audible.com/account/overview' },
  { name: 'Kindle Unlimited', match: /kindle unlimited/i, category: 'books', manageUrl: 'https://www.amazon.com/kindle-dbs/ku/ku-central' },
  { name: 'Amazon Prime', match: /amazon prime|prime membership/i, category: 'shopping', manageUrl: 'https://www.amazon.com/mc' },
  { name: 'Adobe', match: /adobe|creative cloud/i, category: 'software', manageUrl: 'https://account.adobe.com/plans' },
  { name: 'Microsoft 365', match: /microsoft 365|office 365/i, category: 'software', manageUrl: 'https://account.microsoft.com/services' },
  { name: 'Dropbox', match: /dropbox/i, category: 'cloud storage', manageUrl: 'https://www.dropbox.com/account/plan' },
  { name: 'iCloud+', match: /icloud/i, category: 'cloud storage', manageUrl: 'https://support.apple.com/en-us/118428' },
  { name: 'Google One', match: /google one/i, category: 'cloud storage', manageUrl: 'https://one.google.com/settings' },
  { name: 'Canva', match: /canva/i, category: 'software', manageUrl: 'https://www.canva.com/settings/billing-and-teams' },
  { name: 'Duolingo', match: /duolingo/i, category: 'education', manageUrl: null },
  { name: 'HelloFresh', match: /hellofresh/i, category: 'food', manageUrl: 'https://www.hellofresh.com/my-account/settings' },
  { name: 'Planet Fitness', match: /planet fitness/i, category: 'fitness', manageUrl: null },
  { name: 'Peloton', match: /peloton/i, category: 'fitness', manageUrl: 'https://members.onepeloton.com/preferences/subscriptions' },
  { name: 'The New York Times', match: /new york times|nytimes/i, category: 'news', manageUrl: 'https://myaccount.nytimes.com/seg/subscription' },
  { name: 'LinkedIn Premium', match: /linkedin premium/i, category: 'career', manageUrl: 'https://www.linkedin.com/premium/manage/' },
  { name: 'Amazon', match: /amazon/i, category: 'shopping', manageUrl: 'https://www.amazon.com/gp/css/order-history' },
  { name: 'Best Buy', match: /best\s*buy/i, category: 'shopping', manageUrl: null },
  { name: 'Target', match: /\btarget\b/i, category: 'shopping', manageUrl: null },
  { name: 'Walmart', match: /walmart/i, category: 'shopping', manageUrl: null },
  { name: 'Zara', match: /\bzara\b/i, category: 'shopping', manageUrl: null },
];

export function findMerchant(text) {
  if (!text) return null;
  return MERCHANTS.find((m) => m.match.test(text)) || null;
}

export function merchantInfo(name) {
  const exact = MERCHANTS.find((m) => m.name.toLowerCase() === String(name).toLowerCase());
  return exact || findMerchant(name) || { name, category: 'other', manageUrl: null };
}
