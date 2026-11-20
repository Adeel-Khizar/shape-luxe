import { Component } from '@theme/component';
import { formatMoney } from '@theme/money-formatting';
import { StandardEvents } from '@shopify/events';
import {
  findVariantByOptions,
  getSelectedOptionValues,
  updateOptionAvailability,
} from '@theme/variant-option-buttons';

/**
 * @typedef {{ id: number, title: string, price: number, available: boolean }} FbtVariant
 */

/**
 * "Frequently bought together". Loads recommended items (complementary, then related) into the
 * list, keeps the total in sync, and adds the checked items through the section's product form.
 *
 * @typedef {Object} Refs
 * @property {HTMLUListElement} list
 * @property {HTMLInputElement} currentVariant
 * @property {HTMLElement} total
 * @property {HTMLButtonElement} addButton
 * @property {HTMLScriptElement} variantsData
 * @property {HTMLElement} [currentPrice]
 * @property {HTMLElement} [currentVariantTitle]
 *
 * @extends {Component<Refs>}
 */
export class FrequentlyBoughtTogetherComponent extends Component {
  requiredRefs = ['list', 'currentVariant', 'total', 'addButton', 'variantsData'];

  /** @type {FbtVariant[]} */
  #variants = [];

  /** @type {AbortController | undefined} */
  #abortController;

  connectedCallback() {
    super.connectedCallback();

    try {
      this.#variants = JSON.parse(this.refs.variantsData.textContent || '[]');
    } catch (error) {
      this.#variants = [];
    }

    this.#abortController?.abort();
    this.#abortController = new AbortController();
    const { signal } = this.#abortController;

    this.closest('.shopify-section')?.addEventListener(StandardEvents.productSelect, this.#onProductSelect, {
      signal,
    });

