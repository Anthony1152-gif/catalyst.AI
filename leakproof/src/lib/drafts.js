// Ready-to-send messages for each fix. Kept firm and short: support agents
// act faster on a clear request with the reference numbers up front.

import { fromISO } from './dates.js';
import { money, per } from './analyze.js';
import { merchantInfo } from './merchants.js';

const ACTION_LABELS = {
  cancel: 'Cancel it',
  'cancel-trial': 'Cancel before I’m charged',
  return: 'Start the return',
  negotiate: 'Push back on the price',
};

export function actionLabel(action) {
  return ACTION_LABELS[action] || 'Fix it';
}

export function draftFor(item, action, name = '') {
  const sign = name ? `\n\nThanks,\n${name}` : '\n\nThanks';
  const plan = item.itemName ? ` (${item.itemName})` : '';
  const price = `${money(item.amount, item.currency)}${per(item.cadence)}`;
  const date = item.deadline ? formatDate(item.deadline) : null;

  switch (action) {
    case 'cancel-trial':
      return {
        subject: `Cancel my free trial before it converts`,
        body:
          `Hi ${item.merchant} team,\n\n` +
          `Please cancel my free trial${plan} effective immediately` +
          (date ? `, before it ends on ${date}` : '') +
          `. I do not want to be moved onto the paid plan (${price}).\n\n` +
          `Please confirm in writing that the trial is cancelled and that no charge will be made to my payment method.` +
          sign,
      };
    case 'return':
      return {
        subject: `Return and refund request${item.orderNumber ? ` for order ${item.orderNumber}` : ''}`,
        body:
          `Hi ${item.merchant} team,\n\n` +
          `I'd like to return ${item.itemName ? `"${item.itemName}"` : 'my recent purchase'}` +
          (item.orderNumber ? ` from order ${item.orderNumber}` : '') +
          ` for a full refund of ${money(item.amount, item.currency)} to my original payment method.` +
          (date ? ` I'm within the return window, which runs until ${date}.` : '') +
          `\n\nPlease send a return label or instructions.` +
          sign,
      };
    case 'negotiate':
      return {
        subject: `Price increase on my ${item.merchant} subscription`,
        body:
          `Hi ${item.merchant} team,\n\n` +
          `I've been notified that my subscription${plan} is going up from ` +
          `${money(item.previousAmount, item.currency)} to ${price}. ` +
          `I'd like to stay, but not at the new price.\n\n` +
          `Can you keep me on my current rate, or offer a loyalty or retention discount? ` +
          `If not, please cancel my subscription before the new price takes effect` +
          (date ? ` on ${date}` : '') +
          ` and confirm that no further charges will be made.` +
          sign,
      };
    case 'cancel':
    default:
      return {
        subject: `Cancel my ${item.merchant} subscription`,
        body:
          `Hi ${item.merchant} team,\n\n` +
          `Please cancel my subscription${plan} (${price}) effective immediately and turn off auto-renewal.` +
          (item.cadence === 'yearly' ? ` As this is an annual plan, please refund any unused portion.` : '') +
          `\n\nPlease confirm the cancellation in writing and that no further charges will be made.` +
          sign,
      };
  }
}

export function manageUrl(item) {
  return merchantInfo(item.merchant).manageUrl;
}

export function mailtoLink({ subject, body }) {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function formatDate(iso) {
  return fromISO(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
