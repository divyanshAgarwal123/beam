const scenarios = {
  coffee: {
    sender: 'Maya',
    initials: 'M',
    source: 'Sample conversation',
    firstLine: 'Thanks for grabbing coffee!',
    request: 'Of course! Your share is $8.50. Send it to',
    name: 'maya.eth',
    amount: '8.50',
    reason: '',
  },
  dinner: {
    sender: 'Dinner group',
    initials: 'D',
    source: 'Sample conversation',
    firstLine: 'I can send my share.',
    request: 'Your share is $42. Send it to',
    name: 'anika.eth',
    amount: '42.00',
    reason: 'This is above the sample 25 USDC cap.',
  },
  agent: {
    sender: 'Agent inbox',
    initials: 'A',
    source: 'Sample MCP request',
    firstLine: 'The agent prepared a request for your review.',
    request: 'Pay 6 USDC for the invoice to',
    name: 'studio.eth',
    amount: '6.00',
    reason: 'Requests from external agents always need World ID.',
  },
};

const screen = document.querySelector('#demo-screen');
const controls = document.querySelectorAll('[data-case]');
const stages = {
  capture: ['01', 'Capture', 'Tap the floating Beam'],
  review: ['02', 'Review', 'Check amount and recipient'],
  world: ['03', 'Approve', 'Sample World ID check'],
  ready: ['03', 'Confirm', 'Confirm on your phone'],
  receipt: ['04', 'Receipt', 'Simulated payment'],
  declined: ['03', 'Declined', 'Request stopped'],
};
const mark = (size) => `<span class="mark"><img src="./assets/beam-glyph.svg" width="${size}" height="${size}" alt=""></span>`;
const icon = (name, size) => `<img src="./assets/${name}.svg" width="${size}" height="${size}" alt="">`;
const action = (name, label, quiet = false) =>
  `<button class="phone-${quiet ? 'quiet' : 'primary'}" type="button" data-action="${name}">${label}</button>`;

let selected = 'coffee';
let stage = 'capture';

function capture(sample) {
  const label = selected === 'agent' ? 'Open review' : 'Tap Beam';
  return `
    <div class="chat-head">
      <span class="avatar" aria-hidden="true">${sample.initials}</span>
      <div><strong>${sample.sender}</strong><small>${sample.source}</small></div>
    </div>
    <div class="chat-content">
      <span class="chat-date">Today</span>
      <p class="chat-message outgoing">${sample.firstLine}</p>
      <p class="chat-message incoming">${sample.request} <strong>${sample.name}</strong>.</p>
    </div>
    <button class="tap-beam" type="button" data-action="review">${mark(21)} ${label}</button>`;
}

function details(sample) {
  return `<p class="amount">${icon('usdc', 24)} ${sample.amount} <span>USDC</span></p>
    <div class="recipient"><span>To</span><strong>${icon('ens', 13)} ${sample.name}</strong></div>`;
}

function sheet(title, content, actions) {
  return `<div class="sheet">
    <div class="sheet-head">${mark(16)}<strong>Beam</strong><small>Arc Testnet</small></div>
    <h3 tabindex="-1">${title}</h3>${content}<div class="phone-actions">${actions}</div>
  </div>`;
}

function panel(sample) {
  if (stage === 'world') {
    return sheet('World ID approval', details(sample) +
      `<p class="sheet-note warn">${sample.reason}</p><p class="phone-copy">Choose how the linked human responds in this simulation.</p>`,
    action('ready', 'Simulate approval') + action('declined', 'Decline', true));
  }
  if (stage === 'receipt') {
    return sheet('Payment simulated',
      '<span class="result-symbol" aria-hidden="true">✓</span>' + details(sample) +
      '<p class="phone-copy">This is a sample receipt. No funds moved.</p>', action('capture', 'Try again'));
  }
  if (stage === 'declined') {
    return sheet('Request declined',
      '<span class="result-symbol declined" aria-hidden="true">×</span><p class="phone-copy">The request stopped before device confirmation.</p>',
      action('capture', 'Start over'));
  }
  const approved = stage === 'ready';
  const needsWorld = sample.reason && !approved;
  const note = approved
    ? '<p class="sheet-note good">Sample World ID approval received.</p>'
    : needsWorld
      ? `<p class="sheet-note warn">${sample.reason}</p>`
      : '<p class="sheet-note">Sample ENS lookup matched the recipient.</p>';
  return sheet(approved ? 'Ready to confirm' : 'Review payment', details(sample) + note,
    action(needsWorld ? 'world' : 'receipt', needsWorld ? 'Review World ID step' : 'Simulate device confirmation')
    + action('capture', 'Cancel', true));
}

function render(focus = false) {
  const sample = scenarios[selected];
  screen.innerHTML = stage === 'capture' ? capture(sample) : panel(sample);
  const [index, title, caption] = stages[stage];
  document.querySelector('#stage-index').textContent = index;
  document.querySelector('#stage-title').textContent = title;
  document.querySelector('#stage-caption').textContent = caption;
  if (focus) screen.querySelector('h3, .tap-beam').focus({ preventScroll: true });
}

function selectScenario(next) {
  selected = next;
  stage = 'capture';
  for (const button of controls) {
    button.setAttribute('aria-pressed', String(button.dataset.case === selected));
  }
  render();
}

screen.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  stage = button.dataset.action;
  render(true);
});
for (const button of controls) {
  button.disabled = false;
  button.addEventListener('click', () => selectScenario(button.dataset.case));
}
document.querySelector('[data-start-case]').addEventListener('click', (event) => {
  selectScenario(event.currentTarget.dataset.startCase);
});
render();
