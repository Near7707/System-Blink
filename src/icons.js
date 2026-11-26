// Line icons (no picture files). 24×24, drawn with the current text color.

const P = {
    potion: '<path d="M9 3h6M10 3v5L5.5 16.5A3 3 0 0 0 8.2 21h7.6a3 3 0 0 0 2.7-4.5L14 8V3"/><path d="M7.5 14h9"/>',
    can: '<rect x="7" y="4" width="10" height="17" rx="2"/><path d="M9 4V2.5h6V4M7 9h10"/>',
    umbrella: '<path d="M3 12a9 9 0 0 1 18 0z"/><path d="M12 12v6.5a2 2 0 0 1-4 0M12 3v0"/>',
    coin: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5"/><path d="M12 9.5v5"/>',
    ticket: '<path d="M3 8a2 2 0 0 0 0 4v0a2 2 0 0 1 0 4v1h18v-1a2 2 0 0 1 0-4 2 2 0 0 0 0-4V7H3z"/><path d="M14 7v10" stroke-dasharray="2 2"/>',
    reroll: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/>',
    tea: '<path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3c0 1.5 1 1.5 1 3M12 3c0 1.5 1 1.5 1 3"/>',
    hairpin: '<path d="M4 20 15 9"/><circle cx="17" cy="7" r="3"/><path d="M17 4v-1M20 7h1M19.2 4.8l.7-.7"/>',
    hourglass: '<path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9"/>',
    map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
    bread: '<path d="M5 20V11a4 4 0 0 1-1-7.5C6 2 9 3 12 3s6-1 8 .5A4 4 0 0 1 19 11v9z"/><path d="M9 12v3M14 12v3"/>',
    charm: '<path d="M7 3h10v15l-5 3-5-3z"/><path d="M10 8h4M10 11h4M12 14v2"/>',
    shirt: '<path d="M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3a4 4 0 0 1-8 0z"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    pen: '<path d="M4 20l1-5L15 5l4 4L9 19z"/><path d="M13 7l4 4"/>',
    cat: '<path d="M5 10V4l4 3h6l4-3v6a7 7 0 0 1-14 0z"/><path d="M9.5 12h0M14.5 12h0M11 15h2"/>',
    cloud: '<path d="M7 16a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1A4 4 0 0 1 17 16z"/><path d="M9 19l-1 2M13 19l-1 2M17 19l-1 2"/>',
    socks: '<path d="M7 3h5v9l2 3a3 3 0 0 1-5 3l-3-4V3z"/><path d="M7 7h5"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M8 7h7"/>',
    gift: '<rect x="3" y="9" width="18" height="12"/><path d="M3 13h18M12 9v12M12 9c-2-4-6-4-6-1.5S12 9 12 9s6-.5 6-1.5S14 5 12 9"/>',
    box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
    gem: '<path d="M6 3h12l3 6-9 12L3 9z"/><path d="M3 9h18M9 3l3 6 3-6M12 9v12"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
    heart: '<path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z"/>',
    flower: '<circle cx="12" cy="10" r="2.5"/><path d="M12 7.5a3 3 0 1 1 3.5 3.5M12 7.5a3 3 0 1 0-3.5 3.5M8.5 11a3 3 0 1 0 3.5 2M15.5 11a3 3 0 1 1-3.5 2M12 13v8"/>',
    music: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    // screen marks
    calendar: '<rect x="3" y="5" width="18" height="16" rx="1"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>',
    pin: '<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    hex: '<path d="M12 2.5 20.5 7.3v9.4L12 21.5 3.5 16.7V7.3z"/>',
};

export const ITEM_ICONS = ['potion', 'can', 'umbrella', 'coin', 'ticket', 'reroll', 'tea', 'hairpin', 'hourglass', 'map', 'bread',
    'charm', 'shirt', 'bell', 'pen', 'cat', 'cloud', 'socks', 'book', 'gift', 'box', 'gem', 'star', 'key', 'heart', 'flower', 'music'];

export function icon(name, cls = '') {
    const body = P[name] || P.box;
    return `<svg class="sblink-ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** The hexagon mark used for the button, the wand item and small notices. */
export function hexMark(cls = '') {
    return `<svg class="sblink-hexmark ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 2.5 20.5 7.3v9.4L12 21.5 3.5 16.7V7.3z"/><path d="M12 8l3 4-3 4-3-4z" fill="currentColor" stroke="none"/></svg>`;
}
