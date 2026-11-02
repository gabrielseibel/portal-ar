import { h } from '../utils/dom';
import { Icon, type IconName } from '../ui/icons';

/** Round icon button with an accessible label (tooltip on desktop). */
export function iconButton(icon: IconName, label: string, cls = 'icon-btn') {
  return h('button', { class: cls, type: 'button', 'aria-label': label, title: label, html: Icon[icon] });
}

/** Wraps a control with a small caption underneath. */
export function labeled(control: HTMLElement, label: string) {
  return h('div', { class: 'labeled' }, control, h('span', {}, label));
}
