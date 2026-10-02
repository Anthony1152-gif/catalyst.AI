// A realistic demo inbox. Dates are relative to today so the deadlines in the
// demo are always upcoming.

import { addDays } from './dates.js';

const fmt = (d) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

export function demoInbox(today = new Date()) {
  const d = (n) => fmt(addDays(today, n));
  return `From: Netflix <info@account.netflix.com>
Subject: Your Netflix receipt
Date: ${d(-12)}

Thanks for being a member. You were charged $17.99 for your Standard plan.
Your membership renews monthly. Next billing date: ${d(18)}.

---
From: Netflix <info@account.netflix.com>
Subject: An update on your Netflix price
Date: ${d(-3)}

We're writing to let you know your price is changing from $17.99/month to $20.99/month.
The new price takes effect on your next billing date, ${d(18)}.

---
From: Hulu <hulu@hulumail.com>
Subject: Payment receipt
Date: ${d(-8)}

Your Hulu (With Ads) subscription payment of $9.99/month was successful. Plan: Hulu (With Ads)

---
From: Max <no-reply@max.com>
Subject: Your HBO Max subscription receipt
Date: ${d(-20)}

Thanks for subscribing. Amount charged: $16.99 per month. Your subscription renews automatically.

---
From: Adobe <mail@mail.adobe.com>
Subject: Your free trial of Creative Cloud is ending soon
Date: ${d(-5)}

Your free trial of Creative Cloud Pro ends on ${d(2)}. After your trial, you'll be charged US$69.99/mo unless you cancel.

---
From: Best Buy <BestBuyInfo@emailinfo.bestbuy.com>
Subject: Thanks for your order
Date: ${d(-10)}

Thanks for your order! Order #BBY01-80612345
Item: Sony WH-1000XM5 Wireless Headphones
Order total: $329.99
Return by ${d(4)} for a full refund.

---
From: Planet Fitness <noreply@planetfitness.com>
Subject: Your annual fee is coming up
Date: ${d(-1)}

Your Black Card membership annual fee of $49.00 per year will be charged on ${d(9)}.

---
From: Dropbox <no-reply@dropbox.com>
Subject: Your Dropbox Plus subscription has renewed
Date: ${d(-30)}

Your Dropbox Plus plan renewed for $119.88 per year. Your next renewal is on ${d(335)}.

---
From: iCloud <no_reply@email.apple.com>
Subject: Your receipt from Apple
Date: ${d(-6)}

iCloud+ with 200 GB storage. $2.99/month. Renews ${d(24)}.

---
From: Calm <hello@calm.com>
Subject: Welcome to your 7-day free trial
Date: ${d(-1)}

Your free trial ends in 6 days. Then $69.99/year will be billed automatically.`;
}