    if (this.dataset.loaded !== 'true') this.#loadRecommendations(signal);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    this.#abortController?.abort();
  }

  handleChange() {
    this.#updateTotal();
  }

  /** @param {Event} event */
  handleOptionChange(event) {
    const item = event.target instanceof Element ? event.target.closest('[data-fbt-item]') : null;
    if (item) this.#syncItemVariant(item);
    this.#updateTotal();
  }

  handleAdd() {
    const items = this.#getSelectedItems();
    if (items.length === 0) return;

    /** @type {(HTMLElement & { addItems?: (items: Array<{variantId: string, quantity: number}>) => void }) | null} */
    const productForm = this.closest('.shopify-section')?.querySelector('product-form-component') ?? null;
    if (typeof productForm?.addItems !== 'function') return;

    productForm.addItems(items);
  }

  /** @param {AbortSignal} signal */
  async #loadRecommendations(signal) {
    const { url, productId, sectionId, limit } = this.dataset;
    if (!url || !productId || !sectionId) return;

    try {
      // Complementary products come from the Search & Discovery app; fall back to related ones.
      let items = await this.#fetchItems(url, productId, sectionId, limit, 'complementary', signal);
      if (items.length === 0) items = await this.#fetchItems(url, productId, sectionId, limit, 'related', signal);
      if (items.length === 0 || signal.aborted) return;

      this.refs.list.append(...items);
      for (const item of items) this.#syncItemVariant(item);
      this.dataset.loaded = 'true';
      this.hidden = false;
      this.#updateTotal();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.error('Frequently bought together error:', error);
    }
  }

  /**
   * @param {string} url
   * @param {string} productId
   * @param {string} sectionId
   * @param {string | undefined} limit
   * @param {'complementary' | 'related'} intent
   * @param {AbortSignal} signal
   * @returns {Promise<Element[]>}
   */
  async #fetchItems(url, productId, sectionId, limit, intent, signal) {
    const requestUrl = new URL(url, window.location.origin);
    requestUrl.searchParams.set('product_id', productId);
    requestUrl.searchParams.set('section_id', sectionId);
    requestUrl.searchParams.set('limit', limit || '2');
    requestUrl.searchParams.set('intent', intent);

    const response = await fetch(requestUrl, { signal });
    if (!response.ok) return [];

    const html = new DOMParser().parseFromString(await response.text(), 'text/html');
    return Array.from(html.querySelectorAll('[data-fbt-items] > [data-fbt-item]'));
  }

  /** @param {Event} event */
  #onProductSelect = async (event) => {
    const sourceCard = event.target instanceof Element ? event.target.closest('product-card') : null;
    if (sourceCard && !sourceCard.contains(this)) return;

    /** @type {{ detail?: { productId?: string, resource?: { id?: number } } } | undefined} */
    let result;
    try {
      result = await /** @type {any} */ (event).promise;
    } catch (error) {
      return;
    }

    const { productId, resource } = result?.detail ?? {};
    if (productId && productId !== this.dataset.productId) return;

    const variant = this.#variants.find((item) => String(item.id) === String(resource?.id));
    if (!variant) return;

    const { currentVariant, currentPrice, currentVariantTitle } = this.refs;
    currentVariant.value = String(variant.id);
    currentVariant.dataset.price = String(variant.price);
    if (currentVariantTitle && currentVariantTitle.textContent?.trim()) currentVariantTitle.textContent = variant.title;
    this.#setMoney(currentPrice, variant.price);

    const checkbox = currentVariant.closest('[data-fbt-item]')?.querySelector('.fbt__checkbox');
    if (checkbox instanceof HTMLInputElement) {
      checkbox.disabled = !variant.available;
      if (!variant.available) checkbox.checked = false;
    }

    this.#updateTotal();
  };

  /**
   * Resolves a recommended item's chosen options to a variant. A sold-out choice clears the
   * variant so the item is left out of the total and the add.
   * @param {Element} item
   */
  #syncItemVariant(item) {
    const data = item.querySelector('script[data-fbt-variants]');
    const input = item.querySelector('input[data-fbt-variant]');
    if (!data || !(input instanceof HTMLInputElement)) return;

    /** @type {import('@theme/variant-option-buttons').OptionVariant[]} */
    let variants = [];
    try {
      variants = JSON.parse(data.textContent || '[]');
    } catch (error) {
      return;
    }

    updateOptionAvailability(item, variants);

    const variant = findVariantByOptions(variants, getSelectedOptionValues(item));
    const available = Boolean(variant?.available);
    input.value = available && variant ? String(variant.id) : '';
    if (variant) input.dataset.price = String(variant.price);

    const error = item.querySelector('.fbt__item-error');
    if (error instanceof HTMLElement) error.hidden = available;
  }

  /** @returns {Array<{variantId: string, quantity: number}>} */
  #getSelectedItems() {
    /** @type {Array<{variantId: string, quantity: number}>} */
    const items = [];

    for (const item of this.refs.list.querySelectorAll('[data-fbt-item]')) {
      const checkbox = item.querySelector('.fbt__checkbox');
      if (!(checkbox instanceof HTMLInputElement) || !checkbox.checked || checkbox.disabled) continue;

      const variantId = this.#getVariantControl(item)?.value;
      if (variantId) items.push({ variantId, quantity: 1 });
    }

    return items;
  }

  #updateTotal() {
    let total = 0;
    let count = 0;

    for (const item of this.refs.list.querySelectorAll('[data-fbt-item]')) {
      const control = this.#getVariantControl(item);
      const price = Number(control?.dataset.price);

      // Each recommended row shows the price of its chosen variant.
      if (!item.classList.contains('fbt__item--current') && item instanceof HTMLElement) {
        this.#setMoney(item.querySelector('.fbt__price') ?? undefined, price || 0);
      }

      const checkbox = item.querySelector('.fbt__checkbox');
      if (checkbox instanceof HTMLInputElement && checkbox.checked && !checkbox.disabled && control?.value) {
        total += price || 0;
        count += 1;
      }
    }

    this.#setMoney(this.refs.total, total);
    this.refs.addButton.disabled = count === 0;
  }

  /**
   * @param {Element} item
   * @returns {HTMLInputElement | null}
   */
  #getVariantControl(item) {
    const control = item.querySelector('input[data-fbt-variant]');
    return control instanceof HTMLInputElement ? control : null;
  }

  /**
   * @param {Element | undefined} element
   * @param {number} amount
   */
  #setMoney(element, amount) {
    const bdi = element?.querySelector('bdi');
    if (!bdi) return;
    bdi.textContent = formatMoney(amount, this.dataset.moneyFormat ?? '{{amount}}', this.dataset.currency ?? 'USD');
  }
}

if (!customElements.get('frequently-bought-together-component')) {
  customElements.define('frequently-bought-together-component', FrequentlyBoughtTogetherComponent);
}
