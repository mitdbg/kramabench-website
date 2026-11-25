'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const escapeText = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
class Element {
  constructor(tagName = 'div', attributes = {}) {
    this.tagName = tagName.toUpperCase(); this.attributes = {...attributes}; this.children = [];
    this.listeners = new Map(); this.style = {}; this.dataset = {}; this.value = attributes.value || '';
    this.checked = Object.hasOwn(attributes, 'checked'); this.disabled = Object.hasOwn(attributes, 'disabled');
    this.hidden = Object.hasOwn(attributes, 'hidden'); this.id = attributes.id || '';
    this._html = ''; this._text = ''; this.classes = new Set((attributes.class || '').split(/\s+/).filter(Boolean));
    this.classList = {add: (...names) => names.forEach(n => this.classes.add(n)), remove: (...names) => names.forEach(n => this.classes.delete(n)), contains: n => this.classes.has(n), toggle: (n, force) => {const add = force === undefined ? !this.classes.has(n) : force; add ? this.classes.add(n) : this.classes.delete(n); return add;}};
    for (const [name, value] of Object.entries(attributes)) if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  get innerHTML() {return this._html + this.children.map(c => c.outerHTML).join('');}
  set innerHTML(value) {this._html = String(value); this._text = ''; this.children = [];}
  get outerHTML() {return `<${this.tagName.toLowerCase()}>${this.innerHTML}</${this.tagName.toLowerCase()}>`;}
  get textContent() {return this._text || this.innerHTML.replace(/<[^>]*>/g, '');}
  set textContent(value) {this._text = String(value); this._html = escapeText(value); this.children = [];}
  addEventListener(type, callback) {if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(callback);}
  removeEventListener(type, callback) {this.listeners.set(type, (this.listeners.get(type) || []).filter(c => c !== callback));}
  dispatch(type, properties = {}) {const event = {type, target: this, currentTarget: this, preventDefault() {this.defaultPrevented = true;}, ...properties}; return Promise.all((this.listeners.get(type) || []).map(callback => callback.call(this, event)));}
  appendChild(child) {this.children.push(child); return child;}
  replaceChildren(...children) {this._html = ''; this._text = ''; this.children = children;}
  setAttribute(name, value) {this.attributes[name] = String(value); if (name === 'disabled') this.disabled = true; if (name === 'hidden') this.hidden = true;}
  getAttribute(name) {return this.attributes[name] ?? null;}
  removeAttribute(name) {delete this.attributes[name]; if (name === 'disabled') this.disabled = false; if (name === 'hidden') this.hidden = false;}
  focus() {this.focused = true;}
  scrollIntoView() {}
}
function parseAttributes(source) {
  const attrs = {}; for (const match of source.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? '';
  return attrs;
}
function deferred() {let resolve, reject; const promise = new Promise((a, b) => {resolve = a; reject = b;}); return {promise, resolve, reject};}
function response(rows, status = 200) {return {ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(rows)};}
async function settle() {for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve));}
function createHarness({siteDir, fetch: fetchOverride, fixtures = {}}) {
  const html = fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(siteDir, 'script.js'), 'utf8');
  const byId = new Map(); const selectors = new Map(); const ready = []; const calls = []; const errors = [];
  for (const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid\s*=\s*(?:"[^"]*"|'[^']*')[^>]*)>/gi)) {
    const attrs = parseAttributes(match[2]); byId.set(attrs.id, new Element(match[1], attrs));
  }
  for (const match of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const attrs = parseAttributes(match[1]); const element = byId.get(attrs.id); if (!element) continue;
    for (const option of match[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)) {const item = new Element('option', parseAttributes(option[1])); item.textContent = option[2]; element.appendChild(item);}
    element.value = element.children.find(c => Object.hasOwn(c.attributes, 'selected'))?.value || element.children[0]?.value || '';
  }
  for (const table of ['leaderboard-table', 'pipeline-design-table', 'pipeline-implementation-table']) if (byId.has(table)) selectors.set(`#${table} tbody`, new Element('tbody'));
  selectors.set('.leaderboard-section h2', new Element('h2'));
  const toggleMarkup = html.match(/<([a-z]+)\b([^>]*class="[^"]*\btoggle-container\b[^"]*"[^>]*)>/i);
  if (toggleMarkup) selectors.set('.toggle-container', new Element(toggleMarkup[1], parseAttributes(toggleMarkup[2])));
  const document = {
    head: new Element('head'), body: new Element('body'),
    createElement: name => new Element(name),
    querySelector: selector => {if (/input\[name=["']?dataset["']?\]:checked/.test(selector)) return [...byId.values()].find(e => e.attributes.name === 'dataset' && e.checked) || null; return selectors.get(selector) || (selector.startsWith('#') ? byId.get(selector.slice(1)) : null) || null;},
    querySelectorAll: selector => {if (/input\[name=["']?dataset["']?\]|#dataset-selector.*input/.test(selector)) return [...byId.values()].filter(e => e.attributes.name === 'dataset'); return [];},
    getElementById: id => byId.get(id) || null,
    addEventListener: (type, callback) => {if (type === 'DOMContentLoaded') ready.push(callback);},
  };
  for (const element of byId.values()) {element.querySelectorAll = selector => element.id === 'dataset-selector' && /input/.test(selector) ? [...byId.values()].filter(e => e.attributes.name === 'dataset') : []; element.querySelector = selector => element.id === 'oracle-control' && /input/.test(selector) ? byId.get('oracle-toggle') : null;}
  const fakeFetch = async (url, options) => {
    const name = String(url); calls.push({url: name, options});
    if (fetchOverride) {const result = await fetchOverride(name, options); if (result !== undefined) return result;}
    if (Object.hasOwn(fixtures, name)) return response(fixtures[name]);
    if (/\.json(?:\?|$)/.test(name)) return {...response([]), json: async () => ({})};
    return response([]);
  };
  const quietConsole = {log() {}, warn() {}, error(...args) {errors.push(args.map(String).join(' '));}};
  const timers = new Map(); let timerId = 0;
  const context = {document, console: quietConsole, fetch: fakeFetch, Papa: {parse: text => ({data: JSON.parse(text), errors: []})}, URL, URLSearchParams, AbortController, Date, Map, Set, Promise, JSON, RegExp,
    setTimeout: callback => {timers.set(++timerId, callback); return timerId;}, clearTimeout: id => timers.delete(id), setInterval() {}, clearInterval() {}, navigator: {clipboard: {writeText: async () => {}}}, location: {href: 'https://example.test/', origin: 'https://example.test'}};
  context.window = context; vm.createContext(context); vm.runInContext(source, context, {filename: 'script.js'});
  return {html, source, context, calls, errors, element: id => byId.get(id), query: selector => document.querySelector(selector), evaluate: expression => vm.runInContext(expression, context), async initialize() {await Promise.all(ready.map(callback => callback())); await settle();}, async flushTimers() {const pending = [...timers.values()]; timers.clear(); for (const callback of pending) await callback(); await settle();}, async settle() {await settle();}};
}
module.exports = {createHarness, deferred, response, settle};
